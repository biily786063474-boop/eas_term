// 终端分屏布局：二叉分割树 + 扁平化矩形计算。
// 所有终端叶子以绝对定位渲染在同一容器里，分屏/调整比例只改坐标，
// 不改变 React 元素层级，从而保证 xterm 实例永不重挂载、滚动缓冲不丢失。

// Blender 式编辑器区域：每个叶子是一个"面板"，可通过下拉框切换功能类型
export type PaneKind = 'terminal' | 'code' | 'image'

export type PaneState =
  | { kind: 'terminal'; ptyId: string }
  | { kind: 'code'; filePath: string | null }
  | { kind: 'image'; filePath: string | null }

export interface LeafNode {
  type: 'leaf'
  id: string
  pane: PaneState
}

export interface SplitNode {
  type: 'split'
  id: string
  dir: 'row' | 'column'
  ratio: number
  children: [LayoutNode, LayoutNode]
}

export type LayoutNode = LeafNode | SplitNode

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LeafRect {
  leaf: LeafNode
  rect: Rect
}

export interface DividerRect {
  splitId: string
  dir: 'row' | 'column'
  /** 该 split 占据的整个区域，用于拖拽时换算比例 */
  region: Rect
  /** 分割线位置（区域内偏移后的绝对坐标） */
  pos: Rect
}

const DIVIDER = 0 // 分割线不占布局空间，渲染时用固定像素宽的把手覆盖在边界上

export function computeLayout(
  node: LayoutNode,
  rect: Rect,
  leaves: LeafRect[],
  dividers: DividerRect[]
): void {
  if (node.type === 'leaf') {
    leaves.push({ leaf: node, rect })
    return
  }
  const [a, b] = node.children
  if (node.dir === 'row') {
    const wA = (rect.w - DIVIDER) * node.ratio
    computeLayout(a, { x: rect.x, y: rect.y, w: wA, h: rect.h }, leaves, dividers)
    computeLayout(
      b,
      { x: rect.x + wA + DIVIDER, y: rect.y, w: rect.w - wA - DIVIDER, h: rect.h },
      leaves,
      dividers
    )
    dividers.push({
      splitId: node.id,
      dir: 'row',
      region: rect,
      pos: { x: rect.x + wA, y: rect.y, w: 0, h: rect.h }
    })
  } else {
    const hA = (rect.h - DIVIDER) * node.ratio
    computeLayout(a, { x: rect.x, y: rect.y, w: rect.w, h: hA }, leaves, dividers)
    computeLayout(
      b,
      { x: rect.x, y: rect.y + hA + DIVIDER, w: rect.w, h: rect.h - hA - DIVIDER },
      leaves,
      dividers
    )
    dividers.push({
      splitId: node.id,
      dir: 'column',
      region: rect,
      pos: { x: rect.x, y: rect.y + hA, w: rect.w, h: 0 }
    })
  }
}

export function collectLeaves(node: LayoutNode, out: LeafNode[] = []): LeafNode[] {
  if (node.type === 'leaf') out.push(node)
  else node.children.forEach((c) => collectLeaves(c, out))
  return out
}

/** 用 replacement 替换树中 id 为 targetId 的叶子，返回新树（未找到则原样返回） */
export function replaceLeaf(
  node: LayoutNode,
  targetId: string,
  replacement: LayoutNode
): LayoutNode {
  if (node.type === 'leaf') return node.id === targetId ? replacement : node
  const [a, b] = node.children
  const na = replaceLeaf(a, targetId, replacement)
  const nb = replaceLeaf(b, targetId, replacement)
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}

/** 删除叶子：其兄弟节点接管父 split 的位置。根叶子被删则返回 null */
export function removeLeaf(node: LayoutNode, targetId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === targetId ? null : node
  const [a, b] = node.children
  const na = removeLeaf(a, targetId)
  if (na === null) return b
  const nb = removeLeaf(b, targetId)
  if (nb === null) return na
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}

export function updateRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio }
  const [a, b] = node.children
  const na = updateRatio(a, splitId, ratio)
  const nb = updateRatio(b, splitId, ratio)
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}

export function firstLeaf(node: LayoutNode): LeafNode {
  return node.type === 'leaf' ? node : firstLeaf(node.children[0])
}

/** 更新指定叶子的面板内容，返回新树 */
export function updatePane(
  node: LayoutNode,
  leafId: string,
  pane: PaneState
): LayoutNode {
  if (node.type === 'leaf') return node.id === leafId ? { ...node, pane } : node
  const [a, b] = node.children
  const na = updatePane(a, leafId, pane)
  const nb = updatePane(b, leafId, pane)
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}
