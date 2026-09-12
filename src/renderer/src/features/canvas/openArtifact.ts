import { useStore } from '../../store'
import type { PaneState } from '../../layout'
import { artifactNode } from '../../store/canvas/artifactNode'

/** 仅接收已经通过权限、文件存在性及所属 Frame 校验的明确产物。 */
export function openArtifact(frameId: string, pane: PaneState): { nodeId: string; reused: boolean } {
  const state = useStore.getState()
  const frame = state.canvas.frames.find(f => f.id === frameId)
  if (!frame) throw new Error('目标 Frame 已关闭')
  const existing = artifactNode(frame.nodes, pane)
  if (state.viewMode !== 'canvas') state.setViewMode('canvas')
  if (existing) {
    window.dispatchEvent(new CustomEvent('eas-artifact-refresh', { detail: { nodeId: existing.id } }))
    state.focusCanvasNode(frameId, existing.id)
    return { nodeId: existing.id, reused: true }
  }
  const before = new Set(frame.nodes.map(n => n.id))
  if (pane.kind === 'web' && pane.url) state.addWebNode(frameId, pane.url)
  else state.addFileNode(frameId, pane, 0, 0)
  const created = useStore.getState().canvas.frames.find(f => f.id === frameId)?.nodes.find(n => !before.has(n.id))
  if (!created) throw new Error('产物未能添加到目标 Frame')
  useStore.getState().focusCanvasNode(frameId, created.id)
  return { nodeId: created.id, reused: false }
}
