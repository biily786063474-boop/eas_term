// 通知的显示文案：灵动岛（渲染进程）与 Dock 菜单（主进程）共用这一份。
//
// 「后台运行中」**不是第三种 kind**：它的行为（8 秒自动收、前台只折叠播报、可「知道了」）
// 与「完成」完全相同，只是字不同（2026-09-29 用户要求）。所以它是 kind:'done' 上多一个
// `background` 字段，行为判断照旧只看 kind，文案一律经这里取——
// 各处自己写 `kind === 'approval' ? … : '已完成'` 就会漏掉一处继续说「完成」。

export interface NoticeLike {
  kind: 'done' | 'approval'
  /** 有值（含空串）= 这一轮说完了但后台任务还在跑；值是任务名 */
  background?: string
}

export const BACKGROUND_RUNNING = '后台运行中'

export function isBackgroundNotice(n: NoticeLike): boolean {
  return n.kind === 'done' && n.background !== undefined
}

/** 通知卡右上角的状态字 */
export function noticeStatusText(n: NoticeLike): string {
  if (n.kind === 'approval') return '等待审批'
  return isBackgroundNotice(n) ? BACKGROUND_RUNNING : '已完成'
}

/** Dock 右键菜单里的短标签 */
export function noticeDockTag(n: NoticeLike): string {
  if (n.kind === 'approval') return '等审批'
  if (!isBackgroundNotice(n)) return '已完成'
  return n.background ? `${BACKGROUND_RUNNING} · ${n.background}` : BACKGROUND_RUNNING
}

/** 灵动岛列表态的组标题。没有后台运行中时保持原文案（审批也一直算在这个数里） */
export function noticeGroupTitle(notices: readonly NoticeLike[]): string {
  const bg = notices.filter(isBackgroundNotice).length
  const rest = notices.length - bg
  if (!bg) return `完成了 ${rest} 个`
  if (!rest) return `${BACKGROUND_RUNNING} ${bg} 个`
  return `完成了 ${rest} 个 · ${BACKGROUND_RUNNING} ${bg} 个`
}

/** 折叠条的一句话。doneN 不含后台运行中那几条 */
export function islandBarLabel(c: { waiting: boolean; runN: number; doneN: number; bgN: number }): string {
  if (c.waiting) return '需要审批'
  if (c.runN) return '工作中'
  if (c.doneN > 0) return '任务完成'
  if (c.bgN > 0) return BACKGROUND_RUNNING
  return '待处理'
}
