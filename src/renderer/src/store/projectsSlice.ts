// 项目切片：项目列表的增删与激活（涉及被移除项目名下标签/PTY 的清理）

import type { StateCreator } from 'zustand'
import type { Project, ProjectStatus } from '../../../shared/types'
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
  /** 打/清项目状态标签（null = 未分类）。**这是状态的唯一写入口** ——
   *  看板拖拽、画布 Frame 右键、分屏 tab 右键都走它，各写各的迟早对不上 */
  setProjectStatus: (id: string, status: ProjectStatus | null) => Promise<void>
  /** 一次性迁移：旧存档把状态记在 canvas.json 的 frame.status 上。
   *  搬到项目里，搬完清掉旧字段，免得两处并存以后打架。启动时调一次。 */
  migrateFrameStatus: () => Promise<void>
}

export const createProjectsSlice: StateCreator<AppState, [], [], ProjectsSlice> = (set, get) => ({
  projects: [],
  activeProjectId: null,

  setProjectStatus: async (id, status) => {
    // 先本地改再落盘：拖拽时卡片要立刻跟着走，等 IPC 往返回来会有一帧的滞后感
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, status: status ?? undefined } : p
      )
    }))
    const projects = await window.api.projects.setStatus(id, status)
    set({ projects })
  },

  migrateFrameStatus: async () => {
    const s = get()
    const move: [string, ProjectStatus][] = []
    for (const f of s.canvas.frames) {
      if (!f.status || !f.projectId) continue
      const p = s.projects.find((x) => x.id === f.projectId)
      // 项目自己已经有状态就不覆盖：那是用户在新版里设的，比存档里的旧值新
      if (!p || p.status) continue
      move.push([f.projectId, f.status])
    }
    for (const [id, st] of move) await get().setProjectStatus(id, st)
    // 不管有没有搬动，只要还留着旧字段就清掉 —— 留着的话画布看一份、看板看另一份
    if (s.canvas.frames.some((f) => f.status)) get().clearFrameStatusField()
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
    // 这个项目名下的 leaf 全没了，画布上引用它们的节点成了孤儿（渲染出来是空白占位）。
    // 注意 Frame 本身留着不删——那是既有行为（项目没了 Frame 还在，见 materializeCanvas
    // 里「项目已被删除的 Frame：跳过重开终端」那条），这里只清指向死 leaf 的节点。
    get().pruneOrphanNodes()
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
