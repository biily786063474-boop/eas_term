/** Screen-space placement for the task queue. It never changes the chat pane's layout. */
export type DockRect = { left: number; top: number; right: number; bottom: number }
export type PlanDockPlacement = { left: number; top: number; width: number; side: 'left' | 'right'; compact: boolean; tight: boolean }

const WIDTH = 260
const MARKER_WIDTH = 32
const GAP = 10
const INSET = 8

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

export function planDockPlacement(pane: DockRect, bounds: DockRect, collapsed: boolean, tightExpanded: boolean): PlanDockPlacement | null {
  const visibleWidth = Math.min(pane.right, bounds.right) - Math.max(pane.left, bounds.left)
  const visibleHeight = Math.min(pane.bottom, bounds.bottom) - Math.max(pane.top, bounds.top)
  if (visibleWidth < 56 || visibleHeight < 56) return null

  const rightSpace = bounds.right - pane.right
  const leftSpace = pane.left - bounds.left
  const rightFits = rightSpace >= WIDTH + GAP + INSET
  const leftFits = leftSpace >= WIDTH + GAP + INSET
  const tight = !rightFits && !leftFits
  const compact = collapsed || (tight && !tightExpanded)
  const side: 'left' | 'right' = rightFits ? 'right' : leftFits ? 'left' : rightSpace >= leftSpace ? 'right' : 'left'
  const width = compact ? MARKER_WIDTH : Math.min(WIDTH, bounds.right - bounds.left - INSET * 2)
  const outside = side === 'right' ? pane.right + GAP : pane.left - GAP - width
  const left = clamp(outside, bounds.left + INSET, bounds.right - INSET - width)
  const top = clamp(pane.top + 54, bounds.top + INSET, bounds.bottom - 100)
  return { left, top, width, side, compact, tight }
}
