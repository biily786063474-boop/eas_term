// 标签/面板切片：标签页生命周期 + Blender 式面板树操作 + 各类「在主区域打开」入口

import type { StateCreator } from 'zustand'
import {
  LeafNode,
  SplitNode,
  PaneKind,
  PaneState,
  DiffSpec,
  collectLeaves,
  replaceLeaf,
  removeLeaf,
  updateRatio,
  updatePane,
  firstLeaf
} from '../layout'
import {
  TermTab,
  uid,
  projectKey,
  paneKindForFile, isWebFile, fileUrlOf,
  killPanePty,
  terminalPtyIds,
  closeTabInState
} from './shared'
import type { AppState } from './types'
import { track } from '../features/notify/track'

export interface TabsSlice {
  tabs: TermTab[]
  activeTabId: string | null
  /** 每个项目上次激活的标签，切换项目时据此恢复 */
  activeTabByProject: Record<string, string | null>

  openTerminal: (opts?: { projectId?: string | null; cwd?: string }) => Promise<void>
  /** 开一个 AI 对话面板（空态，用户选完 CLI 发第一条消息才真正起会话）。
   *  与 openTerminal 同构，差别只在建的 pane 是 agent —— **不 spawn pty**，
   *  所以不能拿 openTerminal + setPaneKind 凑：那样会先起一个 shell 再丢掉。 */
  openAgentPane: (opts?: {
    projectId?: string | null
    cwd?: string
    /** 'team' = 团队派生：关节点只收视图、不杀进程（见 store/closePolicy.ts） */
    owner?: 'team'
    /** 团队角色名，面板按它列「谁在干什么」 */
    role?: string
    /** 挂载后自动发出去的首条消息（派活） */
    initialMessage?: string
  }) => Promise<void>
  openFile: (filePath: string) => Promise<void>
  openDiff: (spec: DiffSpec) => void
  openHistory: (cwd: string) => void
  openChat: (cwd: string) => void
  /** 在分屏里开一个网页面板。终端里蹦出来的链接走这条路 ——
   *  画布上没有 Frame 可放时的去处，总比把人踢去系统浏览器强 */
  openWeb: (url: string) => void
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
  /** agent 会话真正建立后，把 sessionId 写回这个 leaf 的 PaneState——killPanePty
   *  （shared.ts）关闭节点时只认这里存的值，组件本地的 useState 它够不着。
   *  找不到这个 leaf（面板已经被整个关掉）就安静地不做事，不抛错。 */
  setAgentSessionId: (tabId: string, leafId: string, sessionId: string) => void
  /** 把 CLI 自己的会话 id 写回这个 leaf 的 PaneState。**与 sessionId 是两回事**：
   *  这个会随 canvas.json 落盘，下次打开这个节点靠它续上上次的上下文
   *  （Claude `--resume` / Codex `exec resume`）。 */
  setAgentResumeId: (tabId: string, leafId: string, resumeId: string) => void
  /** 派活的首条消息发出去之后清掉它。**必须清** —— 不清的话组件重新挂载
   *  （切视图、面板重排）会把同一条任务再发一遍，等于白烧一次。 */
  clearAgentInitialMessage: (tabId: string, leafId: string) => void
  setActiveLeaf: (tabId: string, leafId: string) => void
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void
}

type Set = Parameters<StateCreator<AppState, [], [], TabsSlice>>[0]
type Get = Parameters<StateCreator<AppState, [], [], TabsSlice>>[1]

