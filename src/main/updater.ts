// 检查有没有新版本，并把安装包下下来。
//
// **不做自动安装**：那需要 electron-updater 一整套（差分包、latest.yml、签名校验），
// 一旦出错的表现是用户端反复安装失败，而你在自己机器上复现不了。
// 这里只做到「告诉你有新版 + 帮你把包下好打开」，装还是用户自己点一下，
// 出问题最多是下载失败，重试即可。
//
// 数据源是发布脚本写的 latest.json，里面已经有版本号、各平台链接和这一版的更新条目。
import { app, ipcMain, net, shell, BrowserWindow } from 'electron'
import https from 'node:https'
import fs from 'fs'
import path from 'path'
import { getPrefs } from './prefs'
import type { UpdateInfo } from '../shared/types'

// 允许用环境变量指到别处，**只为了能真机验证**：线上的 latest.json 版本总是 ≤ 本地，
// 不换个源就永远走不到「有新版本」那条分支，只能靠读代码猜它对不对。
// 打包版不设这个变量，走的还是官网。
const LATEST_URL = process.env.EAS_UPDATE_URL || 'https://eas.biily.top/download/latest.json'
const SITE = process.env.EAS_UPDATE_SITE || 'https://eas.biily.top'

/** 启动后隔多久查第一次。不马上查是给启动让路——那会儿正在起 PTY、装 MCP 桥 */
const FIRST_DELAY_MS = 12_000
/** 之后每隔多久查一次。发版没那么频繁，查太勤只是徒增服务器日志 */
const INTERVAL_MS = 6 * 60 * 60 * 1000

let latest: UpdateInfo | null = null
let timer: ReturnType<typeof setInterval> | null = null

