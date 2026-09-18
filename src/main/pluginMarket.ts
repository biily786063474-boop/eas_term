import { assertPluginPackageIdle } from './pluginHost'
import { invalidatePluginAuthorization } from './pluginAuthorization'
import { replacePluginDirectory } from './pluginReplace.ts'
// 插件市场:主进程编排(网络 IO + 解压 + 落盘)。**纯逻辑在 pluginRegistry / pluginInstall /
// pluginInstallGate,这里只做有副作用的胶水。**
//
// ── 与 plugins.ts 的分界 ──────────────────────────────────────────────────
// plugins.ts 扫的是 **codex / claude 的 CLI 插件**,那条铁律是「只读绝不写」——
// 装它们是 `codex plugin add` 的事,只能预填命令让用户按回车。
// 这里写的是 **自家插件**(cli === 'eas'),落在 app 自己管的 `~/.eas/plugins/<name>/`,
// 由 app 下载/校验/落盘是正当的 —— 但仍守「不静默装」:装前必弹确认框展示权限(两段式)。
//
// ── 安全模型(设计稿 §安全模型六条)──────────────────────────────────────
//   1. 来源信任:registry 里 url 必须 https + 官方域名(parseRegistry 挡);下载前再挡一次
//   2. 写入边界:只许 ~/.eas/plugins/<name>/(guardPluginDir)
//   3. zip-slip:每个 zip 条目过 safeExtractTarget,穿越即拒整包;不还原软链(只写字节)
//   4. sha256 强制:下载内容与 registry 声明不符即拒
//   5. 清单必过:解压后 parseManifest 必须 ok,且权限与 registry 声明一致(防目录谎报)
//   6. 卸载边界:只删 ~/.eas/plugins/<name>/(内置样板与两家 CLI 插件从这里删不了)
import { checkPluginCompatibility, checkPackageRequirements } from './pluginCompatibility.ts'
import { app, net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { guardedHandle } from './ipcGuard'
import { parseManifest } from './pluginManifest.ts'
import { type RegistryEntry } from './pluginRegistry.ts'
import { parseCatalog } from './pluginCatalog.ts'
import type { PluginUnavailableEntry } from '../shared/types'
import { guardPluginDir, verifySha256, packageManifestHash } from './pluginInstall.ts'
import { extractZip } from './pluginUnzip.ts'
import { createInstallGate } from './pluginInstallGate.ts'

// 第一步托管在个人站;切阿里云 OSS/CDN 时把新域名加进来即可(对客户端透明,客户端只认 https + 域名白名单)
const ALLOWED_HOSTS = ['eas.biily.top'] as const
const REGISTRY_URL = process.env.EAS_PLUGIN_REGISTRY_URL || 'https://eas.biily.top/plugins/registry.json'
const REGISTRY_MAX_BYTES = 2 * 1024 ** 2      // registry.json 上限 2MB
const PLUGIN_HARD_CAP = 25 * 1024 ** 2         // 单个插件包硬上限 25MB

const gate = createInstallGate()

// Only advertise implemented capabilities; remote/OAuth are not ready yet.
function currentPluginHost() {
  return { version: app.getVersion(), platform: process.platform, architecture: process.arch, capabilities: ['mcp.stdio', 'config.fields'] }
}


function registryCachePath(): string {
  return path.join(app.getPath('userData'), 'plugin-registry-v2.json')
}
function stagingRoot(): string {
  return path.join(app.getPath('userData'), 'plugin-staging')
}

function httpsHostAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (ALLOWED_HOSTS as readonly string[]).includes(u.hostname)
  } catch {
    return false
  }
}

/** 走 Electron 的 net(遵循系统代理,这台机器 Clash 全局接管;同 updater 的理由)。
 *  累计字节超过 maxBytes 立即 abort —— 下载前就据 registry 声明的 size 卡死上限。 */
function fetchBuffer(url: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    const req = net.request({ url, cache: 'no-cache' })
    const chunks: Buffer[] = []
    let got = 0
    req.on('response', (res) => {
      const status = (res as unknown as { statusCode: number }).statusCode
      if (status !== 200) {
        res.on('data', () => {})
        done(() => reject(new Error(`下载失败:服务器返回 ${status}`)))
        return
      }
      res.on('data', (c: Buffer) => {
        if (settled) return
        got += c.length
        if (got > maxBytes) {
          try {
            req.abort()
          } catch {
            /* 已结束 */
          }
          done(() => reject(new Error('下载体积超过声明上限,已中止')))
          return
        }
        chunks.push(Buffer.from(c))
      })
      res.on('end', () => done(() => resolve(Buffer.concat(chunks))))
      res.on('error', (e: Error) => done(() => reject(e)))
    })
    req.on('error', (e: Error) => done(() => reject(e)))
    req.end()
  })
}

