/** A released pointer is a click only if it did not become a canvas drag. */
export function isPluginPanelClick(
  down: { x: number; y: number; button: number } | null,
  up: { x: number; y: number }
): boolean {
  return !!down && down.button === 0 && Math.hypot(up.x - down.x, up.y - down.y) <= 5
}
