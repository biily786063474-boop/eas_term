// 「多久没动了」的判定。团队面板靠它区分「在跑」和「卡住」——
// 而这是**唯一的卡住信号**：跨进程拿不到子 agent 的内部状态，只能看它多久没吭声。
//
// 纯函数、不引 electron/react，node --test 直接跑。

/** 超过这么久没有任何事件就算「可能卡住」。
 *
 *  定成 4 分钟而不是更短：一个 agent 跑 npm install 或大型测试，安静两三分钟很正常。
 *  也不定更长：等审批那种卡死如果十几分钟才报，人早就走开了。
 *  **它只用来标黄提醒，不用来自动杀** —— 判错的代价必须只是一次多余的提示。 */
export const STALL_MS = 4 * 60 * 1000

export type AgentHealth = 'running' | 'stalled' | 'idle' | 'dead'

/**
 * @param alive        进程还在不在（主进程 SessionRecord.alive）
 * @param lastActiveAt 最后一次有动静的时刻
 * @param busy         这一轮还没跑完（渲染层从事件流算出来的）；拿不到就传 undefined
 */
export function healthOf(
  alive: boolean,
  lastActiveAt: number,
  now: number,
  busy?: boolean
): AgentHealth {
  // 进程没了就是没了，不管多久之前的事 —— 这条要排在最前面，
  // 否则一个刚被空闲回收的会话会因为 lastActiveAt 很新而报成 running
  if (!alive) return 'dead'
  if (busy === false) return 'idle'
  // busy 未知时按「有多久没动」判：这是跨进程唯一拿得到的信号
  return now - lastActiveAt > STALL_MS ? 'stalled' : 'running'
}

/** 面板上那个状态标签。**同一个 idle，对两种会话意思不一样。**
 *
 *  你自己开的对话闲着 = 「空闲」，只是你没在跟它说话。
 *  团队 agent 闲着 = 它这一轮说完了、停下来等下一条输入。
 *
 *  **文案是「这轮完了」而不是「已交活」，这个区别是实测换来的。** busy 只反映
 *  turn 结束，而 turn 结束有两种：真干完了，和「干了一半、这一轮先说到这」——
 *  两者在这个信号上完全一样。2026-08-19 那次 dup-verifier 就报着 idle，
 *  findings.md 的最后一行却写着「结论逐条填充中」。
 *  写成「已交活」等于替它下了一个我们查不到的结论，人看一眼标签就不去读文件了。 */
export function labelOf(h: AgentHealth, team: boolean): string {
  if (h === 'idle' && team) return '这轮完了'
  return LABEL[h]
}

const LABEL: Record<AgentHealth, string> = {
  running: '在跑',
  stalled: '可能卡住',
  idle: '空闲',
  dead: '已停'
}

/** 交活了没有 —— 「这一轮跑完了」，不是「任务做对了」。
 *
 *  `busy === undefined` **不算**：那是「还没跑过任何一轮」，会话刚建起来的样子。
 *  把它当成交活，team_status 的等待模式会在第一次检查就立刻返回，等于没等。
 *  进程没了也算一种结束 —— 它不会再产出什么了，该去读它落下的东西。 */
export function isSettled(alive: boolean, busy: boolean | undefined): boolean {
  if (!alive) return true
  return busy === false
}

/** 时长那一列该从哪一刻算起。**两种语义，按状态切。**
 *
 *  在跑 → 从 startedAt 算，答的是「跑了多久」。
 *  其余 → 从 lastActiveAt 算，答的是「多久没动静」。
 *
 *  给在跑的行显示「多久没动」是没有信息量的：lastActiveAt 每收到一块 stdout 就续期，
 *  那个数字恒趋近 0，显示成「在跑 0s」还会被读成「跑了 0 秒」（2026-08-19 用户
 *  截图指出）。反过来，卡住/已停的行，静默多久正是要判断的东西。 */
export function ageBasis(h: AgentHealth, startedAt: number, lastActiveAt: number): number {
  return h === 'running' ? startedAt : lastActiveAt
}

/** 「4m12s」这种。面板上一列，越短越好读 */
export function fmtAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}m`
}