/** 删过期临时目录:gate 里晾着没确认的(过 30 秒)+ staging 下的孤儿(可能上次崩溃留的)。 */
function reapExpiredStaging(): void {
  // rec.dir 是内层 <随机>/<name>,要删的是随机父目录
  for (const rec of gate.sweep()) fs.rmSync(path.dirname(rec.dir), { recursive: true, force: true })
  // 孤儿:staging 下 mtime 超 10 分钟的目录(正常安装几秒内就 commit 或被 gate 清)
  const root = stagingRoot()
  let names: string[] = []
  try {
    names = fs.readdirSync(root)
  } catch {
    return
  }
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const n of names) {
    const p = path.join(root, n)
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true })
    } catch {
      /* 读不到就算了 */
    }
  }
}
/** 拉 registry:先联网,成功就写缓存;失败退回缓存(标 stale)。都没有 → 报错。 */
async function loadRegistry(): Promise<
  { ok: true; entries: RegistryEntry[]; unavailable: PluginUnavailableEntry[]; warnings: string[]; stale: boolean } | { ok: false; error: string }
> {
  // 先尝试联网
  try {
    const buf = await fetchBuffer(REGISTRY_URL, REGISTRY_MAX_BYTES)
    const raw = JSON.parse(buf.toString('utf8'))
    const r = parseCatalog(raw, { allowedHosts: ALLOWED_HOSTS })
    if (r.ok) {
      try {
        fs.mkdirSync(path.dirname(registryCachePath()), { recursive: true })
        fs.writeFileSync(registryCachePath(), buf)
      } catch {
        /* 缓存写不进不致命 */
      }
      return { ok: true, entries: r.entries, unavailable:r.unavailable, warnings: r.warnings, stale: false }
    }
    // 联网拿到了但格式错 —— 退回缓存,别拿坏目录顶替
  } catch {
    /* 网络失败,走缓存 */
  }
  // 缓存兜底
  try {
    const raw = JSON.parse(fs.readFileSync(registryCachePath(), 'utf8'))
    const r = parseCatalog(raw, { allowedHosts: ALLOWED_HOSTS })
    if (r.ok) return { ok: true, entries: r.entries, unavailable:r.unavailable, warnings: r.warnings, stale: true }
  } catch {
    /* 没缓存 */
  }
  return { ok: false, error: '拉取插件目录失败,且本地无缓存' }
}

/** 两个 canvas 权限集是否等价(顺序无关)。registry 声明的权限须与包内清单一致。 */
function sameCanvasPerms(a: readonly string[] | undefined, b: readonly string[]): boolean {
  const sa = new Set(a ?? [])
  const sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const x of sa) if (!sb.has(x)) return false
  return true
}

export type InstallStaged = {
  ok: true
  token: string
  name: string
  displayName: string
  version: string
  size: number
  permissions: string[]
  installed: boolean
}
export type InstallResult = InstallStaged | { ok: false; error: string }

