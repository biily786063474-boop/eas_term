// 一个「批次」的校验。批次是这套系统的一等公民：**确认的单位、计费的单位、叫停的单位**。
//
// 校验放在纯函数里而不是散在 MCP handler 中，是因为它要挡的是一个跑飞的 agent：
// 它可能一次要开 20 个 agent、可能把 task 写成空字符串、可能角色重名。
// 这些都要在**弹窗之前**挡掉 —— 让用户看到一张荒唐的清单本身就是一种伤害。
//
// 纯函数、不引 electron/react，node --test 直接跑。

/** 一批最多几个 agent。
 *
 *  定 6 而不是更多：CCteam 的默认角色表也就 4–6 个，再多的话
 *  ① 那张确认清单一屏放不下、人不会认真看，② 并行烧的额度不是线性增长而是同时爆发。
 *  真需要更多，分两批 —— 那样每批都会重新确认一次，正是我们要的。 */
export const MAX_AGENTS = 6
/** 角色名长度上限。它要显示在面板一行里，还要当目录名 */
export const ROLE_MAX = 24

export interface AgentSpec {
  /** kebab-case，同时是 .plans/ 下的目录名和面板上的一行 */
  role: string
  /** 派给它的任务，一句话。会作为首条消息的一部分投递过去 */
  task: string
  /** 需要的 CLI 能力。运行时按它匹配可用 CLI —— **不绑 CLI 名字**，
   *  绑了的话那个 CLI 没装就整批起不来（见方案「CLI 兼容」一节） */
  needs?: string[]
  /** 有得选时的偏好，软的 */
  prefer?: string[]
  /** 隔离方式。**只有写码的角色才该要 `worktree`**。
   *
   *  并发写同一个仓库是**静默覆盖**（A 读、B 读、A 写、B 写，A 的改动消失且没人报错，
   *  不是 git 冲突那种至少会吵一声的情况）——方案 E-07，这是第三期唯一的硬障碍。
   *  worktree 让每人一棵独立工作树，改坏了整个删掉，主工作区一个字没动。
   *
   *  **默认 none**：隔离要一份磁盘、一条分支、收活时还要合，只读角色白拿这些代价。 */
  isolation?: 'worktree' | 'none'
}

export interface BatchSpec {
  /** 这一批要达成什么，一句话。用户靠它判断值不值得开工 */
  goal: string
  agents: AgentSpec[]
  /** AI 自己的用量预估（token）。**允许没有**，也不保证准 ——
   *  面板会同时显示真实累计，估不准不要紧，看得见就行 */
  estimateTokens?: number
}

export type BatchCheck = { ok: true; spec: BatchSpec } | { ok: false; error: string }

const ROLE_RE = /^[a-z][a-z0-9-]*$/

/** 校验一批。**一条不合格就整批拒绝**，不做部分放行 ——
 *  半个团队比没有团队更糟（方案 E-03）。 */
export function checkBatch(raw: unknown): BatchCheck {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'batch 必须是一个对象' }
  const b = raw as Record<string, unknown>

  const goal = typeof b.goal === 'string' ? b.goal.trim() : ''
  if (!goal) return { ok: false, error: 'goal 必填：这一批要达成什么，一句话。用户靠它决定要不要开工' }
  if (goal.length > 200) return { ok: false, error: 'goal 太长了（上限 200 字），一句话说清就行' }

  if (!Array.isArray(b.agents) || b.agents.length === 0) {
    return { ok: false, error: 'agents 必填：至少一个 agent，每个要有 role 和 task' }
  }
  if (b.agents.length > MAX_AGENTS) {
    return {
      ok: false,
      error: `一批最多 ${MAX_AGENTS} 个 agent（收到 ${b.agents.length} 个）。分两批派 —— 每批都会重新确认一次`
    }
  }

  const agents: AgentSpec[] = []
  const seen = new Set<string>()
  for (const [i, a0] of b.agents.entries()) {
    if (!a0 || typeof a0 !== 'object') return { ok: false, error: `第 ${i + 1} 个 agent 不是对象` }
    const a = a0 as Record<string, unknown>
    const role = typeof a.role === 'string' ? a.role.trim() : ''
    const task = typeof a.task === 'string' ? a.task.trim() : ''
    if (!ROLE_RE.test(role)) {
      return { ok: false, error: `第 ${i + 1} 个的 role「${role}」不合法：小写字母开头，只能用小写字母、数字、连字符` }
    }
    if (role.length > ROLE_MAX) return { ok: false, error: `role「${role}」太长（上限 ${ROLE_MAX}）` }
    // 重名会让两个 agent 写进同一个 .plans/<role>/ 目录，互相盖掉对方的 findings
    if (seen.has(role)) return { ok: false, error: `role「${role}」重复了 —— 同名的两个 agent 会写进同一个目录、互相覆盖` }
    seen.add(role)
    if (!task) return { ok: false, error: `「${role}」没有 task：派活必须说清干什么，否则它开局就得反问` }
    if (task.length > 500) return { ok: false, error: `「${role}」的 task 太长（上限 500 字），细节写进 .plans/，别塞进首条消息` }

    const needs = Array.isArray(a.needs) ? a.needs.map((x) => String(x)).filter(Boolean) : undefined
    const prefer = Array.isArray(a.prefer) ? a.prefer.map((x) => String(x)).filter(Boolean) : undefined
    // 隔离只认严格的 'worktree'，其余（含没写、写错、大小写不同）一律 none。
    // **不猜**：猜错的方向是给只读角色白建一棵工作树，或者更糟 ——
    // 把写码 agent 当成只读放进主工作区，那就是 E-07 那个静默覆盖
    const isolation = a.isolation === 'worktree' ? ('worktree' as const) : undefined
    agents.push({ role, task, needs, prefer, ...(isolation ? { isolation } : {}) })
  }

  const est = typeof b.estimateTokens === 'number' && b.estimateTokens > 0 ? b.estimateTokens : undefined
  return { ok: true, spec: { goal, agents, estimateTokens: est } }
}