// openFile / openDiff / openHistory / openChat 的公共骨架：
// ①没有活动标签 → 新建标签承载该面板；②当前标签里已有同类面板 → 复用并激活；
// ③否则从活动面板向右分屏出一个（IDE 预览习惯）。
function openInPane(
  set: Set,
  get: Get,
  pane: PaneState,
  reuseKind: PaneKind,
  fallback: { title: string; cwd: string }
): void {
  const s = get()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)

  if (!tab) {
    const project = s.projects.find((p) => p.id === s.activeProjectId) ?? null
    const leaf: LeafNode = { type: 'leaf', id: uid('leaf'), pane }
    const newTab: TermTab = {
      id: uid('tab'),
      title: project?.name ?? fallback.title,
      projectId: project?.id ?? null,
      cwd: project?.path ?? fallback.cwd,
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

  const existing = collectLeaves(tab.root).find((l) => l.pane.kind === reuseKind)
  if (existing) {
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id === tab.id
          ? { ...t, root: updatePane(t.root, existing.id, pane), activeLeafId: existing.id }
          : t
      )
    }))
    return
  }

  const newLeaf: LeafNode = { type: 'leaf', id: uid('leaf'), pane }
  set((st) => ({
    tabs: st.tabs.map((t) => {
      if (t.id !== tab.id) return t
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
}

export const createTabsSlice: StateCreator<AppState, [], [], TabsSlice> = (set, get) => ({
  tabs: [],
  activeTabId: null,
  activeTabByProject: {},

  openTerminal: async (opts) => {
    track('term')
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

  // 与 openTerminal 同构（标题/cwd/activeTabByProject 的处理逐条对齐），
  // 唯一的差别是不 spawn pty —— agent 面板在用户发第一条消息之前不占任何进程。
  openAgentPane: async (opts) => {
    track('agent')
    const s = get()
    const projectId = opts?.projectId !== undefined ? opts.projectId : s.activeProjectId
    const project = s.projects.find((p) => p.id === projectId) ?? null
    const cwd = opts?.cwd ?? project?.path ?? ''
    const leaf: LeafNode = {
      type: 'leaf',
      id: uid('leaf'),
      pane: { kind: 'agent', cwd, owner: opts?.owner, role: opts?.role, initialMessage: opts?.initialMessage }
    }
    const tab: TermTab = {
      id: uid('tab'),
      title: project?.name ?? (cwd ? cwd.split('/').pop() || cwd : 'AI 对话'),
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

  // 文件树点击：图片进图片面板，其余进代码面板
  openFile: async (filePath) => {
    // 网页类文件（HTML）用浏览器打开，但**不跨模式跳转**：
    //  · 画布模式 → 在画布新建一个浏览器节点（就地预览 + 聚焦）
    //  · 终端(分屏)模式 → 在分屏里开一个网页面板预览（留在当前模式，不跳画布）
    if (isWebFile(filePath)) {
      const s = get()
      if (s.viewMode === 'canvas') {
        const frame =
          s.canvas.frames.find((f) => !f.parentId && f.projectId === s.activeProjectId) ??
          s.canvas.frames.find((f) => !f.parentId)
        if (frame) {
          s.addWebNode(frame.id, fileUrlOf(filePath))
          return
        }
      } else {
        openInPane(set, get, { kind: 'web', url: fileUrlOf(filePath) }, 'web', {
          title: '预览',
          cwd: ''
        })
        return
      }
    }
    const kind = paneKindForFile(filePath)
    openInPane(set, get, { kind, filePath }, kind, { title: '预览', cwd: '' })
  },

  // 侧栏「版本」标签点击变更文件：把该文件的 diff 开在主区域（复用代码面板）
  openDiff: (spec) => {
    openInPane(
      set,
      get,
      { kind: 'code', filePath: spec.relPath, diff: spec },
      'code',
      { title: '改动', cwd: spec.cwd }
    )
  },

  // 侧栏「版本」→「分支图」：SourceTree 式历史大视图
  openHistory: (cwd) => {
    openInPane(set, get, { kind: 'history', cwd }, 'history', { title: '历史', cwd })
  },

  // 终端头部「对话导航」：Claude Code 对话回看
  openChat: (cwd) => {
    openInPane(set, get, { kind: 'chat', cwd }, 'chat', { title: '对话', cwd })
  },

  openWeb: (url) => {
    openInPane(set, get, { kind: 'web', url }, 'web', { title: '预览', cwd: '' })
  },

  closeTab: (tabId) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return
    for (const leaf of collectLeaves(tab.root)) killPanePty(leaf.pane)
    set(closeTabInState(s.tabs, s.activeTabId, s.activeTabByProject, tabId))
    // 这条一次带走整棵树的 leaf，画布上引用它们的节点全成孤儿——同 closeLeaf 的理由
    get().pruneOrphanNodes()
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
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      // 标题没变就原样返回，别造新数组。
      // 终端的 OSC 标题来得很密（shell 每次提示符都发一遍、agent 更是每帧都发），
      // 不短路的话每一次都会让订阅 tabs 的组件重渲染一轮 —— 而内容根本没动。
      if (!tab || !title || tab.customTitle || tab.title === title) return s
      return { tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) }
    }),

  // 用户手动重命名；传空字符串则恢复自动标题。同时同步画布里对应终端节点的名字（双向一致）
  renameTab: (tabId, title) =>
    set((s) => {
      const trimmed = title.trim()
      const tab = s.tabs.find((t) => t.id === tabId)
      const leafIds = new Set(tab ? collectLeaves(tab.root).map((l) => l.id) : [])
      const frames = leafIds.size
        ? s.canvas.frames.map((f) => ({
            ...f,
            nodes: f.nodes.map((n) =>
              n.leafId && leafIds.has(n.leafId) ? { ...n, name: trimmed || undefined } : n
            )
          }))
        : s.canvas.frames
      return {
      canvas: { ...s.canvas, frames },
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        if (!trimmed) {
          const project = s.projects.find((p) => p.id === t.projectId)
          return { ...t, title: project?.name ?? '终端', customTitle: false }
        }
        return { ...t, title: trimmed, customTitle: true }
      })
      }
    }),

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
    // 节点被永久关闭 → 它的聊天记录也没有任何入口能看到了，一起清掉。
    // **只在这条「真的移除节点」的路径上清** —— 关标签页/切项目那几条不清，
    // 那些场景下节点还会回来（布局是持久化的）。
    if (target.pane.kind === 'agent') void window.api.agentChat.forgetHistory(leafId)
    const newRoot = removeLeaf(tab.root, leafId)
    if (newRoot === null) {
      set(closeTabInState(s.tabs, s.activeTabId, s.activeTabByProject, tabId))
      get().pruneOrphanNodes()
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
    // 画布上可能有个节点正引用着这个 leaf——不清掉就成了「空白的占位」：
    // PaneLayer 找不到 leaf 于是什么都不渲染，框还在那儿占着位置。
    // 用整体扫描而不是定点删：关整个 tab（上面那条 return）一次会带走多个 leaf，
    // 定点删还得在那里再写一遍，两处迟早对不上。幂等，没孤儿时空转。
    get().pruneOrphanNodes()
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
    if (!target) return
    // 同类切换直接忽略——唯一例外：code 面板带 diff 时选「代码预览」= 去掉 diff 回到普通预览
    const isDiffPane = target.pane.kind === 'code' && !!target.pane.diff
    if (target.pane.kind === kind && !(kind === 'code' && isDiffPane)) return
    killPanePty(target.pane)
    // 面板换成别的类型 = 这个对话框没了，同上
    if (target.pane.kind === 'agent') void window.api.agentChat.forgetHistory(leafId)
    let pane: PaneState
    if (kind === 'terminal') {
      const { id: ptyId } = await window.api.pty.create({ cwd: tab.cwd || undefined })
      pane = { kind: 'terminal', ptyId }
    } else if (kind === 'history') {
      pane = { kind: 'history', cwd: tab.cwd }
    } else if (kind === 'chat') {
      pane = { kind: 'chat', cwd: tab.cwd }
    } else if (kind === 'agent') {
      // 不出现在面板下拉框里（唯一入口是子项目 C 的画布默认节点），但 PaneKind 一扩员，
      // 下面兜底的 else 分支（`{ kind, filePath: null }`）就会尝试拿它去凑 code/image 的
      // 形状——编译不过。照 history/chat 的样子单独分支，只是为了让这个联合类型保持穷尽。
      pane = { kind: 'agent', cwd: tab.cwd }
    } else if (kind === 'dict') {
      pane = { kind: 'dict' }
    } else if (kind === 'wiki') {
      pane = { kind: 'wiki' }
    } else if (kind === 'web') {
      pane = { kind: 'web', url: null }
    } else {
      pane = { kind, filePath: null }
    }
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id === tabId ? { ...t, root: updatePane(t.root, leafId, pane) } : t
      )
    }))
  },

  // agent 会话建立成功后调用（AgentChatView），把 sessionId 落进 store 而不是只留在
  // 组件的 useState 里——2026-08-15 审查 Important：killPanePty 关闭节点时只能读到
  // 这里存的 PaneState.sessionId，组件本地状态它完全够不着，不写回的话「关掉正在跑
  // 的 agent 节点」不会停底层 CLI 进程，会在主进程那边空转到 15 分钟空闲回收阈值——
  // 期间可能仍在执行工具调用，真实消耗 API token。
  // 独立于组件生命周期：调用方即使已经卸载也该在拿到 sessionId 的第一时间调这个
  // （不要等 setState 生效），否则「start() 的 await 还没回来、面板就被关掉」这种
  // 时序下 sessionId 从诞生起就不可追踪。找不到这个 leaf（面板已经整个被关掉/tab
  // 已经整个消失）时安静地原样返回，不抛错——那种情况下会话确实已不可追踪，是
  // 已知的窄窗口边界，见 task-3-report.md。
  setAgentSessionId: (tabId, leafId, sessionId) => {
    set((st) => ({
      tabs: st.tabs.map((t) => {
        if (t.id !== tabId) return t
        const leaf = collectLeaves(t.root).find((l) => l.id === leafId)
        if (!leaf || leaf.pane.kind !== 'agent') return t
        const pane: PaneState = { ...leaf.pane, sessionId }
        return { ...t, root: updatePane(t.root, leafId, pane) }
      })
    }))
  },

  clearAgentInitialMessage: (tabId, leafId) => {
    set((st) => ({
      tabs: st.tabs.map((t) => {
        if (t.id !== tabId) return t
        const leaf = collectLeaves(t.root).find((l) => l.id === leafId)
        if (!leaf || leaf.pane.kind !== 'agent' || !leaf.pane.initialMessage) return t
        const pane: PaneState = { ...leaf.pane, initialMessage: undefined }
        return { ...t, root: updatePane(t.root, leafId, pane) }
      })
    }))
  },

  // 与 setAgentSessionId 同构，但存的是**另一个 id**：CLI 自己的会话 id。
  // 它会随 canvas.json 落盘，是「关掉再打开还接得上上次的上下文」的全部依据。
  setAgentResumeId: (tabId, leafId, resumeId) => {
    set((st) => ({
      tabs: st.tabs.map((t) => {
        if (t.id !== tabId) return t
        const leaf = collectLeaves(t.root).find((l) => l.id === leafId)
        if (!leaf || leaf.pane.kind !== 'agent') return t
        if (leaf.pane.resumeId === resumeId) return t // 同一个值不必制造新对象
        const pane: PaneState = { ...leaf.pane, resumeId }
        return { ...t, root: updatePane(t.root, leafId, pane) }
      })
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
          : s.activeTabByProject,
        // 点进画布上某个终端 = 你正在操作那个项目，右侧抽屉的项目高亮和文件树要跟着换。
        // 没有 projectId 的标签（散终端）保持原样，别把抽屉清空。
        //
        // **只在画布模式下跟**：分屏模式的侧栏项目是你自己点选的，
        // 在 A 的文件树里翻着翻着、顺手点一下 B 的终端就被跳走，那是添乱。
        activeProjectId:
          s.viewMode === 'canvas' ? (tab?.projectId ?? s.activeProjectId) : s.activeProjectId
      }
    }),

  setSplitRatio: (tabId, splitId, ratio) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, root: updateRatio(t.root, splitId, ratio) } : t
      )
    }))
})
