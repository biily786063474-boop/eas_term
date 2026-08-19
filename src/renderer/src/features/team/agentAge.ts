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
