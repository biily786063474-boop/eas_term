// 画布切片：全局唯一的无限画布场景（单例，不属于任何 tab）。
// viewMode 全局切换分屏 / 画布；canvas 场景与 split 树共享同一批 leaf（见 §04 数据模型）。
// 节点通过 leafId 引用 split 树里的 leaf → 两视图同一个 PaneView 实例 → 终端不断连。

import type { StateCreator } from 'zustand'
import { collectLeaves, LeafNode, PaneState } from '../layout'
import { uid } from './shared'
import type { AppState } from './types'

export type ViewMode = 'split' | 'canvas'

export interface CanvasViewport {
  x: number
  y: number
  scale: number
}

/** 画布节点：坐标相对所属 Frame（含头部偏移）。
 *  终端节点用 leafId 引用共享 leaf（两视图同源，pane-layer 渲染）；
 *  文件预览节点用 pane 自带内容（画布独有，装饰层渲染，不进分屏）。二者二选一。 */
export interface CanvasNode {
  id: string
  leafId?: string
  pane?: PaneState
  /** 画布组件（如版本管理）；画布独有，type 查 features/canvas/components/registry */
  component?: { type: string; props?: Record<string, unknown> }
  x: number
  y: number
  w: number
  h: number
}

/** Frame：对应一个项目，容纳若干节点 */
export interface CanvasFrame {
  id: string
  projectId: string | null
  name: string
  x: number
  y: number
  w: number
  h: number
  collapsed: boolean
  nodes: CanvasNode[]
}

/** 图形/便签：世界坐标 */
export interface CanvasShape {
  id: string
  type: 'rect' | 'arrow' | 'sticky'
  x: number
  y: number
  w: number
  h: number
  text?: string
  color?: string
}

export interface CanvasScene {
  viewport: CanvasViewport
  frames: CanvasFrame[]
  shapes: CanvasShape[]
}

export interface CanvasSlice {
  /** 全局视图：分屏 / 画布。titlebar 分段控件切换，不属于任何 tab */
  viewMode: ViewMode
  canvas: CanvasScene
  setViewMode: (mode: ViewMode) => void
  setViewport: (vp: Partial<CanvasViewport>) => void
  /** 把当前项目的所有 leaf 铺成一个 Frame（幂等：已有该项目 Frame 则跳过） */
  seedCanvas: () => void
  /** 拖项目入画布：已有 Frame 则跳过（由调用方聚焦），否则（必要时先开终端）在落点建 Frame */
  addProjectFrame: (projectId: string | null, x: number, y: number) => Promise<void>
  moveFrame: (id: string, x: number, y: number) => void
  resizeFrame: (id: string, w: number, h: number) => void
  toggleCollapse: (id: string) => void
  moveNode: (frameId: string, nodeId: string, x: number, y: number) => void
  resizeNode: (frameId: string, nodeId: string, w: number, h: number) => void
  /** 拖文件入 Frame：新增一个画布自带的文件预览节点（不进分屏） */
  addFileNode: (frameId: string, pane: PaneState, x: number, y: number) => void
  /** 拖组件入 Frame：新增一个画布组件节点（尺寸由调用方从 registry 取，避免循环依赖） */
  addComponentNode: (
    frameId: string,
    type: string,
    x: number,
    y: number,
    w: number,
    h: number
  ) => void
  removeNode: (frameId: string, nodeId: string) => void
  addShape: (shape: Omit<CanvasShape, 'id'>) => void
  updateShape: (id: string, patch: Partial<CanvasShape>) => void
  removeShape: (id: string) => void
  renameFrame: (id: string, name: string) => void
  /** 删除 Frame：逐个 closeLeaf 杀掉成员终端，再移除 Frame */
  removeFrame: (id: string) => void
  /** 复制画布独有节点（文件/组件；终端节点不复制，pty 唯一） */
  duplicateNode: (frameId: string, nodeId: string) => void
}

const initialScene: CanvasScene = {
  viewport: { x: 0, y: 0, scale: 1 },
  frames: [],
  shapes: []
}

// 节点网格布局参数（终端节点默认高度保证 ≥20 行：body≈NODE_H-30，行高 fontSize13×1.25≈16.25px）
const NODE_W = 440
const NODE_H = 380
const GAP = 22
const HEAD = 34 // Frame 头部高度
const PAD = 16
const COLS = 2

/** 依据一批共享 leaf 生成一个网格布局的 Frame（纯函数，不落 state） */
function makeProjectFrame(
  leaves: LeafNode[],
  name: string,
  projectId: string | null,
  x: number,
  y: number
): CanvasFrame {
  const nodes: CanvasNode[] = leaves.map((leaf, i) => ({
    id: uid('cnode'),
    leafId: leaf.id,
    x: PAD + (i % COLS) * (NODE_W + GAP),
    y: HEAD + PAD + Math.floor(i / COLS) * (NODE_H + GAP),
    w: NODE_W,
    h: NODE_H
  }))
  const cols = Math.min(COLS, Math.max(1, leaves.length))
  const rows = Math.max(1, Math.ceil(leaves.length / COLS))
  return {
    id: uid('frame'),
    projectId,
    name,
    x,
    y,
    w: PAD * 2 + cols * NODE_W + (cols - 1) * GAP,
    h: HEAD + PAD * 2 + rows * NODE_H + (rows - 1) * GAP,
    collapsed: false,
    nodes
  }
}

