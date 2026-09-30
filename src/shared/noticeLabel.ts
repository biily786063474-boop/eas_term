// 通知的显示文案：灵动岛（渲染进程）与 Dock 菜单（主进程）共用这一份。
//
// 「后台运行中」**不是第三种 kind**：它的行为（8 秒自动收、前台只折叠播报、可「知道了」）
// 与「完成」完全相同，只是字不同（2026-09-29 用户要求）。所以它是 kind:'done' 上多一个
// `background` 字段，行为判断照旧只看 kind，文案一律经这里取——
// 各处自己写 `kind === 'approval' ? … : '已完成'` 就会漏掉一处继续说「完成」。
//
// 文案走词典（docs/i18n/README.md）：每个函数最后一个参数是取文案的 T，
// 灵动岛传自己的 useT()，主进程 Dock 菜单传 main/i18n.ts 的 t；不传时用共享层的 tm()
// （跟随当前界面语言，测试里默认中文）。
import type { T } from './i18n/index.ts'
import { tm } from './i18n/current.ts'

export interface NoticeLike {
  kind: 'done' | 'approval'
  /** 有值（含空串）= 这一轮说完了但后台任务还在跑；值是任务名 */
  background?: string
}

export function isBackgroundNotice(n: NoticeLike): boolean {
  return n.kind === 'done' && n.background !== undefined
}

/** 通知卡右上角的状态字 */
export function noticeStatusText(n: NoticeLike, tr: T = tm): string {
  if (n.kind === 'approval') return tr('island.status.awaiting')
  return isBackgroundNotice(n) ? tr('island.status.bgRunning') : tr('island.status.completed')
}

/** Dock 右键菜单里的短标签 */
export function noticeDockTag(n: NoticeLike, tr: T = tm): string {
  if (n.kind === 'approval') return tr('dock.awaitingApproval')
  if (!isBackgroundNotice(n)) return tr('dock.done')
  return n.background ? tr('dock.bgRunningTask', { task: n.background }) : tr('dock.bgRunning')
}

/** 灵动岛列表态的组标题。没有后台运行中时保持原文案（审批也一直算在这个数里） */
export function noticeGroupTitle(notices: readonly NoticeLike[], tr: T = tm): string {
  const bg = notices.filter(isBackgroundNotice).length
  const rest = notices.length - bg
  if (!bg) return tr('island.finishedN', { n: rest })
  if (!rest) return tr('island.bgRunningN', { n: bg })
  return tr('island.finishedAndBgN', { done: rest, bg })
}

/** 折叠条的一句话。doneN 不含后台运行中那几条 */
export function islandBarLabel(c: { waiting: boolean; runN: number; doneN: number; bgN: number }, tr: T = tm): string {
  if (c.waiting) return tr('island.label.needApproval')
  if (c.runN) return tr('island.label.working')
  if (c.doneN > 0) return tr('island.label.done')
  if (c.bgN > 0) return tr('island.label.bgRunning')
  return tr('island.label.pending')
}
