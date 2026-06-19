import { create } from 'zustand'
import type { Project } from '../../shared/types'
import { ThemeId, loadTheme, applyTheme } from './themes'
import {
  LayoutNode,
  LeafNode,
  SplitNode,
  PaneKind,
  PaneState,
  collectLeaves,
  replaceLeaf,
  removeLeaf,
  updateRatio,
  updatePane,
  firstLeaf
} from './layout'

export interface TermTab {
  id: string
  title: string
  /** 用户手动重命名后为 true，shell 的自动标题（OSC）不再覆盖 */
  customTitle?: boolean
  projectId: string | null
  cwd: string
  root: LayoutNode
  activeLeafId: string
}

let seq = 1
const uid = (prefix: string): string => `${prefix}-${seq++}-${Math.random().toString(36).slice(2, 7)}`

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])

export function paneKindForFile(filePath: string): 'code' | 'image' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.has(ext) ? 'image' : 'code'
}

function killPanePty(pane: PaneState): void {
  if (pane.kind === 'terminal') window.api.pty.kill(pane.ptyId)
}

function terminalPtyIds(root: LayoutNode): string[] {
  return collectLeaves(root).flatMap((l) => (l.pane.kind === 'terminal' ? [l.pane.ptyId] : []))
}

// 终端面板按项目隔离：activeTabByProject 记住每个项目上次激活的标签。
// projectId 可能为 null（无项目时打开的终端），统一映射成字符串 key。
const NO_PROJECT = '__none__'
const projectKey = (projectId: string | null): string => projectId ?? NO_PROJECT

/** 在指定项目范围内挑选应激活的标签：优先用记忆值，否则取该项目第一个标签 */
function pickActiveTab(
  tabs: TermTab[],
  activeTabByProject: Record<string, string | null>,
  projectId: string | null
): string | null {
  const remembered = activeTabByProject[projectKey(projectId)]
  const projectTabs = tabs.filter((t) => t.projectId === projectId)
  if (remembered && projectTabs.some((t) => t.id === remembered)) return remembered
  return projectTabs[0]?.id ?? null
}

interface CloseResult {
  tabs: TermTab[]
  activeTabId: string | null
  activeTabByProject: Record<string, string | null>
}

// 关闭一个标签：在同项目内选相邻标签接替，绝不跨项目跳转
function closeTabInState(
  tabs: TermTab[],
  activeTabId: string | null,
  activeTabByProject: Record<string, string | null>,
  tabId: string
): CloseResult {
  const closing = tabs.find((t) => t.id === tabId)
  const next = tabs.filter((t) => t.id !== tabId)
  if (!closing) return { tabs: next, activeTabId, activeTabByProject }

  const pk = projectKey(closing.projectId)
  const sameBefore = tabs.filter((t) => t.projectId === closing.projectId)
  const closingIdx = sameBefore.findIndex((t) => t.id === tabId)
  const sameAfter = next.filter((t) => t.projectId === closing.projectId)
  const fallback = sameAfter[Math.min(closingIdx, sameAfter.length - 1)]?.id ?? null

  const nextMap = { ...activeTabByProject }
  if (nextMap[pk] === tabId) {
    if (fallback) nextMap[pk] = fallback
    else delete nextMap[pk]
  }
  return {
    tabs: next,
    activeTabId: activeTabId === tabId ? fallback : activeTabId,
    activeTabByProject: nextMap
  }
}

