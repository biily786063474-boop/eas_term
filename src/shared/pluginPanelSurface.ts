/** Popup panels have no canvas node. Keep this gate shared by IPC and UI. */
export type PanelSurface = 'canvas' | 'popup'
export interface PanelSurfaceContext { surface?: PanelSurface }

export function panelMayCallCanvas(ctx: PanelSurfaceContext): boolean {
  return ctx.surface !== 'popup'
}

export function panelCanvasCapabilities(ctx: PanelSurfaceContext, declared: readonly string[]): string[] {
  return panelMayCallCanvas(ctx) ? [...declared] : []
}

/**
 * 用户能挑的面板（2026-10-02）：去掉清单里 `hidden: true` 的（如发布台分屏头条 `cell`，只供宿主按 panelId 嵌入）。
 * 所有「让用户选面板 / 数面板」的地方都走它：抽屉弹窗的选择与「只有一个就直接开」、插入菜单插件页、节点标题、对话里的资源链接。
 */
export function userPanels<T extends { hidden?: boolean }>(panels: readonly T[] | undefined): T[] {
  return (panels ?? []).filter((p) => p.hidden !== true)
}
