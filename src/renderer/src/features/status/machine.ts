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

/** 项目那一行显示什么。
 *
 *  **`top`/`count` 与 `attn` 是两件正交的事，别把其中一个当成另一个的简写：**
 *  前者说「这个项目里的终端此刻在干什么」（三态，running 优先），
 *  后者说「有几个在等你过去」。两者会不一致，而且那是对的——
 *  agent 调 MCP `notify` 或响铃的时候它还在跑，`top` 是 `running`，但它确实在叫你。
 *  收编进状态机时这里一度只有 `top`，于是四个面统一写成 `top !== 'running'`，
 *  把「还在跑但叫了你」整类过滤掉了（`mcpHandler` 的 notify 因此三处都不亮）。 */
export interface ProjectRow {
  projectId: string
  /** 最紧急的那个**执行状态** */
  top: TermState
  /** 该项目处于 top 这个状态的终端个数 */
  count: number
  /** 这个项目里有几个终端「在等你」（∈ attentionPtys）——**不管它跑没跑**。
   *  「要不要显示提醒」一律判这个，不判 top。 */
  attn: number
  /** 点这一行要聚焦到哪个终端。
   *  有人在等你就去他那儿（同 attn 的口径，多个就取最急、同档取最近的）；
   *  一个都没有才退回「top 这一档里最近变化的那个」。 */
  focusPtyId: string
  /** 最近一次变化的时刻，同档排序用 */
  at: number
}

/** 紧急程度。数字越小越急——排序和「取最紧急的那个」都用它，只有一处定义。 */
const URGENCY: Record<TermState, number> = { approval: 0, done: 1, running: 2 }

/**
 * 排序口径：approval > done > running；同档内按最近变化时间倒序。
 *
 * **这是唯一的一处定义。** 项目行（sortRows）、右上角待处理列表、灵动岛的通知队列
 * 都拿它排——灵动岛原来手写了一份「approval 优先、同类新在前」，那就是 URGENCY 的
 * 第二份定义，改一处漏一处就会出现「同一批东西在两个面上顺序不同」这种没人会报上来的错。
 *
 * 签名写成四个参数而不是收 `{ state, at }` 对象：三个调用方的行类型里这两个字段
 * 名字各不相同（`ProjectRow.top` / `PendingRow.state` / `IslandNotice.kind`），
 * 统一形状就得在 comparator 里为每次比较造临时对象。
 */
export function urgencyCmp(aState: TermState, aAt: number, bState: TermState, bAt: number): number {
  return URGENCY[aState] - URGENCY[bState] || bAt - aAt
}

/**
 * 这一条待处理是「等你批准」还是「跑完了」。**不判 running。**
 *
 * **`attentionPtys` 是权威**：它回答「有没有待处理」，`ptyApproval` 只回答
 * 「待处理的内容是什么」。所以 ptyApproval 有残留值但 attentionPtys 里没有该 ptyId 时，
 * 返回 null——两者的「同生共死」是调用点手动维护的约定，不是结构保证，残留是可能的。
 *
 * 单独导出是给**通知**用的（灵动岛的通知卡）。三态讲的是「这个终端此刻在干什么」，
 * running 优先；而一条通知讲的是「agent 举手要你看一眼」，两者正交——举手的时候
 * 它完全可能还在跑：`flagAttention` 的三个源里，`TerminalView` 的 `onBell` 和
 * `mcpHandler` 的 MCP `notify` 都能在 spinner 还转着的时候触发，后者甚至是常态
 * （agent 调工具时当然还在跑）。通知卡若改按 statusOf 判，这类整条消失。
 *
 * 注意这两条判据只有这一份实现：statusOf 就是「running 优先 + 这个函数」。
 */
export function attentionKindOf(ptyId: string, raw: RawSignals): 'approval' | 'done' | null {
  if (!raw.attentionPtys.includes(ptyId)) return null
  return raw.ptyApproval[ptyId] ? 'approval' : 'done'
}

/**
 * 这个终端此刻是什么状态。三态互斥，running 优先——spinner 又转起来了说明
 * 上一轮那条待处理已经不成立（残留没人清），以当前信号为准。
 */
export function statusOf(ptyId: string, raw: RawSignals): TermState | null {
  if (raw.runningPtys.includes(ptyId)) return 'running'
  return attentionKindOf(ptyId, raw)
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
 * 按项目聚合：每个项目一行，显示最紧急的那个执行状态 + 该状态的终端个数 +
 * 有几个在等你，点击落到「该去的那一个」。
 *
 * 查不到所属项目的终端**直接跳过**，不产生行也不抛异常——
 * 终端可能刚被关掉，而状态数组是上一帧的。
 */
export function byProject(ptyIds: string[], raw: RawSignals, ctx: LocateCtx): ProjectRow[] {
  const acc = new Map<string, ProjectRow>()
  /** 每个项目「最该去的那个在等你的终端」。单独挑，不跟着 top 走——
   *  top 是执行状态的档位，而一个 running 的终端完全可以同时在等你。 */
  const waiting = new Map<string, { ptyId: string; urgency: number; at: number }>()
  for (const ptyId of ptyIds) {
    const st = statusOf(ptyId, raw)
    if (!st) continue
    const loc = locate(ptyId, ctx)
    if (!loc?.projectId) continue
    const pid = loc.projectId
    const at = raw.ptyTiming[ptyId]?.lastDoneAt ?? raw.ptyTiming[ptyId]?.roundStart ?? 0
    const cur = acc.get(pid)
    if (!cur) {
      acc.set(pid, { projectId: pid, top: st, count: 1, attn: 0, focusPtyId: ptyId, at })
    } else if (URGENCY[st] < URGENCY[cur.top]) {
      // 出现了更急的：top / count / at 整档换成它（count 数的是 top 这一档的个数）。
      // **attn 不跟着重置**——它数的是「有几个在等你」，跟 top 落在哪一档无关。
      cur.top = st
      cur.count = 1
      cur.focusPtyId = ptyId
      cur.at = at
    } else if (st === cur.top) {
      cur.count += 1
      // focusPtyId 跟着 at 走：只有严格更新（更近）时才换，两个都撞在同一时刻（含都是 0）
      // 时保留先到的那个——这样行内的「最近变化」和「点下去去哪」指的是同一个终端。
      if (at > cur.at) {
        cur.at = at
        cur.focusPtyId = ptyId
      }
    }
    if (!attentionKindOf(ptyId, raw)) continue
    acc.get(pid)!.attn += 1
    const w = waiting.get(pid)
    const u = URGENCY[st]
    // 最急优先，同档取最近的；同档同时刻保留先到的（与上面 focusPtyId 同一条规则）
    if (!w || u < w.urgency || (u === w.urgency && at > w.at)) {
      waiting.set(pid, { ptyId, urgency: u, at })
    }
  }
  // 有人在等你 → 点这一行就去他那儿。没有等你的（纯 running 的项目）才保留上面那个落点。
  // 两者在「没有 running 却有人等你」时本来就同一个终端，这一步只在
  // 「top 是 running、但某个 running 的终端叫了你」时才真正改变落点。
  for (const [pid, w] of waiting) acc.get(pid)!.focusPtyId = w.ptyId
  return [...acc.values()]
}

/** approval > done > running；同档内按最近变化时间倒序（口径见 urgencyCmp） */
export function sortRows(rows: ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => urgencyCmp(a.top, a.at, b.top, b.at))
}
