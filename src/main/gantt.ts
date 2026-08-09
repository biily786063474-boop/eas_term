// 甘特图的任务记录。照 board.ts 的范式：主进程管文件、逐条校验、坏数据整条丢。
//
// 为什么保留期在写入时执行而不是定时器：定时器要考虑休眠唤醒、时钟跳变、
// 多窗口重复触发；而写入时清理天然只在有新数据时发生，没有这些问题。
import { app, ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import type { GanttClearRange, GanttTask } from '../shared/types'
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

// **注意这里的 filter(valid) 有个连带效果**：所有写路径（push/finish/follow/remove/clear）
// 都是「load() → 改 → save()」，而 load 会滤掉校验不过的记录，于是**任何一次写入都会
// 顺手把磁盘上的坏记录一起清掉**。实测：9 条里 3 条不合法时，删 1 条之后磁盘剩 5 条。
//
// 这是有意保留的行为，不是 bug —— 坏记录本来就不显示、不参与任何计算，留着只占地方。
// 但它是个**静默副作用**，写在这里免得以后有人查「为什么删一条少四条」时白找一圈。
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
//
// 抽成公共函数（原来只有 gantt:list 一个调用点）：Task 16 新增 gantt:remove/
// gantt:clear 都要把结果直接回给渲染层用于 setTasks，如果各自重复这段判断，
// 删一条不相关的记录会顺带让另一条正在跑的任务的 aborted 判定结果不一致
// （比如三处判断逻辑以后改岔了），表现为「删完之后有条任务颜色跳了一下」。
function withAbortedFlag(list: GanttTask[]): GanttTask[] {
  return list.map((t) =>
    t.endAt === null && (t.runId !== RUN_ID || !isPtyAlive(t.ptyId))
      ? { ...t, aborted: true as const }
      : t
  )
}

/** 任务是否落在 [from, to] 范围内——供 gantt:clear 的「清空当前范围」用。
 *  判据跟渲染层判断「要不要画进这个窗口」（GanttStage.tsx 的 byProject）是同一套
 *  口径：还没结束的任务按「到现在」算结束端，不编一个更早或更晚的假结束时间。 */
function overlapsRange(t: GanttTask, from: number, to: number): boolean {
  const end = t.endAt ?? Date.now()
  return end >= from && t.startAt <= to
}

export function registerGanttHandlers(): void {
  ipcMain.handle('gantt:list', () => withAbortedFlag(load()))

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

  // 用户自行删除错误数据（2026-08-08 新需求）：单条删除。找不到这个 id 就当没这回事——
  // 不当错误处理，调用方（渲染层）传的 id 本来就来自它自己刚拿到的列表，正常不会落空，
  // 落空多半是短时间内两处操作重叠（比如快速连点两次同一条的删除），静默忽略即可。
  ipcMain.handle('gantt:remove', (_e, id: string) => {
    const list = load().filter((t) => t.id !== id)
    save(list)
    return withAbortedFlag(list)
  })

  // 批量清理：不传 range = 清空全部；传了就只清 [from, to] 内的。range 字段类型不对
  // （渲染层理论上不会传出这种调用，这里只是不信任边界）时保守地什么都不删，而不是
  // 静默滑向「清空全部」——批量删除这种不可逆操作，参数存疑就该是no-op，不是最大杀伤。
  ipcMain.handle('gantt:clear', (_e, range?: GanttClearRange) => {
    let list: GanttTask[]
    if (range === undefined) {
      list = []
    } else if (Number.isFinite(range.from) && Number.isFinite(range.to)) {
      list = load().filter((t) => !overlapsRange(t, range.from, range.to))
    } else {
      list = load()
    }
    save(list)
    return withAbortedFlag(list)
  })
}
