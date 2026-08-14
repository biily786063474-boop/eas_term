// 「一个终端此刻在干什么」的唯一真相。
//
// **纯函数，不引 React / electron / store。** 只吃一份只读快照吐结果，
// 所以 node --test 能直接加载它（见 package.json 的 test 脚本）。
// 这不是洁癖：迁移规则和聚合规则写错了不会崩、不会报错，只会让人在某个时刻
// 少看到一条该看到的提醒——那种错只有测试抓得住。
//
// 判据一律**只看当前信号**，不看历史、不自己记状态。写成「刚从 running 落下」
// 那种历史依赖的话，状态机就得自己维护一份状态再跟 store 对齐，
// 那正是这次要消灭的东西。runningPtys 的维护时机（spinner 起落）已经在
// TerminalView 里做好了，本模块只读不写。
import { collectLeaves } from '../../layout.ts'

export type TermState = 'running' | 'approval' | 'done'

/** store 里那六个字段的只读快照。由 useStatus.ts 取好传进来——本模块不认识 store。 */
export interface RawSignals {
  runningPtys: string[]
  attentionPtys: string[]
  ptyApproval: Record<string, { question?: string } | undefined>
  ptyTiming: Record<string, { lastDoneAt?: number; roundStart?: number } | undefined>
}

/** locate 需要的上下文。同样是只读快照。 */
export interface LocateCtx {
  tabs: { id: string; projectId?: string | null; title?: string; root: unknown }[]
  frames: { id: string; nodes: { id: string; leafId?: string; name?: string }[] }[]
  projects: { id: string; name: string; path?: string }[]
}

/** 一个终端在应用里的落点 */
export interface Located {
  ptyId: string
  tabId: string
  leafId: string
  projectId: string | null
  project: string
  term: string
  frameId?: string
  nodeId?: string
}

/** 项目那一行显示什么 */
export interface ProjectRow {
  projectId: string
  /** 最紧急的那个状态 */
  top: TermState
  /** 该项目处于 top 这个状态的终端个数 */
  count: number
  /** 点这一行要聚焦到哪个终端 */
  focusPtyId: string
  /** 最近一次变化的时刻，同档排序用 */
  at: number
}

/** 紧急程度。数字越小越急——排序和「取最紧急的那个」都用它，只有一处定义。 */
const URGENCY: Record<TermState, number> = { approval: 0, done: 1, running: 2 }

/**
 * 这个终端此刻是什么状态。
 *
 * **`attentionPtys` 是权威**：它回答「有没有待处理」，`ptyApproval` 只回答
 * 「待处理的内容是什么」。所以 ptyApproval 有残留值但 attentionPtys 里没有该 ptyId 时，
 * 状态是 null 而不是 approval——两者的「同生共死」是调用点手动维护的约定，
 * 不是结构保证，残留是可能的。
 */
export function statusOf(ptyId: string, raw: RawSignals): TermState | null {
  if (raw.runningPtys.includes(ptyId)) return 'running'
  if (!raw.attentionPtys.includes(ptyId)) return null
  return raw.ptyApproval[ptyId] ? 'approval' : 'done'
}

/** 剥掉标题开头的 spinner：agent 干活时会把转圈字符写进标题，
 *  带着它显示会让名字每 100ms 抖一下。 */
export function cleanTitle(s: string): string {
  return s.replace(/^[⠀-⣿◐-◓◴-◷\s✳✴✶✻✽✹*]+/u, '').trim()
}

/** 从快照解出某个 pty 的落点；找不到（终端已关）返回 null */
export function locate(ptyId: string, ctx: LocateCtx): Located | null {
  for (const t of ctx.tabs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const leaf of collectLeaves(t.root as any)) {
      if (leaf.pane.kind !== 'terminal') continue
      if ((leaf.pane as { ptyId: string }).ptyId !== ptyId) continue
      const frame = ctx.frames.find((f) => f.nodes.some((n) => n.leafId === leaf.id))
      const node = frame?.nodes.find((n) => n.leafId === leaf.id)
      const project = ctx.projects.find((p) => p.id === t.projectId)
      return {
        ptyId,
        tabId: t.id,
        leafId: leaf.id,
        projectId: t.projectId ?? null,
        project: project?.name ?? '未归属',
        term: cleanTitle(node?.name || t.title || '') || '终端',
        frameId: frame?.id,
        nodeId: node?.id
      }
    }
  }
  return null
}

/**
 * 按项目聚合：每个项目一行，显示最紧急的那个状态 + 该状态的终端个数，
 * 点击落到最紧急的那个终端。
 *
 * 查不到所属项目的终端**直接跳过**，不产生行也不抛异常——
 * 终端可能刚被关掉，而状态数组是上一帧的。
 */
export function byProject(ptyIds: string[], raw: RawSignals, ctx: LocateCtx): ProjectRow[] {
  const acc = new Map<string, ProjectRow>()
  for (const ptyId of ptyIds) {
    const st = statusOf(ptyId, raw)
    if (!st) continue
    const loc = locate(ptyId, ctx)
    if (!loc?.projectId) continue
    const at = raw.ptyTiming[ptyId]?.lastDoneAt ?? raw.ptyTiming[ptyId]?.roundStart ?? 0
    const cur = acc.get(loc.projectId)
    if (!cur) {
      acc.set(loc.projectId, { projectId: loc.projectId, top: st, count: 1, focusPtyId: ptyId, at })
      continue
    }
    if (URGENCY[st] < URGENCY[cur.top]) {
      // 出现了更急的：整行改成它，计数从 1 重新起（count 数的是 top 这一档的个数）
      acc.set(loc.projectId, { projectId: loc.projectId, top: st, count: 1, focusPtyId: ptyId, at })
    } else if (st === cur.top) {
      cur.count += 1
      // focusPtyId 跟着 at 走：只有严格更新（更近）时才换，两个都撞在同一时刻（含都是 0）
      // 时保留先到的那个——这样行内的「最近变化」和「点下去去哪」指的是同一个终端。
      if (at > cur.at) {
        cur.at = at
        cur.focusPtyId = ptyId
      }
    }
  }
  return [...acc.values()]
}

/** approval > done > running；同档内按最近变化时间倒序 */
export function sortRows(rows: ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => URGENCY[a.top] - URGENCY[b.top] || b.at - a.at)
}