/** 第一段:下载 → 校验 sha256 → 解压临时 → parseManifest → 权限核对 → 返回待确认。落盘留给 commit。 */
async function installStage(name: unknown): Promise<InstallResult> {
  reapExpiredStaging()
  const home = os.homedir()
  const guard = guardPluginDir(name, home)
  if (!guard.ok) return { ok: false, error: guard.reason }

  const reg = await loadRegistry()
  if (!reg.ok) return { ok: false, error: reg.error }
  const entry = reg.entries.find((e) => e.name === name)
  if (!entry) return { ok: false, error: `目录里没有插件「${String(name)}」` }
  const compatible = checkPluginCompatibility(entry.requirements, currentPluginHost())
  if (!compatible.ok) return { ok: false, error: compatible.reason }
  if (!httpsHostAllowed(entry.url)) return { ok: false, error: '下载地址不在允许域名内' }
  if (entry.size > PLUGIN_HARD_CAP) return { ok: false, error: '插件包过大,已拒' }

  let buf: Buffer
  try {
    buf = await fetchBuffer(entry.url, Math.min(entry.size + 64 * 1024, PLUGIN_HARD_CAP))
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!verifySha256(buf, entry.sha256)) return { ok: false, error: '哈希校验不通过,包可能被篡改或损坏' }

  // 临时布局:<stagingRoot>/<随机>/<name>/。**内层目录名必须等于插件名** ——
  // parseManifest 要求 name 等于目录名,解到随机名的目录会被它拒。commit 时搬内层、删随机父。
  const stageParent = path.join(stagingRoot(), `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const dir = path.join(stageParent, entry.name)
  try {
    fs.mkdirSync(dir, { recursive: true })
    await extractZip(buf, dir)
  } catch (e) {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: e instanceof Error ? e.message : '解压失败' }
  }

  // 解压后根部必须直接是 plugin.json
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'))
  } catch {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: '包内根目录缺 plugin.json' }
  }
  const man = parseManifest(raw, dir, { builtin: false, exists: (p) => fs.existsSync(p) })
  if (!man.ok) {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: `清单校验失败:${man.errors.join('；')}` }
  }
  if (man.info.name !== entry.name) {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: '包内插件名与目录声明不一致' }
  }
  const packageCheck = checkPackageRequirements((raw as Record<string, unknown>).requirements, entry.requirements, currentPluginHost())
  if (man.info.version !== entry.version) {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: '包内版本与目录声明不一致，已拒绝安装' }
  }
  if (!packageCheck.ok) {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: packageCheck.reason }
  }
  const canvasPerms = man.info.permissions?.canvas ?? []
  // registry 声明了权限就必须与包内一致(防目录谎报权限);没声明则以包内为准
  if (entry.permissions && !sameCanvasPerms(entry.permissions.canvas, canvasPerms)) {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: '目录声明的权限与包内清单不一致,已拒' }
  }

  const networkPerms=man.info.remote?.approvedOrigins??[]
  if(networkPerms.length&&(!entry.permissions||!sameCanvasPerms(entry.permissions.network,networkPerms))){
    fs.rmSync(stageParent,{recursive:true,force:true})
    return {ok:false,error:'目录声明的远程来源与包内清单不一致'}
  }
  const token = gate.stage({
    manifestSha256: packageManifestHash(raw),
    name: entry.name,
    dir,
    version: entry.version,
    requirements: entry.requirements,
    displayName: man.info.displayName,
    permissions: { canvas: canvasPerms, network: networkPerms } as Record<string, string[]>,
    size: entry.size
  })
  return {
    ok: true,
    token,
    name: entry.name,
    displayName: man.info.displayName,
    version: entry.version,
    size: entry.size,
    permissions: [...canvasPerms,...networkPerms.map(origin=>"连接远程服务："+origin)],
    installed: fs.existsSync(guard.dir)
  }
}

/** 第二段:凭 token 把临时目录原子移入 ~/.eas/plugins/<name>/(已存在则替换 = 更新)。 */
function installCommit(token: unknown): { ok: true; name: string } | { ok: false; error: string } {
  reapExpiredStaging()
  const rec = typeof token === 'string' ? gate.consume(token) : undefined
  if (!rec) return { ok: false, error: '确认已过期,请重新安装' }
  const stageParent = path.dirname(rec.dir) // <随机>,搬完内层后要删它
  const guard = guardPluginDir(rec.name, os.homedir())
  if (!guard.ok) {
    fs.rmSync(stageParent, { recursive: true, force: true })
    return { ok: false, error: guard.reason }
  }
  const target = guard.dir
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(rec.dir, 'plugin.json'), 'utf8'))
    if(!rec.manifestSha256||packageManifestHash(raw)!==rec.manifestSha256)return {ok:false,error:'确认后的插件清单已改变，请重新安装'}
    const check = checkPackageRequirements(raw?.requirements, rec.requirements, currentPluginHost())
    if (!check.ok) return { ok: false, error: check.reason }
    assertPluginPackageIdle(rec.name)
    invalidatePluginAuthorization(rec.name)
    replacePluginDirectory(rec.dir, target)
    return { ok: true, name: rec.name }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '落盘失败' }
  } finally {
    fs.rmSync(stageParent, { recursive: true, force: true }) // 无论成败,清掉随机父目录
  }
}

/** 卸载:只删 ~/.eas/plugins/<name>/。内置样板(resources/plugins)与两家 CLI 插件删不到这。 */
function uninstall(name: unknown): { ok: true } | { ok: false; error: string } {
  const guard = guardPluginDir(name, os.homedir())
  if (!guard.ok) return { ok: false, error: guard.reason }
  if (!fs.existsSync(guard.dir)) return { ok: false, error: '没装这个插件' }
  try {
    assertPluginPackageIdle(String(name))
    invalidatePluginAuthorization(String(name),true)
    fs.rmSync(guard.dir, { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '卸载失败' }
  }
}

export function registerPluginMarketHandlers(): void {
  guardedHandle('plugins:registry', () => loadRegistry())
  guardedHandle('plugins:install', (_e, name: unknown) => installStage(name))
  guardedHandle('plugins:installCommit', (_e, token: unknown) => installCommit(token))
  guardedHandle('plugins:uninstall', (_e, name: unknown) => uninstall(name))
}
