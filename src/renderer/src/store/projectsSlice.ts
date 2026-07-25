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
