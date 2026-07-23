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
  /** 自定义名称（可重命名）；未设则用默认标题 */
  name?: string
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
  /** app 启动时从磁盘恢复画布场景（frames/shapes/viewport/viewMode）。
   *  终端节点已剥离旧 leafId → 占位，进画布时 materialize 重开绑定。 */
  loadCanvas: () => Promise<void>
  /** 把画布里的终端占位节点（无 leafId/pane/component）逐个重开终端并绑定 leafId */
  materializeCanvas: () => Promise<void>
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
  /** 在 Frame 里新开一个终端节点（openTerminal + 挂到 Frame，自动堆叠） */
  addTerminalNode: (frameId: string) => Promise<void>
  /** 重命名节点（自定义名称） */
  renameNode: (frameId: string, nodeId: string, name: string) => void
  /** 画布选中集合（key：s:形状 / f:Frame / n:frameId:nodeId 节点，含终端节点）。
   *  提到 store 是为了让浮在 PaneLayer 的终端节点也能被选中并显示高亮 + F 聚焦。 */
  canvasSel: string[]
  setCanvasSel: (keys: string[]) => void
  toggleCanvasSel: (key: string, additive: boolean) => void
  clearCanvasSel: () => void
}

const initialScene: CanvasScene = {
  viewport: { x: 0, y: 0, scale: 1 },
  frames: [],
  shapes: []
}

/** 落盘的画布场景（含 viewMode）。终端节点的 leafId 已剥离（会话相关，重开时重绑）。 */
export interface PersistedCanvas {
  viewMode: ViewMode
  viewport: CanvasViewport
  frames: CanvasFrame[]
  shapes: CanvasShape[]
}

/** 序列化画布用于落盘：剥离每个节点的 leafId（会话相关，重开时按占位重开终端重绑） */
export function serializeCanvas(canvas: CanvasScene, viewMode: ViewMode): PersistedCanvas {
  return {
    viewMode,
    viewport: canvas.viewport,
    frames: canvas.frames.map((f) => ({
      ...f,
      nodes: f.nodes.map((n) => {
        const copy = { ...n }
        delete copy.leafId
        return copy
      })
    })),
    shapes: canvas.shapes
  }
}

// materializeCanvas 防重入（避免恢复与进画布同时触发导致重复 spawn）
let materializing = false

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

/**
 * 让 Frame 宽高恰好裹住内部所有节点（右/下留 PAD 边距）——既能自动长大，也能收缩。
 * 节点坐标相对 Frame，左/上边界由 moveNode 钳制（≥PAD / ≥HEAD+PAD），故此处只需管右/下。
 */
function fitFrameToNodes(frame: CanvasFrame): CanvasFrame {
  if (!frame.nodes.length) return frame
  const right = Math.max(...frame.nodes.map((n) => n.x + n.w))
  const bottom = Math.max(...frame.nodes.map((n) => n.y + n.h))
  return {
    ...frame,
    w: Math.max(240, right + PAD),
    h: Math.max(HEAD + PAD, bottom + PAD)
  }
}

