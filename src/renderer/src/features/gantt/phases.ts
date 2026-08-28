// 把「一条一条的发送记录」切成「一段一段的工作阶段」。
//
// 规则来自用户 2026-08-27 的原话：「当最后 AI 输出后，30 分钟内无输入，
// 则判定为阶段性结束，结束时间以最后一次返回为准」。翻成可执行的判据：
// 同一项目的记录按时间排好，只要 `下一条.startAt − 目前为止的最晚结束 ≥ 30 分钟`
// 就切一刀；段的开始 = 段内第一条的 startAt，段的结束 = 段内最晚的结束。
//
// **按项目整体算，终端和 AI 对话合流。** 用户原话是「把项目激活终端**或者**
// AI 对话的时间囊括进去」—— 一个项目同一时刻可能既开着终端又开着 AI 对话，
// 它们属于同一次「坐下来干活」，分开算会把一段拆成两段互相错开的。
// 代价是：在同一个项目里边跑长任务边问别的，会被合成一段。这是用户选的口径。
//
// **不能用「上一条的 endAt」当断点基准，要用「目前为止的最晚结束」** ——
// 合流之后同一项目的任务会重叠（终端在跑的同时 AI 对话回了一条），
// 按上一条算的话，一条短任务排在长任务后面就会被误判成新阶段。
//
// 本机 713 条真实记录实算：切出 111 段，中位数 51 分钟，最长 8.8 小时。
import type { GanttTask } from '../../../../shared/types'

/** 静默多久算一个阶段结束。**先写死不做成设置项** —— 用户 2026-08-27 拍板
 *  「少一个旋钮，不合适再加」。改这个数会显著改变图的样子：本机数据里
 *  15 分钟 → 约 170 段，60 分钟 → 约 80 段。 */
export const PHASE_GAP_MS = 30 * 60 * 1000

export interface Phase {
  /** 稳定 id：同一批数据重算得到同一个值，React key 用它 */
  id: string
  projectId: string
  startAt: number
  /** 段的结束 = 段内最晚的一次返回。段里还有任务在跑时它等于 now */
  endAt: number
  /** 段内有还没结束的任务（真在跑，不含 aborted） */
  running: boolean
  /** 段内有被强杀、结束时间不可知的任务 —— 这一段的 endAt 是**下限**不是真值 */
  hasAborted: boolean
  /** 段内的记录，按 startAt 升序 */
  tasks: GanttTask[]
}

/**
 * 一条记录对「阶段延伸到什么时候」的贡献。
 *
 * 三种情况必须分开，一概而论会出事：
 * · 正常结束 → endAt，就是那个时刻
 * · **真在跑**（endAt=null 且没有 aborted 标记）→ now，它确实还在占着时间
 * · **被强杀**（aborted）→ 只算到 startAt。主进程明确「不编一个结束时间」
 *   （见 main/gantt.ts withAbortedFlag），如果这里跟渲染开放条一样按 now 算，
 *   三天前一条被强杀的记录会把它之后该项目的**每一个阶段**都吞进同一段里 ——
 *   本机此刻就有 4 条这种记录，不是假想。
 */
function endOf(t: GanttTask, now: number): number {
  if (t.endAt !== null) return t.endAt
  return t.aborted ? t.startAt : now
}

/** 按项目切阶段。输入不要求有序，内部自己排。 */
export function groupPhases(
  tasks: GanttTask[],
  now: number,
  gapMs: number = PHASE_GAP_MS
): Map<string, Phase[]> {
  const byProject = new Map<string, GanttTask[]>()
  for (const t of tasks) {
    const arr = byProject.get(t.projectId)
    if (arr) arr.push(t)
    else byProject.set(t.projectId, [t])
  }

  const out = new Map<string, Phase[]>()
  for (const [projectId, list] of byProject) {
    const sorted = [...list].sort((a, b) => a.startAt - b.startAt)
    const phases: Phase[] = []
    let cur: GanttTask[] = []
    let curEnd = 0

    const flush = (): void => {
      if (!cur.length) return
      const startAt = cur[0].startAt
      phases.push({
        id: `ph-${projectId}-${startAt}`,
        projectId,
        startAt,
        // 至少和开始一样大 —— 全是 aborted 的段会退化成零长，不让它变成负数
        endAt: Math.max(curEnd, startAt),
        running: cur.some((t) => t.endAt === null && !t.aborted),
        hasAborted: cur.some((t) => t.aborted === true),
        tasks: cur
      })
      cur = []
      curEnd = 0
    }

    for (const t of sorted) {
      if (cur.length && t.startAt - curEnd >= gapMs) flush()
      cur.push(t)
      curEnd = Math.max(curEnd, endOf(t, now))
    }
    flush()
    if (phases.length) out.set(projectId, phases)
  }
  return out
}

/** 「2h10m」「51m」这种时长写法。给条上的标签和 hover 共用，别各写一份。 */
export function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h${String(r).padStart(2, '0')}m` : `${h}h`
}
