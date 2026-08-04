// 输入框里粘贴的图片落盘 + 到期清理。
//
// 为什么要落盘：agent（claude / codex）认的是**本地文件路径**。
// 走剪贴板那条老路只能撑一张图，而且你粘完图又复制了别的东西，
// 发送时读到的就是错的——图片一旦离开剪贴板就找不回来了。
//
// 为什么不常驻在项目里：这些图是「说这句话时顺手贴的一张截图」，
// 不是项目资产。塞进 <项目>/assets/img 会把用户的仓库弄脏。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

/** 落脚点：系统临时目录。macOS 自己也会清理这块，等于多一层兜底。 */
function dir(): string {
  return path.join(app.getPath('temp'), 'eas-term-paste')
}

/** 过期阈值。
 *
 *  **不在发送后立刻删**：agent 是异步读文件的，命令排在它的队列里，
 *  可能几十秒甚至更久之后才轮到读图，删早了它只会看到「文件不存在」。
 *  24 小时既够 agent 读完、也够人回头翻，还不至于攒成一堆。 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** 单张上限。正常截图撑死几 MB，超过这个数基本是拖错了文件（视频 / 磁盘镜像）。 */
const MAX_BYTES = 24 * 1024 * 1024

const EXT_OK = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/** 传进来的路径是不是真的落在我们自己的临时目录里。
 *
 *  渲染层给什么路径主进程就删什么，等于把 unlink 开放给了渲染层。
 *  symlink 会让「字符串前缀比对」形同虚设，所以要解析到真实路径再比。 */
function insideOurDir(p: string): boolean {
  try {
    const root = fs.realpathSync(dir())
    const real = fs.realpathSync(p)
    return real.startsWith(root + path.sep)
  } catch {
    return false
  }
}

/** 启动时扫一遍，把过期的删掉。失败一律忽略——清理不成功也不该拦着应用启动。 */
export function sweepPasteImages(): void {
  const root = dir()
  let names: string[]
  try {
    names = fs.readdirSync(root)
  } catch {
    return // 目录还不存在 = 没什么可清的
  }
  const now = Date.now()
  let gone = 0
  for (const name of names) {
    const p = path.join(root, name)
    try {
      if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(p)
        gone++
      }
    } catch {
      /* 单个文件删不掉不影响其余 */
    }
  }
  if (gone && !app.isPackaged) console.log(`[paste-image] 清掉 ${gone} 张过期图片`)
}

export function registerPasteImageHandlers(): void {
  // 粘贴 / 拖入的图片字节 → 临时文件，返回绝对路径
  ipcMain.handle(
    'pasteImage:save',
    async (
      _e,
      bytes: Uint8Array,
      ext: string
    ): Promise<{ ok: boolean; error?: string; path?: string }> => {
      try {
        const e = (ext || 'png').toLowerCase().replace(/^\./, '')
        if (!EXT_OK.has(e)) return { ok: false, error: `不支持的图片格式：${e}` }
        if (!bytes?.byteLength) return { ok: false, error: '图片是空的' }
        if (bytes.byteLength > MAX_BYTES)
          return { ok: false, error: `图片太大（${(bytes.byteLength / 1048576).toFixed(1)}MB）` }

        const root = dir()
        await fs.promises.mkdir(root, { recursive: true })
        const d = new Date()
        const p2 = (n: number): string => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
        let file = path.join(root, `paste-${stamp}.${e}`)
        for (let i = 2; fs.existsSync(file); i++) file = path.join(root, `paste-${stamp}-${i}.${e}`)
        await fs.promises.writeFile(file, bytes)
        return { ok: true, path: file }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // 从输入框叉掉某张图 → 立刻删。没发出去的东西不该在磁盘上留着。
  ipcMain.handle('pasteImage:remove', async (_e, p: string): Promise<boolean> => {
    if (!p || !insideOurDir(p)) return false // 拖进来的外部文件不归我们删
    try {
      await fs.promises.unlink(p)
      return true
    } catch {
      return false
    }
  })
}
