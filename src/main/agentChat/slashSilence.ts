// 「切模型/切强度的回执不显示」这件事的状态机。纯函数、零 import，可单测。
//
// 背景：切模型 / 切强度是给 CLI 发 `/model`、`/effort` 这类 slash command 做到的。
// CLI 会用一条普通的助手消息回执——「Set effort level to high (this session only): …」，
// 一条条铺在对话区里。用户拨一次强度滑块就多出五六条，把真正的对话顶没了。
// 这些回执对人没有信息量：他刚在滑块上把强度拨到 high，不需要 CLI 用英文再讲一遍。
//
// **判据是「这个 turn 是我们自己发的 slash 引出来的」，与文案无关。**
// 按 /^Set effort level/ 匹配文案是那种今天好使、CLI 一升级就悄悄失效的写法，
// 而且它还分语言。

export interface SilenceState {
  /** 还要吞掉几个 turn */
  turns: number
  /** 兜底截止时刻（ms epoch）。undefined = 没有静默期 */
  until?: number
}

export const NO_SILENCE: SilenceState = { turns: 0 }

/** 超时兜底 8 秒。slash 回执实测都在 1 秒内返回，8 秒是很宽的余量。 */
export const SILENCE_TIMEOUT_MS = 8000

/** 发出 n 条 slash 之后进入静默期。每条会引出一个带回执的 turn。 */
export function silenceAfterSlash(st: SilenceState, n: number, now: number): SilenceState {
  if (n <= 0) return st
  return { turns: st.turns + n, until: now + SILENCE_TIMEOUT_MS }
}

/** 用户开口 → 静默期立刻结束。**他要的答复绝不能被吞**，这比多显示一条回执严重得多。 */
export const endSilence = (): SilenceState => NO_SILENCE

/**
 * 这条事件要不要吞。返回新状态 —— turn.done 会消耗一格。
 *
 * session.ready 不吞：CLI 换完模型会重推一次 init，那条正是「当前模型听 CLI 报的」
 * 这个约定的数据来源。error 也不吞——slash 打错了要让人看见。
 */
export function shouldSilence(
  st: SilenceState,
  kind: string,
  now: number
): { silenced: boolean; next: SilenceState } {
  if (st.turns <= 0) return { silenced: false, next: st }
  // 超时兜底：CLI 万一对某条 slash 不回 turn.done，计数会永远清不掉，
  // 之后所有真实回复都被吞——那是最糟的失败方式，宁可漏静默一条回执
  if (st.until !== undefined && now > st.until) return { silenced: false, next: NO_SILENCE }
  if (kind === 'turn.done') {
    const turns = st.turns - 1
    return { silenced: true, next: turns > 0 ? { turns, until: st.until } : NO_SILENCE }
  }
  const quiet = kind === 'turn.start' || kind === 'text.delta' || kind === 'text.done' || kind === 'thinking'
  return { silenced: quiet, next: st }
}
