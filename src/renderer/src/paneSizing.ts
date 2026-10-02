import type { LayoutNode, PaneKind } from './layout'

/** World/CSS pixels, before canvas zoom. Split leaves additionally reserve 3px per edge. */
export const AGENT_CHAT_MIN_WIDTH = 640
export const paneMinimumWidth = (kind?: PaneKind): number => kind === 'agent' ? AGENT_CHAT_MIN_WIDTH : 120

// Split panes use responsive composers; canvas placement retains its 640px minimum.
// 460 不是随手取的（2026-10-02 用户截图：分屏里 AI 一忙，底栏多出「停止」「调整方向」，模型名和右侧图标上下错位）：
// 底栏已改成永远一行，让位的只有模型名（最窄 52px）；忙碌时右侧动作组固定 325px。
// 实测对话面板宽 < 444px 时右侧按钮开始被挤出框外（中英文一样，scripts/verify-chat-bar-width.mjs），
// 取 460 留一点余量。往下调之前先重量这组按钮的宽度。
export const SPLIT_AGENT_MIN_WIDTH = 460

export function minimumTreeWidth(node: LayoutNode): number {
  if (node.type === 'leaf') return (node.pane.kind === 'agent' ? SPLIT_AGENT_MIN_WIDTH : paneMinimumWidth(node.pane.kind)) + 6
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
