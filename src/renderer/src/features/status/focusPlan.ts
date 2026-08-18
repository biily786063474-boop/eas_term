// 「点通知/灵动岛跳到某个终端」时，要不要切视图模式。纯函数、零 import，可单测。
//
// ── 原来的毛病：判据是终端在哪，不是用户在哪 ────────────────────────────
// 早先写的是「这个终端在画布上有节点 → 切画布模式」。但**画布和分屏共享同一批
// leaf**：一个终端在画布上有节点的同时，分屏里也有。于是在分屏里用得好好的，
// 一点通知就被拽到画布 —— 用户的说法是「终端模式下点击完成的提示会跳到画板模式，
// 不同模式下要隔离」。
//
// ── 现在的规则：当前模式内够得着，就别切 ────────────────────────────────
// 但不能一律不切 —— 那会变成「点了通知什么都没发生」，而那正是这套跳转本来要防的
// 失败（提醒清掉了、画面毫无变化）。所以判据是「当前模式**看得见**这个终端吗」：
//
//   split  永远看得见。locate() 总能给出 tabId/leafId，每个终端都有 tab 归属。
//   canvas 要它在画布上真有节点（frameId + nodeId）才看得见。
//   board  **永远看不见** —— 看板的卡片是项目摘要，上面根本不放终端
//          （BoardStage.tsx 开头写着为什么：嵌进去只剩两百来像素宽）。
//          所以从看板点通知必须切走，留在原地等于没反应。
export type FocusMode = 'split' | 'canvas' | 'board'

export interface FocusPlan {
  /** 要切到的模式；null = 留在当前模式 */
  switchTo: FocusMode | null
  /** 落点：画布节点还是分屏标签 */
  target: 'canvas' | 'split'
}

/**
 * @param viewMode 用户现在在哪个模式
 * @param onCanvas 这个终端在画布上有没有节点
 */
export function planFocus(viewMode: FocusMode, onCanvas: boolean): FocusPlan {
  // 分屏里永远够得着，不切
  if (viewMode === 'split') return { switchTo: null, target: 'split' }
  // 画布里且它真在画布上，不切
  if (viewMode === 'canvas' && onCanvas) return { switchTo: null, target: 'canvas' }
  // 剩下的都得切：看板（看不见终端）、画布但这个终端只在分屏里
  return onCanvas ? { switchTo: 'canvas', target: 'canvas' } : { switchTo: 'split', target: 'split' }
}
