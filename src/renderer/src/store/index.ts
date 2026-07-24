// zustand 全局状态：按域切片（项目 / 标签+面板树 / UI），此处组合导出。
// 组件一律 `import { useStore } from '../store'`，对外 API 与切片划分无关。

import { create } from 'zustand'
import { createProjectsSlice } from './projectsSlice'
import { createTabsSlice } from './tabsSlice'
import { createUiSlice } from './uiSlice'
import { createCanvasSlice } from './canvasSlice'
import type { AppState } from './types'

export type { AppState } from './types'
export type { TermTab } from './shared'
export type { ViewMode, CanvasScene, CanvasFrame, CanvasNode, CanvasShape, NodeAgent } from './canvasSlice'
export { serializeCanvas } from './canvasSlice'
export type { PersistedCanvas } from './canvasSlice'
export { paneKindForFile } from './shared'

export const useStore = create<AppState>()((...a) => ({
  ...createProjectsSlice(...a),
  ...createTabsSlice(...a),
  ...createUiSlice(...a),
  ...createCanvasSlice(...a)
}))