interface PendingConfirm {
  message: string
  confirmLabel: string
  onConfirm: () => void
}

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  tabs: TermTab[]
  activeTabId: string | null
  /** 每个项目上次激活的标签，切换项目时据此恢复 */
  activeTabByProject: Record<string, string | null>
  /** 危险操作确认弹窗（终端运行中关闭/退出时触发） */
  pendingConfirm: PendingConfirm | null
  requestConfirm: (c: PendingConfirm) => void
  cancelConfirm: () => void
  theme: ThemeId
  setTheme: (theme: ThemeId) => void

  loadProjects: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  setActiveProject: (id: string | null) => void

  openTerminal: (opts?: { projectId?: string | null; cwd?: string }) => Promise<void>
  openFile: (filePath: string) => Promise<void>
  closeTab: (tabId: string) => void
  closeTabSafely: (tabId: string) => Promise<void>
  setActiveTab: (tabId: string) => void
  setTabTitle: (tabId: string, title: string) => void
  renameTab: (tabId: string, title: string) => void

  splitLeaf: (tabId: string, leafId: string, dir: 'row' | 'column') => Promise<void>
  closeLeaf: (
    tabId: string,
    leafId: string,
    opts?: { alreadyExited?: boolean; ptyId?: string }
  ) => void
  closeLeafSafely: (tabId: string, leafId: string) => Promise<void>
  setPaneKind: (tabId: string, leafId: string, kind: PaneKind) => Promise<void>
  setActiveLeaf: (tabId: string, leafId: string) => void
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void
}

