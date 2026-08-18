// zustand 全局状态：按域切片（项目 / 标签+面板树 / UI），此处组合导出。
// 组件一律 `import { useStore } from '../store'`，对外 API 与切片划分无关。

import { create } from 'zustand'
import { createProjectsSlice } from './projectsSlice'
import { createTabsSlice } from './tabsSlice'
import { createUiSlice } from './uiSlice'
import { createCanvasSlice } from './canvasSlice'
import type { AppState } from './types'
import { pushUndo, snapshotOf } from './canvas/undo'

export type { AppState } from './types'
export type { TermTab } from './shared'
export type {
  ViewMode,
  CanvasScene,
  CanvasFrame,
  CanvasNode,
  CanvasShape,
  FrameStatus,
  NodeAgent,
  TodoBoard,
  TodoItem
} from './canvasSlice'
export { serializeCanvas } from './canvasSlice'
export type { PersistedCanvas } from './canvasSlice'
export { paneKindForFile } from './shared'

export const useStore = create<AppState>()((...a) => ({
  ...createProjectsSlice(...a),
  ...createTabsSlice(...a),
  ...createUiSlice(...a),
  ...createCanvasSlice(...a)
}))

// ── 画布撤销的记录触发器 ──────────────────────────────────────────────────
//
// **在这里 subscribe，而不是在 53 个改 canvas 的 action 里各写一句 record()。**
// 那 53 处只要漏一处，漏的那步就撤不回来，而且是「平时好好的、某个操作之后
// 突然撤销跳了一步」这种最难查的漏法。订阅拿到的是结果，不挑操作，也就漏不掉；
// 以后新增第 54 个 action 同样自动被覆盖。
//
// 记的是**变化前**那份。撤销就是「回到变化前」，存旧值最直接，也不需要在撤销时
// 再去 flush 什么待落栈的东西。
//
// 合并窗口 250ms：拖一个节点会连着产生几十帧变化，不合并的话一次拖动就把 20 步
// 吃光了。250ms 挑得住手动的连续两次删除（人手没那么快），又能把一次拖拽收成一步。
let lastRecordAt = 0
let prevSnapshot: string | null = null
const MERGE_MS = 250

useStore.subscribe((state, prev) => {
  if (!state.undoReady) return
  // 撤销/重做自己改 canvas 时，栈是同一次 set 里换掉的 —— 用它区分「用户操作」
  // 和「撤销本身」，不然按一次撤销会把撤销的结果又记成一步，越撤越乱
  if (state.canvasUndo !== prev.canvasUndo) {
    prevSnapshot = snapshotOf(state.canvas)
    return
  }
  if (state.canvas === prev.canvas) return
  const before = prevSnapshot ?? snapshotOf(prev.canvas)
  const after = snapshotOf(state.canvas)
  prevSnapshot = after
  if (before === after) return // 只动了 viewport，或者数组重建但内容没变
  const now = Date.now()
  if (now - lastRecordAt < MERGE_MS) return
  lastRecordAt = now
  useStore.setState((s) => ({ canvasUndo: pushUndo(s.canvasUndo, before) }))
})
