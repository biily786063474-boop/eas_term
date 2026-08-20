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

export type AgentHealth = 'running' | 'stalled' | 'idle' | 'dead' | 'interrupted' | 'recovering'

/**
 * @param alive        进程还在不在（主进程 SessionRecord.alive）
 * @param lastActiveAt 最后一次有动静的时刻
 * @param busy         这一轮还没跑完（渲染层从事件流算出来的）；拿不到就传 undefined
 */
export function healthOf(
  alive: boolean,
  lastActiveAt: number,
  now: number,
  busy?: boolean,
  ended?: 'ok' | 'interrupted',
  /** 主进程算好的「它自己正在往回爬」。**不要在这里重算退避规则** ——
   *  那份判据在 main/agentChat/sessionState.planRecovery，抄一份必然会分叉。 */
  recovering?: boolean
): AgentHealth {
  // 进程没了就是没了，不管多久之前的事 —— 这条要排在最前面，
  // 否则一个刚被空闲回收的会话会因为 lastActiveAt 很新而报成 running
  //
  // **但「怎么没的」要分开报。** 网络一抖、话说到一半被打断的会话，
  // 跟跑完一轮优雅退出的，在 alive 上完全一样 —— 混在一起报，
  // 用户看到的就是「活没干完却写着这轮完了」（2026-08-20 反馈）。
  if (!alive) {
    if (ended !== 'interrupted') return 'dead'
    // 断了但还会自己爬起来 —— 这时候**不该让人去操作它**。用户的原话：
    // 「我希望子 agent 不打扰用户」。写成「中断了」会招来一次没必要的干预。
    return recovering ? 'recovering' : 'interrupted'
  }
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
  dead: '已停',
  // 它在自己重连，人什么都不用做。**跟「中断了」分开** ——
  // 后者才是「试到头了，该你看一眼」。
  recovering: '重连中',
  // **不叫「已停」** —— 那会让人以为是自己停的或者正常收的工。
  // 中断意味着「这活没干完，产出多半是残的」，措辞必须让人想去看一眼。
  interrupted: '中断了'
}

/** 面板上那一行的状态文字。重连中要带上第几次 —— 没有次数的话，
 *  连着几分钟都写「重连中」，看起来像卡住了。 */
export function stateTextOf(h: AgentHealth, team: boolean, retries?: number): string {
  if (h === 'recovering' && retries) return `重连中 第 ${retries} 次`
  return labelOf(h, team)
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

/** **敢不敢把这个会话的窗口自动收起来。**
 *
 *  收起一个中断的会话 = 把没干完的活从用户眼前藏起来，比不收更糟 ——
 *  所以这里比 isSettled 严：中断的一律留着，让人看见「中断了」这三个字。
 *
 *  `delivered` 来自 teamFindings.deliveredOf（findings.md 写了没）。
 *  拿不到时（非团队会话、或者读文件失败）按 undefined 处理，只看结束方式。 */
export function canAutoTuck(
  alive: boolean,
  ended: 'ok' | 'interrupted' | undefined,
  delivered?: 'missing' | 'thin' | 'ok'
): boolean {
  if (alive) return false
  if (ended !== 'ok') return false
  // 交活判定拿得到就用：正常退出但一个字都没写，同样值得留在眼前
  return delivered === undefined || delivered === 'ok'
}

/** 时长那一列显示多长。**三种语义，按状态切 —— 而且停下来的那两种是定值。**
 *
 *  | 状态 | 显示 | 会不会涨 |
 *  |---|---|---|
 *  | 在跑 | `now - startedAt`，跑了多久 | 涨（它确实在跑） |
 *  | 可能卡住 | `now - lastActiveAt`，静默多久 | 涨（越久越该去看） |
 *  | 这轮完了 / 已停 | `lastActiveAt - startedAt`，这一轮总共跑了多久 | **不涨** |
 *
 *  两处教训都是实测换来的：
 *
 *  ① 给在跑的行显示「多久没动」没有信息量 —— lastActiveAt 每收到一块 stdout 就续期，
 *     那个数字恒趋近 0，显示成「在跑 0s」还会被读成「跑了 0 秒」。
 *  ② **停下来的行不能显示一个还在涨的数。** 一个已经完成的 agent，
 *     「多久没动静」每 2 秒涨一次，看起来像它在越来越卡；而那段时间是我们没去管它，
 *     不是它出了什么事。对停下来的会话，有意义的是它这一轮花了多久 —— 那是定值。
 */
export function ageMsOf(
  h: AgentHealth,
  startedAt: number,
  lastActiveAt: number,
  now: number
): number {
  if (h === 'running') return now - startedAt
  if (h === 'stalled') return now - lastActiveAt
  // idle / dead：这一轮已经收尾了，lastActiveAt 就是它最后一次出声的时刻
  return lastActiveAt - startedAt
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
