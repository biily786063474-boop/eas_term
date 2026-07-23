// 画布切片：全局唯一的无限画布场景（单例，不属于任何 tab）。
// viewMode 全局切换分屏 / 画布；canvas 场景与 split 树共享同一批 leaf（见 §04 数据模型）。
// 节点通过 leafId 引用 split 树里的 leaf → 两视图同一个 PaneView 实例 → 终端不断连。

import type { StateCreator } from 'zustand'
import { collectLeaves } from '../layout'
import { uid } from './shared'
import type { AppState } from './types'

export type ViewMode = 'split' | 'canvas'

export interface CanvasViewport {
  x: number
  y: number
  scale: number
}

/** 画布节点：引用一个共享 leaf（leafId），坐标相对所属 Frame（含头部偏移） */
export interface CanvasNode {
  id: string
  leafId: string
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
  /** 把当前项目的所有 leaf 铺成一个 Frame + 网格节点（幂等：已有该项目 Frame 则跳过） */
  seedCanvas: () => void
  moveFrame: (id: string, x: number, y: number) => void
  resizeFrame: (id: string, w: number, h: number) => void
  toggleCollapse: (id: string) => void
  moveNode: (frameId: string, nodeId: string, x: number, y: number) => void
}

const initialScene: CanvasScene = {
  viewport: { x: 0, y: 0, scale: 1 },
  frames: [],
  shapes: []
}

// 节点网格布局参数
const NODE_W = 360
const NODE_H = 240
const GAP = 22
const HEAD = 34 // Frame 头部高度
const PAD = 16
const COLS = 2

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
    // 已为该项目建过 Frame → 跳过（幂等）
    if (s.canvas.frames.some((f) => f.projectId === projectId)) return
    const projectTabs = s.tabs.filter((t) => t.projectId === projectId)
    const leaves = projectTabs.flatMap((t) => collectLeaves(t.root))
    if (!leaves.length) return
    const project = s.projects.find((p) => p.id === projectId)

    const nodes: CanvasNode[] = leaves.map((leaf, i) => ({
      id: uid('cnode'),
      leafId: leaf.id,
      x: PAD + (i % COLS) * (NODE_W + GAP),
      y: HEAD + PAD + Math.floor(i / COLS) * (NODE_H + GAP),
      w: NODE_W,
      h: NODE_H
    }))
    const cols = Math.min(COLS, leaves.length)
    const rows = Math.ceil(leaves.length / COLS)
    const w = PAD * 2 + cols * NODE_W + (cols - 1) * GAP
    const h = HEAD + PAD * 2 + rows * NODE_H + (rows - 1) * GAP

    // 新 Frame 摆在现有 Frame 右侧，避免重叠
    const rightMost = s.canvas.frames.reduce((mx, f) => Math.max(mx, f.x + f.w), 0)
    const x = s.canvas.frames.length ? rightMost + 60 : 80

    const frame: CanvasFrame = {
      id: uid('frame'),
      projectId: projectId ?? null,
      name: project?.name ?? '未命名',
      x,
      y: 80,
      w,
      h,
      collapsed: false,
      nodes
    }
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
    }))
})
