import type { LayoutNode, PaneKind } from './layout'

/** World/CSS pixels, before canvas zoom. Split leaves additionally reserve 3px per edge. */
export const AGENT_CHAT_MIN_WIDTH = 640
export const paneMinimumWidth = (kind?: PaneKind): number => kind === 'agent' ? AGENT_CHAT_MIN_WIDTH : 120

export function minimumTreeWidth(node: LayoutNode): number {
  if (node.type === 'leaf') return paneMinimumWidth(node.pane.kind) + 6
  const [a, b] = node.children.map(minimumTreeWidth)
  return node.dir === 'row' ? a + b : Math.max(a, b)
}

/** Render-time constraints preserve saved ratios and leaf identities across view changes. */
export function constrainPaneWidths(node: LayoutNode, width: number): LayoutNode {
  if (node.type === 'leaf') return node
  const [a, b] = node.children
  const ratio = node.dir === 'row'
    ? Math.max(minimumTreeWidth(a) / width, Math.min(1 - minimumTreeWidth(b) / width, node.ratio))
    : node.ratio
  return {...node, ratio, children:[
    constrainPaneWidths(a, node.dir === 'row' ? width * ratio : width),
    constrainPaneWidths(b, node.dir === 'row' ? width * (1 - ratio) : width)
  ]}
}