/** 把新节点放进 Frame：纵向堆叠到现有节点下方（避免重叠），Frame 随之裹住它 */
function placeNodeInFrame(frame: CanvasFrame, node: CanvasNode): CanvasFrame {
  const bottom = frame.nodes.length
    ? Math.max(...frame.nodes.map((n) => n.y + n.h)) + GAP
    : HEAD + PAD
  const placed = { ...node, x: PAD, y: bottom }
  return fitFrameToNodes({ ...frame, nodes: [...frame.nodes, placed] })
}

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
  viewMode: 'split',
  canvas: initialScene,

  setViewMode: (mode) => {
    set({ viewMode: mode })
    if (mode === 'canvas') {
      // 首次进画布时，把当前项目的终端 seed 成 Frame（若尚未 seed）
      get().seedCanvas()
      // 恢复来的终端占位节点在此重开绑定（幂等，无占位则空转）
      void get().materializeCanvas()
    }
  },

  loadCanvas: async () => {
    const raw = (await window.api.canvas.load()) as PersistedCanvas | null
    if (!raw || !Array.isArray(raw.frames)) return
    set(() => ({
      canvas: {
        viewport: raw.viewport ?? initialScene.viewport,
        frames: raw.frames,
        shapes: Array.isArray(raw.shapes) ? raw.shapes : []
      }
    }))
    // 上次退出停在画布 → 恢复到画布并立即重开终端
    if (raw.viewMode === 'canvas') {
      set({ viewMode: 'canvas' })
      await get().materializeCanvas()
    }
  },

  materializeCanvas: async () => {
    if (materializing) return
    materializing = true
    try {
      const frames = get().canvas.frames
      for (const f of frames) {
        // 项目已被删除的 Frame：跳过重开终端（避免开到 home）
        if (f.projectId && !get().projects.some((p) => p.id === f.projectId)) continue
        for (const n of f.nodes) {
          if (n.leafId || n.pane || n.component) continue // 已绑定 / 文件 / 组件 → 跳过
          // 终端占位 → 重开一个终端绑定到该节点（全新 shell）
          const before = new Set(
            get()
              .tabs.filter((t) => t.projectId === f.projectId)
              .flatMap((t) => collectLeaves(t.root).map((l) => l.id))
          )
          await get().openTerminal({ projectId: f.projectId })
          const newLeaf = get()
            .tabs.filter((t) => t.projectId === f.projectId)
            .flatMap((t) => collectLeaves(t.root))
            .find((l) => !before.has(l.id))
          if (!newLeaf) continue
          set((s) => ({
            canvas: {
              ...s.canvas,
              frames: s.canvas.frames.map((fr) =>
                fr.id === f.id
                  ? {
                      ...fr,
                      nodes: fr.nodes.map((nn) => (nn.id === n.id ? { ...nn, leafId: newLeaf.id } : nn))
                    }
                  : fr
              )
            }
          }))
        }
      }
    } finally {
      materializing = false
    }
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
        frames: s.canvas.frames.map((f) => {
          if (f.id !== id) return f
          // 手动 resize 不得小于内容包围盒，避免模块溢出 Frame
          const minW = f.nodes.length ? Math.max(...f.nodes.map((n) => n.x + n.w)) + PAD : 240
          const minH = f.nodes.length ? Math.max(...f.nodes.map((n) => n.y + n.h)) + PAD : 120
          return { ...f, w: Math.max(minW, w), h: Math.max(minH, h) }
        })
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
            ? fitFrameToNodes({
                ...f,
                // 钳制左/上边界，避免模块跑到 Frame 头部或左侧外；右/下由 fit 自动裹住
                nodes: f.nodes.map((n) =>
                  n.id === nodeId ? { ...n, x: Math.max(PAD, x), y: Math.max(HEAD + PAD, y) } : n
                )
              })
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
            ? fitFrameToNodes({
                ...f,
                nodes: f.nodes.map((n) =>
                  n.id === nodeId ? { ...n, w: Math.max(120, w), h: Math.max(80, h) } : n
                )
              })
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
          f.id === frameId
            ? fitFrameToNodes({ ...f, nodes: f.nodes.filter((n) => n.id !== nodeId) })
            : f
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
          return fitFrameToNodes({
            ...f,
            nodes: [...f.nodes, { ...n, id: uid('cnode'), x: n.x + 22, y: n.y + 22 }]
          })
        })
      }
    })),

  addTerminalNode: async (frameId) => {
    const frame = get().canvas.frames.find((f) => f.id === frameId)
    if (!frame) return
    const before = new Set(
      get()
        .tabs.filter((t) => t.projectId === frame.projectId)
        .flatMap((t) => collectLeaves(t.root).map((l) => l.id))
    )
    await get().openTerminal({ projectId: frame.projectId })
    const newLeaf = get()
      .tabs.filter((t) => t.projectId === frame.projectId)
      .flatMap((t) => collectLeaves(t.root))
      .find((l) => !before.has(l.id))
    if (!newLeaf) return
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? placeNodeInFrame(f, { id: uid('cnode'), leafId: newLeaf.id, x: 0, y: 0, w: NODE_W, h: NODE_H })
            : f
        )
      }
    }))
  },

  renameNode: (frameId, nodeId, name) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? { ...f, nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, name } : n)) }
            : f
        )
      }
    })),

  canvasSel: [],
  setCanvasSel: (keys) => set({ canvasSel: keys }),
  toggleCanvasSel: (key, additive) =>
    set((s) => {
      if (additive)
        return {
          canvasSel: s.canvasSel.includes(key)
            ? s.canvasSel.filter((k) => k !== key)
            : [...s.canvasSel, key]
        }
      // 非累加：已是唯一选中则保持，否则替换为仅此项
      if (s.canvasSel.length === 1 && s.canvasSel[0] === key) return s
      return { canvasSel: [key] }
    }),
  clearCanvasSel: () => set((s) => (s.canvasSel.length ? { canvasSel: [] } : s))
})
