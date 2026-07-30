// 项目切片：项目列表的增删与激活（涉及被移除项目名下标签/PTY 的清理）

import type { StateCreator } from 'zustand'
import type { Project } from '../../../shared/types'
import { collectLeaves } from '../layout'
import { killPanePty, pickActiveTab, projectKey } from './shared'
import type { AppState } from './types'

export interface ProjectsSlice {
  projects: Project[]
  activeProjectId: string | null
  loadProjects: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  /** 改项目显示名（不动磁盘目录）。连带同步那些「还没被用户手动改过名」的
   *  画布 Frame 和标签标题 —— 它们的名字本来就是创建时从项目名拷过来的快照。 */
  renameProject: (id: string, name: string) => Promise<void>
  setActiveProject: (id: string | null) => void
}

export const createProjectsSlice: StateCreator<AppState, [], [], ProjectsSlice> = (set, get) => ({
  projects: [],
  activeProjectId: null,

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

  renameProject: async (id, name) => {
    const old = get().projects.find((p) => p.id === id)?.name
    const projects = await window.api.projects.rename(id, name)
    const next = projects.find((p) => p.id === id)?.name
    if (!next || next === old) {
      set({ projects })
      return
    }
    set((s) => ({
      projects,
      // Frame 名等于旧项目名 = 用户没手动改过它（创建时就是拷的项目名），跟着更新；
      // 已经被改成别的了就别动 —— 那是用户自己起的名字
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.projectId === id && f.name === old ? { ...f, name: next } : f
        )
      },
      // 标签标题有 customTitle 明确标记「用户改过」，直接照它判断
      tabs: s.tabs.map((t) => (t.projectId === id && !t.customTitle ? { ...t, title: next } : t))
    }))
  },

  setActiveProject: (id) => {
    const s = get()
    if (s.activeProjectId === id) return
    // 切到某项目 → 清除其终端的「任务完成」提醒（满足「点击项目后消除」）
    const ptys = new Set(
      s.tabs
        .filter((t) => t.projectId === id)
        .flatMap((t) => collectLeaves(t.root))
        .filter((l) => l.pane.kind === 'terminal')
        .map((l) => (l.pane as { ptyId: string }).ptyId)
    )
    set({
      activeProjectId: id,
      activeTabId: pickActiveTab(s.tabs, s.activeTabByProject, id),
      attentionPtys: ptys.size ? s.attentionPtys.filter((p) => !ptys.has(p)) : s.attentionPtys
    })
  }
})
