/** Fixed module-local anchor, projected to screen space for the body portal. */
export type DockRect = { left: number; top: number; right: number; bottom: number }
export type PlanDockPlacement = { left: number; top: number; width: number; side: 'right'; compact: boolean; tight: boolean; maxHeight: number; scale: number }

const WIDTH = 260
const MARKER_WIDTH = 32
const GAP = 10
const INSET = 8

export function planDockPlacement(pane: DockRect, bounds: DockRect, collapsed: boolean, tightExpanded: boolean, scale = 1, maximized = false): PlanDockPlacement | null {
  const visibleWidth = Math.min(pane.right, bounds.right) - Math.max(pane.left, bounds.left)
  const visibleHeight = Math.min(pane.bottom, bounds.bottom) - Math.max(pane.top, bounds.top)
  if (visibleWidth < 56 || visibleHeight < 56) return null

  // Only explicit maximization moves the dock inside. Panning near screen edges
  // never flips sides, clamps the anchor, or changes the user's open state.
  const compact = collapsed || (maximized && !tightExpanded)
  const width = compact ? MARKER_WIDTH : WIDTH
  const left = maximized ? pane.right - (INSET + width) * scale : pane.right + GAP * scale
  const top = pane.top + 54 * scale
  return { left, top, width, side: 'right', compact, tight: maximized, scale,
    maxHeight: Math.max(0, (pane.bottom - top) / scale - INSET) }
}

/** 停靠卡片挂在 body 上、position:fixed，和画布的界面层在根层直接比 z-index（中间没有层叠上下文，2026-09-28 实测）。
 *  普通状态：必须低于画布界面层 —— 画布工具条 / 额度条 20、边签 29、完成气泡 31、任务监视器 42 …
 *  都在 20 以上；原来用 42，和任务监视器同值且挂在 body 末尾，于是压在它和额度条上面（用户截图）。
 *  同时要高于画布内容（面板 auto、框架内的小浮层 ≤15）。
 *  最大化：模块本身是 200，卡片要压过它；此时任务监视器与额度条都会主动隐藏，不冲突。 */
export const PLAN_DOCK_Z = 18
export const PLAN_DOCK_Z_MAXIMIZED = 220
export function planDockZ(maximized: boolean): number {
  return maximized ? PLAN_DOCK_Z_MAXIMIZED : PLAN_DOCK_Z
}
