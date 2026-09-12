import type { CanvasNode } from './types'
import type { PaneState } from '../../layout'

/** 输入已由 MCP 做路径/权限校验。只复用同 Frame、同类型、同文件的内容节点。 */
export function artifactNode(nodes: CanvasNode[], pane: PaneState): CanvasNode | undefined {
  return nodes.find(n => {
    if (n.leafId || !n.pane || n.pane.kind !== pane.kind) return false
    if (pane.kind === 'web' && n.pane.kind === 'web') return n.pane.url === pane.url
    if ((pane.kind === 'code' || pane.kind === 'image') && (n.pane.kind === 'code' || n.pane.kind === 'image')) return n.pane.filePath === pane.filePath
    return false
  })
}
