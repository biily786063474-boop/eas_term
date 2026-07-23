// UI 切片：主题、危险操作确认弹窗、跨面板的「最近活动终端」标记

import type { StateCreator } from 'zustand'
import { ThemeId, loadTheme, applyTheme } from '../themes'
import type { PendingConfirm } from './shared'
import type { AppState } from './types'

export interface UiSlice {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  /** 危险操作确认弹窗（终端运行中关闭/退出时触发） */
  pendingConfirm: PendingConfirm | null
  requestConfirm: (c: PendingConfirm) => void
  cancelConfirm: () => void
  /** 最近聚焦过的终端（供名词词典等非终端面板把文本插入光标处；打开词典后 activeLeaf 是词典自己，故单独记）。
   *  由 TerminalView 的 focusin 处理器直接 setState 写入。 */
  lastActiveTerminal: { tabId: string; ptyId: string } | null
  /** 需要用户处理的终端 ptyId（终端响铃触发、聚焦后清除）——供抽屉项目呼吸提示 */
  attentionPtys: string[]
  flagAttention: (ptyId: string) => void
  clearAttention: (ptyId: string) => void
}

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  theme: loadTheme(),
  pendingConfirm: null,
  lastActiveTerminal: null,
  attentionPtys: [],

  flagAttention: (ptyId) =>
    set((s) => (s.attentionPtys.includes(ptyId) ? s : { attentionPtys: [...s.attentionPtys, ptyId] })),
  clearAttention: (ptyId) =>
    set((s) =>
      s.attentionPtys.includes(ptyId)
        ? { attentionPtys: s.attentionPtys.filter((p) => p !== ptyId) }
        : s
    ),

  requestConfirm: (c) => set({ pendingConfirm: c }),
  cancelConfirm: () => set({ pendingConfirm: null }),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  }
})
