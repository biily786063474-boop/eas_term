// 画板快照：截主窗口的指定区域，写进项目的 screenshot/ 下。
//
// 为什么是主进程截而不是渲染层用 canvas 画：画布上跑着活终端（xterm 渲染到 canvas）
// 和内嵌网页（webview），渲染层没法把它们画进一张图 —— 只有 capturePage 拿得到合成后的结果。
import { BrowserWindow, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { snapshotTarget } from './snapshotPaths'
import { isIslandWindow } from './island'
import type { SnapshotRect, SnapshotResult } from '../shared/types'

/** 主窗口（排除灵动岛那个）。和 island.ts:40 同一个判据 */
function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !isIslandWindow(w)) ?? null
}

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
        if (!projectPath || !path.isAbsolute(projectPath)) return { ok: false, error: '项目路径不对' }
        if (!fs.existsSync(projectPath)) return { ok: false, error: '项目目录不存在了' }
        const win = mainWindow()
        if (!win) return { ok: false, error: '找不到主窗口' }
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
          const probe = snapshotTarget(projectPath, now, [])
          let existing: string[] = []
          try {
            existing = fs.readdirSync(probe.dir)
          } catch {
            /* 目录还不存在 = 当天第一张 */
          }
          const target = snapshotTarget(projectPath, now, existing)
          await fs.promises.mkdir(target.dir, { recursive: true })
          await fs.promises.writeFile(target.file, buf)
          return { ok: true, path: target.file }
        })
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