/** 把新节点放进 Frame：纵向堆叠到现有节点下方（避免重叠），Frame 随之扩大到容纳它 */
function placeNodeInFrame(frame: CanvasFrame, node: CanvasNode): CanvasFrame {
  const bottom = frame.nodes.length
    ? Math.max(...frame.nodes.map((n) => n.y + n.h)) + GAP
    : HEAD + PAD
  const placed = { ...node, x: PAD, y: bottom }
  return {
    ...frame,
    w: Math.max(frame.w, PAD + placed.w + PAD),
    h: Math.max(frame.h, placed.y + placed.h + PAD),
    nodes: [...frame.nodes, placed]
  }
}

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
  viewMode: 'split',
  canvas: initialScene,

  setViewMode: (mode) => {
    set({ viewMode: mode })
    // 首次进画布时，把当前项目的终端 seed 成 Frame（若尚未 seed）
    if (mode === 'canvas') get().seedCanvas()
  },

  setViewport: (vp) =>
    set((s) => ({ canvas: { ...s.canvas, viewport: { ...s.canvas.viewport, ...vp } } })),

  seedCanvas: () => {
    const s = get()
    const projectId = s.activeProjectId
    if (s.canvas.frames.some((f) => f.projectId === projectId)) return
    const leaves = s.tabs.filter((t) => t.projectId === projectId).flatMap((t) => collectLeaves(t.root))
    if (!leaves.length) return
    const project = s.projects.find((p) => p.id === projectId)
    const frame = makeProjectFrame(leaves, project?.name ?? '未命名', projectId ?? null, 80, 80)
    set((st) => ({ canvas: { ...st.canvas, frames: [...st.canvas.frames, frame] } }))
  },

  addProjectFrame: async (projectId, x, y) => {
    if (get().canvas.frames.some((f) => f.projectId === projectId)) return
    // 项目还没终端 → 先开一个，Frame 里才有内容
    let leaves = get()
      .tabs.filter((t) => t.projectId === projectId)
      .flatMap((t) => collectLeaves(t.root))
    if (!leaves.length) {
      await get().openTerminal({ projectId })
      leaves = get()
        .tabs.filter((t) => t.projectId === projectId)
        .flatMap((t) => collectLeaves(t.root))
    }
    if (!leaves.length) return
    const project = get().projects.find((p) => p.id === projectId)
    const frame = makeProjectFrame(leaves, project?.name ?? '未命名', projectId ?? null, x, y)
    set((st) => ({ canvas: { ...st.canvas, frames: [...st.canvas.frames, frame] } }))
  },

  moveFrame: (id, x, y) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) => (f.id === id ? { ...f, x, y } : f))
      }
    })),

  resizeFrame: (id, w, h) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === id ? { ...f, w: Math.max(240, w), h: Math.max(120, h) } : f
        )
      }
    })),

  toggleCollapse: (id) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
      }
    })),

  moveNode: (frameId, nodeId, x, y) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? { ...f, nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)) }
            : f
        )
      }
    })),

  resizeNode: (frameId, nodeId, w, h) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? {
                ...f,
                nodes: f.nodes.map((n) =>
                  n.id === nodeId ? { ...n, w: Math.max(120, w), h: Math.max(80, h) } : n
                )
              }
            : f
        )
      }
    })),

  addFileNode: (frameId, pane, x, y) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) => {
          if (f.id !== frameId) return f
          const w = pane.kind === 'image' ? 260 : pane.kind === 'web' ? 320 : 300
          const h = pane.kind === 'web' ? 260 : pane.kind === 'image' ? 200 : 220
          return placeNodeInFrame(f, { id: uid('cnode'), pane, x, y, w, h })
        })
      }
    })),

  addComponentNode: (frameId, type, x, y, w, h) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? placeNodeInFrame(f, { id: uid('cnode'), component: { type }, x, y, w, h })
            : f
        )
      }
    })),

  removeNode: (frameId, nodeId) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId ? { ...f, nodes: f.nodes.filter((n) => n.id !== nodeId) } : f
        )
      }
    })),

  addShape: (shape) =>
    set((s) => ({
      canvas: { ...s.canvas, shapes: [...s.canvas.shapes, { ...shape, id: uid('shape') }] }
    })),

  updateShape: (id, patch) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        shapes: s.canvas.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh))
      }
    })),

  removeShape: (id) =>
    set((s) => ({
      canvas: { ...s.canvas, shapes: s.canvas.shapes.filter((sh) => sh.id !== id) }
    })),

  renameFrame: (id, name) =>
    set((s) => ({
      canvas: { ...s.canvas, frames: s.canvas.frames.map((f) => (f.id === id ? { ...f, name } : f)) }
    })),

  removeFrame: (id) => {
    const s = get()
    const frame = s.canvas.frames.find((f) => f.id === id)
    if (frame) {
      frame.nodes.forEach((n) => {
        if (!n.leafId) return
        const tab = s.tabs.find((t) => collectLeaves(t.root).some((l) => l.id === n.leafId))
        if (tab) s.closeLeaf(tab.id, n.leafId)
      })
    }
    set((st) => ({ canvas: { ...st.canvas, frames: st.canvas.frames.filter((f) => f.id !== id) } }))
  },

  duplicateNode: (frameId, nodeId) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) => {
          if (f.id !== frameId) return f
          const n = f.nodes.find((x) => x.id === nodeId)
          if (!n || n.leafId) return f
          return { ...f, nodes: [...f.nodes, { ...n, id: uid('cnode'), x: n.x + 22, y: n.y + 22 }] }
        })
      }
    }))
})
