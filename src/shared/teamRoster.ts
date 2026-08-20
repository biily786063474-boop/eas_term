// 团队花名册：这个项目派过哪些批次、每批有谁、各自的任务是什么。
//
// **状态在磁盘，不在上下文。** 这是错误矩阵 E-11 / E-12 的兜底：
//   · E-11 主 agent 上下文被压缩，忘了自己在带团队 —— 方案里这一条的兜底栏原本是空的
//   · E-12 app 重启 / 崩溃 —— 内存里的 sessions Map 全没了
//
// 没有这份记录时，一批 agent 跑完、进程被回收之后，主 agent 就**完全不知道派过活**：
// `team_status` 只看得见还活着的会话，回答不了「我刚才让谁去做什么了」。
// 用户这边同样，重启一次就断片。
//
// 它**不是**当前状态的真相 —— 谁还活着、烧了多少，那些读 sessions Map（进程层）。
// 这里记的是**意图**：派了什么、给谁、什么时候。意图不会因为进程没了就失效，
// 恰恰相反，进程没了之后它才是唯一还在的东西。
//
// 纯函数、不引 electron/fs，node --test 直接跑。

export interface RosterAgent {
  role: string
  /** 派给它的任务原文。**留着才能重派** —— 方案里「重派是一条命令」靠的就是这个 */
  task: string
  /** 起它时用的 CLI；重派时优先用同一个 */
  cli?: string
}

export interface RosterBatch {
  id: string
  at: number
  goal: string
  agents: RosterAgent[]
}

export interface Roster {
  v: 1
  batches: RosterBatch[]
}

/** 最多留几批。够回答「最近这阵子派过什么」，又不会让文件无限长。
 *  超出的丢最旧的 —— 老批次的产出还在 .plans/<role>/ 下，丢的只是索引。 */
export const MAX_BATCHES = 8

export const EMPTY_ROSTER: Roster = { v: 1, batches: [] }

/** 读到的 JSON → 花名册。**任何异常都返回空**：这份文件坏了不该让派活失败，
 *  它是记录不是前提。 */
export function parseRoster(raw: string | null): Roster {
  if (!raw) return EMPTY_ROSTER
  try {
    const j = JSON.parse(raw) as Partial<Roster>
    if (!Array.isArray(j.batches)) return EMPTY_ROSTER
    const batches = j.batches.filter(
      (b): b is RosterBatch =>
        !!b && typeof b.id === 'string' && typeof b.goal === 'string' && Array.isArray(b.agents)
    )
    return { v: 1, batches }
  } catch {
    return EMPTY_ROSTER
  }
}

/** 记一批新的。最新的排在**前面** —— 读的人几乎总是要最近那批。 */
export function addBatch(prev: Roster, batch: RosterBatch): Roster {
  return { v: 1, batches: [batch, ...prev.batches].slice(0, MAX_BATCHES) }
}

/**
 * 给主 agent 的一句话：这个项目最近派过什么。
 *
 * **只在没有活会话时才有意义** —— 有人在跑的时候，`team_status` 报的实时状态
 * 比这份记录准得多。这句话是给「进程都没了、我不记得派过活」那个场景用的。
 */
export function recentSummary(r: Roster, now: number): string {
  const b = r.batches[0]
  if (!b) return ''
  const mins = Math.max(0, Math.round((now - b.at) / 60000))
  const when = mins < 60 ? `${mins} 分钟前` : mins < 1440 ? `${Math.round(mins / 60)} 小时前` : `${Math.round(mins / 1440)} 天前`
  const who = b.agents.map((a) => a.role).join('、')
  return (
    `这个项目 ${when}派过一批：「${b.goal}」——${who}。` +
    `进程已经不在了，**产出在 .plans/<role>/findings.md**，要收活就去读那些文件。` +
    (r.batches.length > 1 ? `（更早还有 ${r.batches.length - 1} 批，记录在 .plans/team.json）` : '')
  )
}