export const useStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  tabs: [],
  activeTabId: null,
  activeTabByProject: {},
  pendingConfirm: null,
  theme: loadTheme(),

  requestConfirm: (c) => set({ pendingConfirm: c }),
  cancelConfirm: () => set({ pendingConfirm: null }),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },

  loadProjects: async () => {
    const projects = await window.api.projects.list()
    set((s) => ({
      projects,
      activeProjectId:
        s.activeProjectId && projects.some((p) => p.id === s.activeProjectId)
          ? s.activeProjectId
          : (projects[0]?.id ?? null)
    }))
  },

  addProject: async () => {
    const before = get().projects.map((p) => p.id)
    const projects = await window.api.projects.addViaDialog()
    const added = projects.find((p) => !before.includes(p.id))
    if (added) {
      // 切到新项目；它还没有任何标签，右侧显示空状态
      set({ projects, activeProjectId: added.id, activeTabId: null })
    } else {
      set({ projects })
    }
  },

  removeProject: async (id) => {
    const s = get()
    // 关闭被移除项目名下所有标签的 PTY，避免泄漏
    for (const tab of s.tabs.filter((t) => t.projectId === id)) {
      for (const leaf of collectLeaves(tab.root)) killPanePty(leaf.pane)
    }
    const remainingTabs = s.tabs.filter((t) => t.projectId !== id)
    const projects = await window.api.projects.remove(id)
    const activeTabByProject = { ...s.activeTabByProject }
    delete activeTabByProject[projectKey(id)]

    let activeProjectId = s.activeProjectId
    let activeTabId = s.activeTabId
    if (s.activeProjectId === id) {
      activeProjectId = projects[0]?.id ?? null
      activeTabId = pickActiveTab(remainingTabs, activeTabByProject, activeProjectId)
    }
    set({ projects, tabs: remainingTabs, activeProjectId, activeTabId, activeTabByProject })
  },

  setActiveProject: (id) => {
    const s = get()
    if (s.activeProjectId === id) return
    set({ activeProjectId: id, activeTabId: pickActiveTab(s.tabs, s.activeTabByProject, id) })
  },

  openTerminal: async (opts) => {
    const s = get()
    const projectId = opts?.projectId !== undefined ? opts.projectId : s.activeProjectId
    const project = s.projects.find((p) => p.id === projectId) ?? null
    const cwd = opts?.cwd ?? project?.path ?? ''
    const { id: ptyId } = await window.api.pty.create({ cwd: cwd || undefined })
    const leaf: LeafNode = { type: 'leaf', id: uid('leaf'), pane: { kind: 'terminal', ptyId } }
    const tab: TermTab = {
      id: uid('tab'),
      title: project?.name ?? (cwd ? cwd.split('/').pop() || cwd : '终端'),
      projectId: project?.id ?? null,
      cwd,
      root: leaf,
      activeLeafId: leaf.id
    }
    set((st) => ({
      tabs: [...st.tabs, tab],
      activeTabId: tab.id,
      activeTabByProject: { ...st.activeTabByProject, [projectKey(tab.projectId)]: tab.id }
    }))
  },

  // 文件树点击：图片进图片面板，其余进代码面板。
  // 优先复用当前标签页里同类型的面板（IDE 预览习惯）；没有则从活动面板分屏出一个。
  openFile: async (filePath) => {
    const kind = paneKindForFile(filePath)
    const s = get()
    let tab = s.tabs.find((t) => t.id === s.activeTabId)

    if (!tab) {
      const project = s.projects.find((p) => p.id === s.activeProjectId) ?? null
      const leaf: LeafNode = { type: 'leaf', id: uid('leaf'), pane: { kind, filePath } }
      const newTab: TermTab = {
        id: uid('tab'),
        title: project?.name ?? '预览',
        projectId: project?.id ?? null,
        cwd: project?.path ?? '',
        root: leaf,
        activeLeafId: leaf.id
      }
      set((st) => ({
        tabs: [...st.tabs, newTab],
        activeTabId: newTab.id,
        activeTabByProject: {
          ...st.activeTabByProject,
          [projectKey(newTab.projectId)]: newTab.id
        }
      }))
      return
    }

    const existing = collectLeaves(tab.root).find((l) => l.pane.kind === kind)
    if (existing) {
      set((st) => ({
        tabs: st.tabs.map((t) =>
          t.id === tab!.id
            ? {
                ...t,
                root: updatePane(t.root, existing.id, { kind, filePath }),
                activeLeafId: existing.id
              }
            : t
        )
      }))
      return
    }

    const newLeaf: LeafNode = { type: 'leaf', id: uid('leaf'), pane: { kind, filePath } }
    set((st) => ({
      tabs: st.tabs.map((t) => {
        if (t.id !== tab!.id) return t
        const target = collectLeaves(t.root).find((l) => l.id === t.activeLeafId)
        if (!target) return t
        const split: SplitNode = {
          type: 'split',
          id: uid('split'),
          dir: 'row',
          ratio: 0.5,
          children: [target, newLeaf]
        }
        return { ...t, root: replaceLeaf(t.root, target.id, split), activeLeafId: newLeaf.id }
      })
    }))
  },

  closeTab: (tabId) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return
    for (const leaf of collectLeaves(tab.root)) killPanePty(leaf.pane)
    set(closeTabInState(s.tabs, s.activeTabId, s.activeTabByProject, tabId))
  },

  // 用户主动关闭标签：若内含运行中的终端，先弹确认
  closeTabSafely: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    const ptyIds = terminalPtyIds(tab.root)
    const busy = ptyIds.length ? await window.api.pty.busyByIds(ptyIds) : []
    if (busy.length) {
      get().requestConfirm({
        message:
          ptyIds.length > 1
            ? '该标签页中有命令正在运行，关闭会终止它们。确定关闭吗？'
            : '该标签页中有命令正在运行，关闭会终止它。确定关闭吗？',
        confirmLabel: '关闭标签页',
        onConfirm: () => get().closeTab(tabId)
      })
    } else {
      get().closeTab(tabId)
    }
  },

  setActiveTab: (tabId) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      return {
        activeTabId: tabId,
        activeTabByProject: tab
          ? { ...s.activeTabByProject, [projectKey(tab.projectId)]: tabId }
          : s.activeTabByProject
      }
    }),

  // shell 通过 OSC 序列设置的自动标题；用户手动改过名的标签不受影响
  setTabTitle: (tabId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && title && !t.customTitle ? { ...t, title } : t
      )
    })),

  // 用户手动重命名；传空字符串则恢复自动标题
  renameTab: (tabId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        const trimmed = title.trim()
        if (!trimmed) {
          const project = s.projects.find((p) => p.id === t.projectId)
          return { ...t, title: project?.name ?? '终端', customTitle: false }
        }
        return { ...t, title: trimmed, customTitle: true }
      })
    })),

  // Blender 风格：分屏克隆当前面板的类型与内容（终端则新开一个 shell）
  splitLeaf: async (tabId, leafId, dir) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const target = collectLeaves(tab.root).find((l) => l.id === leafId)
    if (!target) return
    let pane: PaneState
    if (target.pane.kind === 'terminal') {
      const { id: ptyId } = await window.api.pty.create({ cwd: tab.cwd || undefined })
      pane = { kind: 'terminal', ptyId }
    } else {
      pane = { ...target.pane }
    }
    const newLeaf: LeafNode = { type: 'leaf', id: uid('leaf'), pane }
    set((st) => ({
      tabs: st.tabs.map((t) => {
        if (t.id !== tabId) return t
        const cur = collectLeaves(t.root).find((l) => l.id === leafId)
        if (!cur) return t
        const split: SplitNode = {
          type: 'split',
          id: uid('split'),
          dir,
          ratio: 0.5,
          children: [cur, newLeaf]
        }
        return { ...t, root: replaceLeaf(t.root, leafId, split), activeLeafId: newLeaf.id }
      })
    }))
  },

  closeLeaf: (tabId, leafId, opts) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const target = collectLeaves(tab.root).find((l) => l.id === leafId)
    if (!target) return
    // PTY 退出回调触发的关闭：面板可能已被切换成其他类型/其他 pty，此时忽略
    if (opts?.ptyId) {
      if (target.pane.kind !== 'terminal' || target.pane.ptyId !== opts.ptyId) return
    }
    if (!opts?.alreadyExited) killPanePty(target.pane)
    const newRoot = removeLeaf(tab.root, leafId)
    if (newRoot === null) {
      set(closeTabInState(s.tabs, s.activeTabId, s.activeTabByProject, tabId))
      return
    }
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              root: newRoot,
              activeLeafId:
                t.activeLeafId === leafId ? firstLeaf(newRoot).id : t.activeLeafId
            }
          : t
      )
    }))
  },

  // 用户主动关闭面板：若是运行中的终端，先弹确认
  closeLeafSafely: async (tabId, leafId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    const leaf = tab && collectLeaves(tab.root).find((l) => l.id === leafId)
    if (!leaf) return
    const ptyIds = leaf.pane.kind === 'terminal' ? [leaf.pane.ptyId] : []
    const busy = ptyIds.length ? await window.api.pty.busyByIds(ptyIds) : []
    if (busy.length) {
      get().requestConfirm({
        message: '该面板中有命令正在运行，关闭会终止它。确定关闭吗？',
        confirmLabel: '关闭面板',
        onConfirm: () => get().closeLeaf(tabId, leafId)
      })
    } else {
      get().closeLeaf(tabId, leafId)
    }
  },

  // 面板功能下拉框切换（Blender 的编辑器类型切换）
  setPaneKind: async (tabId, leafId, kind) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const target = collectLeaves(tab.root).find((l) => l.id === leafId)
    if (!target || target.pane.kind === kind) return
    killPanePty(target.pane)
    let pane: PaneState
    if (kind === 'terminal') {
      const { id: ptyId } = await window.api.pty.create({ cwd: tab.cwd || undefined })
      pane = { kind: 'terminal', ptyId }
    } else {
      pane = { kind, filePath: null }
    }
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id === tabId ? { ...t, root: updatePane(t.root, leafId, pane) } : t
      )
    }))
  },

  setActiveLeaf: (tabId, leafId) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      return {
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, activeLeafId: leafId } : t)),
        activeTabId: tabId,
        activeTabByProject: tab
          ? { ...s.activeTabByProject, [projectKey(tab.projectId)]: tabId }
          : s.activeTabByProject
      }
    }),

  setSplitRatio: (tabId, splitId, ratio) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, root: updateRatio(t.root, splitId, ratio) } : t
      )
    }))
}))
