/** Popup panels have no canvas node. Keep this gate shared by IPC and UI. */
export type PanelSurface = 'canvas' | 'popup'
export interface PanelSurfaceContext { surface?: PanelSurface }

export function panelMayCallCanvas(ctx: PanelSurfaceContext): boolean {
  return ctx.surface !== 'popup'
}

export function panelCanvasCapabilities(ctx: PanelSurfaceContext, declared: readonly string[]): string[] {
  return panelMayCallCanvas(ctx) ? [...declared] : []
}
