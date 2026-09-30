// 「后台运行中」这类提醒的三条判据（2026-09-29 用户要求）。
//
// AI 对话这一轮说完了、但 Claude 的 run_in_background 还在跑：这时照样提醒
// （AI 常在等你回话，见 03 号图纸「后台任务不是『完成』」），但**不能说成「完成」**——
// 提示音换一种、灵动岛/Dock 写「后台运行中」。
//
// **纯函数，不引 React / store。** 规则写错了不报错，只会让人听错一个音、
// 看错一个字，只有单测抓得住。接线见 useNoticeSound.ts 与 AgentChatView.tsx。

export type NoticeSound = 'done' | 'approval' | 'background'

/** store.ptyBackground 的一条：flag 那一刻后台里跑着什么。
 *  `at` 给灵动岛当通知身份用——后台一直在跑时运行态从不落下，lastDoneAt 不会变，
 *  只拿它做 id 的话第二轮的提醒会顶着第一轮的 id，不再自动弹出。 */
export interface BackgroundMark {
  at: number
  /** 后台任务个数 */
  count: number
  /** 第一个任务的名字（一行、截断），与对话底部「后台任务运行中 …」同源 */
  label: string
}

/** 灵动岛/Dock 里任务名只有一行的位置 */
const LABEL_MAX = 40

/**
 * 这一批新提醒该播哪种音。批次内有审批 → approval（最急，agent 卡着）；
 * 否则有后台运行中 → background；否则 done。
 * **整批只返回一个**：三个任务同时到不该响三声（useNoticeSound 只播这一次）。
 */
export function pickNoticeSound(
  fresh: readonly string[],
  approval: Readonly<Record<string, unknown>>,
  background: Readonly<Record<string, unknown>>
): NoticeSound {
  if (fresh.some((id) => approval[id])) return 'approval'
  if (fresh.some((id) => background[id])) return 'background'
  return 'done'
}

/** turn.done 要提醒时：后台还有任务就给出标记，没有就 null（照常按「完成」）。 */
export function backgroundMarkFor(
  view: { background: readonly { label: string }[] },
  at: number
): BackgroundMark | null {
  if (!view.background.length) return null
  const raw = view.background[0].label.replace(/\s+/g, ' ').trim()
  const label = raw.length > LABEL_MAX ? raw.slice(0, LABEL_MAX - 1) + '…' : raw
  return { at, count: view.background.length, label }
}

/** 收到一条事件后，这个会话的「后台运行中」标记还该不该留着。
 *  新回合开始（续的那一轮或用户又发了话）→ 摘；后台清空 → 摘（再提醒就是真「完成」了）。 */
export function shouldDropBackgroundMark(
  eventKind: string,
  view: { background: readonly unknown[] }
): boolean {
  return eventKind === 'turn.start' || view.background.length === 0
}
