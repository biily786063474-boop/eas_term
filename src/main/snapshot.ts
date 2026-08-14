// 画板快照：截主窗口的指定区域，写进项目的 screenshot/ 下。
//
// 为什么是主进程截而不是渲染层用 canvas 画：画布上跑着活终端（xterm 渲染到 canvas）
// 和内嵌网页（webview），渲染层没法把它们画进一张图 —— 只有 capturePage 拿得到合成后的结果。
import { ipcMain } from 'electron'
import fs from 'fs'
import { snapshotTarget } from './snapshotPaths'
import { mainWindow } from './island'
import { guardDir } from './fsGuard'
import type { SnapshotRect, SnapshotResult } from '../shared/types'

// 并发互斥：IPC 可以被连续触发（防连点是渲染层的事，这一层管不着、也不该指望它）。
// snapshotTarget 是纯函数，序号对不对完全取决于调用方喂给它的 existing 是不是当下最新的
// 目录内容。如果两次 canvas:snapshot 同一秒内并发跑「读目录→算序号→写文件」，
// 后一次很可能在前一次写完之前就读了目录，两次算出同一个文件名——后一张真的会覆盖前一张。
// Electron 主进程是单线程 event loop，不需要真正的锁，用一条 Promise 队列做进程内互斥
// 就够：下一个任务必须等上一个彻底落盘（不管成功失败）之后，才轮到它去读目录。
let snapshotQueue: Promise<unknown> = Promise.resolve()
function withSnapshotLock<T>(task: () => Promise<T>): Promise<T> {
  const result = snapshotQueue.then(task, task)
  // 队列本身永远不进入 rejected 态——否则某一次失败会连锁卡住后面所有排队的调用。
  // 真正的成功/失败通过 result 单独交给这次调用的调用方，不经队列传递。
  snapshotQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export function registerSnapshotHandlers(): void {
  ipcMain.handle(
    'canvas:snapshot',
    async (_e, projectPath: string, rect: SnapshotRect): Promise<SnapshotResult> => {
      try {
        // 路径校验走仓库既有的 fsGuard（和 fs.ts 里 rename/trash/mkdir 等 9 处同一套），
        // 不是自己另起一套 isAbsolute 判断：projectPath 完全由渲染层传入，这个面和那 9 处
        // 同类——都是「渲染层传路径、主进程要写盘」。guardDir 自带 isAbsolute 检查、
        // 自带 realResolve 防软链绕过（项目里塞一个指向别处的软链，字符串前缀比对会被绕过），
        // 白名单 = projects.json 里已注册的项目根 + 知识库根。
        const guard = guardDir(projectPath)
        if (!guard.ok) return { ok: false, error: guard.error }
        // 后续所有路径运算都用 guard.path（解析过真实路径的那份），不再用原始 projectPath——
        // 用回原始值会让上面防软链的检查白做：real path 校验通过了，但实际写盘、
        // 读目录都还是奔着软链指向的地方去。
        const projRoot = guard.path
        // guardDir 不查存在性（realResolve 对不存在的目标会退到最深的真实祖先，
        // 所以哪怕整个项目目录已经被删掉，guardDir 仍可能判定「在白名单范围内」）。
        // 这道单独补上，给用户一个比「路径不在任何项目或知识库目录内」更好懂的提示。
        if (!fs.existsSync(projRoot)) return { ok: false, error: '项目目录不存在了' }
        const win = mainWindow()
        if (!win) return { ok: false, error: '找不到主窗口' }
        // NaN/Infinity 防护：rect 来自渲染层测量 DOM 得到的数字，节点还没挂载时量出来的
        // 就是 NaN——Math.round(NaN) 还是 NaN，而 `NaN < 1` 恒为 false，下面的尺寸校验对
        // NaN 完全失效，得在取整前单独挡一道。
        if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
          return { ok: false, error: '截图区域参数不对' }
        }
        // 取整：capturePage 的 rect 只接受整数，小数会被静默取整、截偏一两像素
        const r = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
        if (r.width < 1 || r.height < 1) return { ok: false, error: '画布区域太小，截不了' }

        const img = await win.webContents.capturePage(r)
        const buf = img.toPNG()
        if (!buf.byteLength) return { ok: false, error: '截出来是空的' }

        // 算目录/序号 + 写盘必须互斥（见上面 withSnapshotLock 的注释），
        // 否则并发调用会把彼此的文件序号算重、后一张覆盖前一张。
        return await withSnapshotLock(async () => {
          const now = new Date()
          // 先算目录，读一次当天已有的文件名，再算序号
          const probe = snapshotTarget(projRoot, now, [])
          let existing: string[] = []
          try {
            existing = fs.readdirSync(probe.dir)
          } catch (err) {
            // 只有「目录还不存在」才是当天第一张这种正常情况。别的错误类型不能吞：
            // ENOTDIR（项目下已经有个叫 screenshot 的同名文件，macOS 默认大小写不敏感，
            // 撞上不算稀奇）、EACCES（目录在但读不了）如果也被当成「existing=[]」，
            // 算出来的序号可能其实已经被占用——EACCES 那种情况下 mkdir({recursive:true})
            // 对已存在目录还是幂等不报错，writeFile 会静默覆盖用户的旧图，
            // 正是这个文件里那把锁想防的同一类覆盖，只是触发路径换成了权限误判而不是并发。
            if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
          }
          const target = snapshotTarget(projRoot, now, existing)
          await fs.promises.mkdir(target.dir, { recursive: true })
          await fs.promises.writeFile(target.file, buf)
          return { ok: true, path: target.file }
        })
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        // 上面重新抛出的 ENOTDIR/EACCES 之类都是 Node 原生的 fs 错误，带 .code，
        // 消息本身是英文——补一句中文前缀，别让用户看着一行陌生的英文报错干瞪眼
        const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
        return { ok: false, error: code ? `写入快照失败：${raw}` : raw }
      }
    }
  )
}