/** 纯数字三段式比较。这里不引 semver：版本号是自己发的，格式受控 */
function isNewer(remote: string, local: string): boolean {
  const p = (v: string): number[] => v.split('.').map((n) => parseInt(n, 10) || 0)
  const a = p(remote)
  const b = p(local)
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** 挑本机该下的那个包。mac 分 arm64/x64，拿错了装上去跑不起来 */
function pickUrl(j: Record<string, unknown>): string | null {
  const get = (k: string): string | null => (typeof j[k] === 'string' ? (j[k] as string) : null)
  const rel =
    process.platform === 'darwin'
      ? get(process.arch === 'arm64' ? 'mac_arm64' : 'mac_x64') ?? get('mac')
      : process.platform === 'win32'
        ? get('win')
        : null
  if (!rel) return null
  return rel.startsWith('http') ? rel : SITE + rel
}

/** 用 Node 的 https 再试一次。**只在 Electron 的 net 失败之后走这条。**
 *
 *  2026-08-31 用户报「Mac 端一直收不到更新通知」，设置里是
 *  `检查失败：net::ERR_FAILED`，装的还停在 0.4.62 —— 也就是说这条链路
 *  从那一版起就没通过，而**用户唯一能察觉的方式是主动去设置里看一眼**。
 *
 *  没能复现：同一台机器上开发版走同样的 `net.request` 是成功的，
 *  服务端也正常（curl 返回 200 / 0.4.69）。所以不猜根因，改成
 *  **两套网络栈各试一次** —— Chromium 那套挂了还有 Node 这套，
 *  它们的代理处理、DNS、证书校验都是各自独立的。 */
function fetchViaNode(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // **比第一条短**：两条串起来是用户手动点「检查更新」时要干等的总时长。
    // 15+15=30 秒太久 —— 第一条已经等过一轮，第二条只是「换条路再碰一下」
    const req = https.get(LATEST_URL, { timeout: 8_000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`服务器返回 ${String(res.statusCode)}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('latest.json 不是合法 JSON'))
        }
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('检查更新超时'))
    })
    req.on('error', reject)
  })
}

/** 拉 latest.json。走 Electron 的 net 而不是 https 模块：它用 Chromium 的网络栈，
 *  会遵循系统代理设置（这台机器上 Clash 是全局接管的，用 https 模块容易莫名卡住）。
 *
 *  **失败了再用 Node 的 https 试一次**（见 fetchViaNode）。 */
function fetchLatest(): Promise<Record<string, unknown>> {
  return fetchViaElectron().catch(async (e: unknown) => {
    const first = e instanceof Error ? e.message : String(e)
    try {
      const j = await fetchViaNode()
      console.log(`[updater] Chromium 那套失败（${first}），Node 这套成功`)
      return j
    } catch (e2) {
      // **两条都带出去。** 只报第一条的话，`net::ERR_FAILED` 这种
      // 什么都没说的错误会成为唯一线索，下次还是查不动
      const second = e2 instanceof Error ? e2.message : String(e2)
      throw new Error(`${first}；换一条网络栈重试也失败：${second}`)
    }
  })
}

function fetchViaElectron(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url: LATEST_URL, cache: 'no-cache' })
    const chunks: Buffer[] = []
    const kill = setTimeout(() => {
      req.abort()
      reject(new Error('检查更新超时'))
    }, 15_000)
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(kill)
        res.on('data', () => {})
        reject(new Error(`服务器返回 ${res.statusCode}`))
        return
      }
      res.on('data', (c) => chunks.push(Buffer.from(c)))
      res.on('end', () => {
        clearTimeout(kill)
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('latest.json 不是合法 JSON'))
        }
      })
    })
    req.on('error', (e) => {
      clearTimeout(kill)
      reject(e)
    })
    req.end()
  })
}

/** 把当前状态推给所有窗口。**latest 为 null 也要推** ——
 *  用户关掉「自动检查」时要靠这一下把标题栏上那个提示收回去，
 *  只在有更新时推的话，开关关了红点还挂着，等于没关。 */
function notifyRenderer(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:available', latest)
  }
}

/** 查一次。manual=true 是用户自己点的——那种情况要把失败原样报回去；
 *  自动检查失败一律咽下：网络不通时天天弹错误框只会让人烦。 */
export async function checkForUpdate(manual = false): Promise<UpdateInfo | null> {
  try {
    const j = await fetchLatest()
    const v = typeof j.version === 'string' ? j.version : null
    if (!v || !isNewer(v, app.getVersion())) {
      latest = null
      notifyRenderer()
      return null
    }
    latest = {
      version: v,
      notes: Array.isArray(j.notes) ? (j.notes as string[]).filter((n) => typeof n === 'string') : [],
      url: pickUrl(j),
      published: typeof j.published === 'string' ? j.published : undefined
    }
    notifyRenderer()
    return latest
  } catch (e) {
    if (manual) throw e
    return null
  }
}

/** 下载安装包到「下载」文件夹，边下边报进度，下完打开它（mac 挂载 dmg / Windows 起安装程序） */
function download(url: string, onProgress: (got: number, total: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const name = decodeURIComponent(url.split('/').pop() || 'Eas-Term-update')
    const dest = path.join(app.getPath('downloads'), name)
    const req = net.request({ url, cache: 'no-cache' })
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        res.on('data', () => {})
        reject(new Error(`下载失败：服务器返回 ${res.statusCode}`))
        return
      }
      const total = Number(res.headers['content-length'] ?? 0)
      let got = 0
      // 先写到 .part，下完再改名：中途断了不会在「下载」里留下一个看着完整、
      // 其实缺一截的 dmg —— 那种包双击会报「映像已损坏」，很难让人联想到是没下完
      const tmp = dest + '.part'
      const out = fs.createWriteStream(tmp)
      res.on('data', (c) => {
        got += c.length
        out.write(Buffer.from(c))
        onProgress(got, total)
      })
      res.on('end', () => {
        out.end(() => {
          try {
            fs.renameSync(tmp, dest)
            resolve(dest)
          } catch (e) {
            reject(e as Error)
          }
        })
      })
      res.on('error', (e: Error) => {
        out.destroy()
        fs.rmSync(tmp, { force: true })
        reject(e)
      })
    })
    req.on('error', reject)
    req.end()
  })
}

export function registerUpdaterHandlers(): void {
  // 渲染层问「现在有没有已知的新版本」——窗口重载后要能拿回状态
  ipcMain.handle('update:known', () => latest)

  ipcMain.handle('update:check', async (): Promise<{ ok: boolean; info?: UpdateInfo | null; error?: string }> => {
    try {
      return { ok: true, info: await checkForUpdate(true) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('update:download', async (e): Promise<{ ok: boolean; path?: string; error?: string }> => {
    if (!latest?.url) return { ok: false, error: '这个平台没有可下载的包' }
    const wc = e.sender
    try {
      const p = await download(latest.url, (got, total) => {
        if (!wc.isDestroyed()) wc.send('update:progress', { got, total })
      })
      await shell.openPath(p)
      return { ok: true, path: p }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 用户在设置里关掉自动检查 → 立刻停掉轮询，不用等重启
  ipcMain.handle('update:reschedule', () => {
    schedule()
    return true
  })
}

/** 按当前开关决定要不要轮询。关掉时把已知的新版本也清掉——
 *  否则界面上会一直挂着一个「有更新」的红点，而用户明确说了不想被打扰。 */
export function schedule(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (!getPrefs().autoUpdateCheck) {
    latest = null
    notifyRenderer()
    return
  }
  setTimeout(() => void checkForUpdate(), FIRST_DELAY_MS)
  timer = setInterval(() => void checkForUpdate(), INTERVAL_MS)
}
