// 「新开插件对话」选哪个 Frame（纯函数，单测直接跑；openPluginChat.ts 调用它）。
export type Frame = { id: string; x: number; y: number; w: number; h: number; projectId?: string | null; folderPath?: string }
type Viewport = { x: number; y: number; scale: number }

/** Frame 对应的项目目录；没有目录的 Frame 不能开对话（右键菜单里「插件」也是这条规则） */
export function frameRoot(frame: Frame, projects: readonly { id: string; path: string }[]): string | undefined {
  return frame.folderPath ?? projects.find((p) => p.id === frame.projectId)?.path
}

/** 选哪个 Frame：先看用户选中的（Frame 本身或其中的节点），再退到离视口中心最近、有项目目录的那个 */
export function pickChatFrame(s: {
  frames: readonly Frame[]; projects: readonly { id: string; path: string }[]; canvasSel: readonly string[]; viewport: Viewport
  view: { w: number; h: number }
}): { frameId: string; root: string } | null {
  const usable = s.frames.map((f) => ({ f, root: frameRoot(f, s.projects) })).filter((x): x is { f: Frame; root: string } => !!x.root)
  if (!usable.length) return null
  for (const key of s.canvasSel) {
    const id = key.startsWith('f:') ? key.slice(2) : key.startsWith('n:') ? key.split(':')[1] : ''
    const hit = usable.find((x) => x.f.id === id)
    if (hit) return { frameId: hit.f.id, root: hit.root }
  }
  // 视口中心换算到画布坐标：screen = world * scale + viewport
  const cx = (s.view.w / 2 - s.viewport.x) / s.viewport.scale, cy = (s.view.h / 2 - s.viewport.y) / s.viewport.scale
  const dist = (f: Frame): number => Math.hypot(f.x + f.w / 2 - cx, f.y + f.h / 2 - cy)
  const best = usable.reduce((a, b) => (dist(b.f) < dist(a.f) ? b : a))
  return { frameId: best.f.id, root: best.root }
}
