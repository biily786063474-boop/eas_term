// 甘特图的任务记录。照 board.ts 的范式：主进程管文件、逐条校验、坏数据整条丢。
//
// 为什么保留期在写入时执行而不是定时器：定时器要考虑休眠唤醒、时钟跳变、
// 多窗口重复触发；而写入时清理天然只在有新数据时发生，没有这些问题。
import { app, ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import type { GanttTask } from '../shared/types'
import { isPtyAlive } from './pty'

const storeFile = (): string => path.join(app.getPath('userData'), 'gantt.json')
const KEEP_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TEXT = 2000

/** 本次主进程运行的 id。模块只在进程启动时加载一次，这行只跑一次——不落盘、
 *  重启即变。gantt:push 用它给每条记录盖章，gantt:list 用它判断一条记录是不是
 *  「更早的运行」留下的。别去 pty.ts 的 ptyId 那一套小整数上做这件事：
 *  那是进程内自增、每次启动都从 1 重来，两次运行完全可能撞出同一个号。 */
const RUN_ID = crypto.randomUUID()

const clip = (s: string): string => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s)

/** 逐条校验。少一个必填字段就整条丢 —— 半条记录跑进 UI 是最难查的那种问题。 */
function valid(t: unknown): t is GanttTask {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.projectId === 'string' &&
    typeof o.ptyId === 'string' &&
    typeof o.leafId === 'string' &&
    typeof o.prompt === 'string' &&
    typeof o.startAt === 'number' &&
    (o.endAt === null || typeof o.endAt === 'number')
  )
}

function load(): GanttTask[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    return Array.isArray(raw) ? raw.filter(valid) : []
  } catch {
    return []
  }
}

function save(list: GanttTask[]): void {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
    fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2))
  } catch (e) {
    console.error('[gantt] 写盘失败', e)
  }
}

/** 保留期在这里执行 */
function prune(list: GanttTask[]): GanttTask[] {
  const cut = Date.now() - KEEP_MS
  return list.filter((t) => t.startAt >= cut)
}

export function registerGanttHandlers(): void {
  ipcMain.handle('gantt:list', () => {
    // endAt 还是 null 分两种情况，不能一概而论，判据要两条都查（或关系，任一命中就是 aborted）：
    //   · runId 跟本次运行的不一致 → 这条记录来自更早的一次运行，一定是上次被强杀留下的
    //     （正常退出会走 finish）。必须先查这条：ptyId 是进程内自增小整数，重启后从 1
    //     重来，可能跟本次运行里全新开的终端撞号——只看 ptyId 会把撞号的旧记录误判成活的。
    //   · runId 一致（就是本次运行产生的）、但 ptyId 已经不在活终端里 → 同一次运行里
    //     pty 被杀但没走到 finish（用户主动关终端 / TerminalView 卸载都走这条路，
    //     见 shared.ts killPanePty 和 collector.ts forgetPty 的注释——它们清内存态时
    //     明确不碰 gantt.finish，把这个判断甩给这里兜底）。
    // 只对命中的打 aborted、endAt 留 null，让 UI 画成开放条。不编一个结束时间——
    // 编出来的数字会被当成真的。
    return load().map((t) =>
      t.endAt === null && (t.runId !== RUN_ID || !isPtyAlive(t.ptyId))
        ? { ...t, aborted: true as const }
        : t
    )
  })

  ipcMain.handle('gantt:push', (_e, t: GanttTask) => {
    if (!valid(t)) return
    const list = prune(load())
    // runId 由主进程盖章，不采信渲染层传来的值（渲染层也确实拿不到这个值，
    // collector.ts 构造 GanttTask 时压根没有这个字段）——写完之后作为
    // 「这条记录属于哪次运行」的唯一真相来源。
    list.push({ ...t, runId: RUN_ID, prompt: clip(t.prompt), follow: t.follow?.map(clip) })
    save(list)
  })

  ipcMain.handle('gantt:finish', (_e, id: string, endAt: number) => {
    const list = load()
    const hit = list.find((t) => t.id === id)
    if (!hit) return
    hit.endAt = endAt
    save(prune(list))
  })

  ipcMain.handle('gantt:follow', (_e, id: string, text: string) => {
    const list = load()
    const hit = list.find((t) => t.id === id)
    if (!hit) return
    hit.follow = [...(hit.follow ?? []), clip(text)]
    save(prune(list))
  })
}
