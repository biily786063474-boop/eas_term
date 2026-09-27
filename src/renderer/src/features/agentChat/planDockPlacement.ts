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
