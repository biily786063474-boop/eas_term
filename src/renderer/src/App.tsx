import { useEffect } from 'react'
import { useStore, serializeCanvas } from './store'
import { collectLeaves } from './layout'
import { Sidebar } from './features/workspace/Sidebar'
import { TabBar } from './features/workspace/TabBar'
import { TerminalAttention } from './features/workspace/TerminalAttention'
import { McpIndicator } from './features/workspace/McpIndicator'
import { SkillPanel } from './features/workspace/SkillPanel'
import { AgentOnboarding } from './features/workspace/AgentOnboarding'
import { PaneLayer } from './features/workspace/PaneLayer'
import { CanvasStage } from './features/canvas/CanvasStage'
import { CanvasDrawer } from './features/canvas/CanvasDrawer'
import { CanvasWikiDrawer } from './features/canvas/CanvasWikiDrawer'
import { CanvasDictBubble } from './features/canvas/CanvasDictBubble'
import { ThemeSelect } from './ui/ThemeSelect'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Tooltip } from './ui/Tooltip'
import { FolderIcon, TerminalIcon, CanvasIcon } from './ui/Icons'

export function App(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const loadProjects = useStore((s) => s.loadProjects)
  const loadCanvas = useStore((s) => s.loadCanvas)
  const loadRoles = useStore((s) => s.loadRoles)
  const openTerminal = useStore((s) => s.openTerminal)
  const addProject = useStore((s) => s.addProject)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)

  // 启动：先载项目（画布 Frame 引用 projectId），再恢复画布场景；恢复完成后才挂保存订阅，
  // 避免空画布把持久化文件覆盖掉。之后画布/viewMode 变化防抖 500ms 落盘。
  // 关键：改动后 500ms 才落盘 → 若「改完就退/切走」这段没落盘会丢(如刚选的思考/模型档)。
  // 故失焦(blur)异步 flush、退出/刷新(beforeunload)同步 flush，杜绝这类丢失。
  useEffect(() => {
    let unsub = (): void => {}
    let timer: number | undefined
    let dirty = false // 有未落盘的画布改动

    const buildScene = (): unknown => {
      const st = useStore.getState()
      // 按 leafId 取该 leaf 当前 pane（供序列化区分「终端」与「被切成图片/代码/网页的节点」）
      const leafPaneOf = (leafId: string) => {
        for (const t of st.tabs) {
          const leaf = collectLeaves(t.root).find((l) => l.id === leafId)
          if (leaf) return leaf.pane
        }
        return undefined
      }
      return serializeCanvas(st.canvas, st.viewMode, leafPaneOf)
    }
    const flush = (sync = false): void => {
      if (!dirty) return
      dirty = false
      clearTimeout(timer)
      const scene = buildScene()
      if (sync) window.api.canvas.saveSync(scene)
      else void window.api.canvas.save(scene)
    }
    const onBlur = (): void => flush(false) // 失焦：还有时间，异步落盘
    const onBeforeUnload = (): void => flush(true) // 退出/刷新：同步落盘，阻塞到写完

    void (async () => {
      // 启动加载失败也不能吞掉后续:务必挂上保存订阅,否则整会话只出不进(数据不落盘)
      try {
        await loadProjects()
        await loadCanvas()
        void loadRoles() // 角色表：不阻塞首屏，读到就有
      } catch (e) {
        console.error('[App:startup] 加载项目/画布失败', e)
      }
      unsub = useStore.subscribe((s, prev) => {
        if (s.canvas === prev.canvas && s.viewMode === prev.viewMode) return
        dirty = true
        clearTimeout(timer)
        timer = window.setTimeout(() => flush(false), 500)
      })
      window.addEventListener('blur', onBlur)
      window.addEventListener('beforeunload', onBeforeUnload)
    })()
    return () => {
      flush(true) // 卸载(如热更/切路由)前也落一次,别丢
      clearTimeout(timer)
      unsub()
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [loadProjects, loadCanvas])

  // 终端里的 CLI 调 `open <url>`（AI 工具弹网页等）被 open shim 劫持 → 这里在画板内嵌浏览器打开，
  // 而不是弹系统 Safari。没有任何画布 Frame 时才回落系统浏览器。
  useEffect(() => {
    return window.api.shell.onOpenInCanvas((url) => {
      const s = useStore.getState()
      const frame =
        s.canvas.frames.find((f) => !f.parentId && f.projectId === s.activeProjectId) ??
        s.canvas.frames.find((f) => !f.parentId)
      if (!frame) {
        void window.api.shell.openExternal(url)
        return
      }
      if (s.viewMode !== 'canvas') s.setViewMode('canvas')
      s.addWebNode(frame.id, url)
    })
  }, [])

  // 全局快捷键：mac 用 ⌘、Windows/Linux 用 Ctrl。T 新终端、W 关面板、D 右分屏、⇧D 下分屏、1-9 切标签
  useEffect(() => {
    const isMac = window.api.platform === 'darwin'
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isMac ? !e.metaKey : !e.ctrlKey) return
      const s = useStore.getState()
      // 画布模式有自己的 ⌘D/Delete（复制/删除选中），不走分屏标签快捷键
      if (s.viewMode !== 'split') return
      const key = e.key.toLowerCase()
      if (key === 't') {
        e.preventDefault()
        void s.openTerminal({})
      } else if (key === 'w') {
        e.preventDefault()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        if (tab) void s.closeLeafSafely(tab.id, tab.activeLeafId)
      } else if (key === 'd') {
        e.preventDefault()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        if (tab) void s.splitLeaf(tab.id, tab.activeLeafId, e.shiftKey ? 'column' : 'row')
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        const projectTabs = s.tabs.filter((t) => t.projectId === s.activeProjectId)
        if (projectTabs[idx]) {
          e.preventDefault()
          s.setActiveTab(projectTabs[idx].id)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const activeProject = projects.find((p) => p.id === activeProjectId)
  // 当前项目是否有标签；没有则显示空状态（其他项目的标签仍挂载但隐藏）
  const hasProjectTabs = tabs.some((t) => t.projectId === activeProjectId)

  // 这些容器设计上永远不该滚——但 overflow:hidden **不阻止程序性滚动**。
  // 浏览器在退出 HTML5 全屏、focus() 或 scrollIntoView() 时会去滚动祖先滚动容器，
  // 画布世界比视口大得多（实测可滚 4700x7100），一滚整块 UI 就顶上去、顶部被裁，
  // 而且 viewport 状态没变，用户平移也拉不回来。一旦被滚就立刻复位。
  useEffect(() => {
    const GUARDED = '.canvas-viewport, .canvas-world, .pane-layer, .app, #root'
    const onScroll = (e: Event): void => {
      const el = e.target
      if (!(el instanceof HTMLElement) || !el.matches(GUARDED)) return
      if (el.scrollTop) el.scrollTop = 0
      if (el.scrollLeft) el.scrollLeft = 0
    }
    // 捕获阶段：scroll 不冒泡，只有 capture 能听到子元素的
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])

  return (
    <div className={`app${viewMode === 'canvas' ? ' canvas' : ''}`}>
      <div className="titlebar">
        {viewMode === 'split' && activeProject ? (
          <div className="titlebar-project" data-tip={activeProject.path}>
            <FolderIcon size={14} className="titlebar-project-icon" />
            <span className="titlebar-project-name">{activeProject.name}</span>
            <span className="titlebar-project-path">{activeProject.path}</span>
          </div>
        ) : (
          <span className="titlebar-title">Eas-Term</span>
        )}
        <div className="titlebar-actions">
          {viewMode === 'split' && <TerminalAttention />}
          <McpIndicator />
          <SkillPanel />
          <div className="view-seg">
            <button
              className={viewMode === 'split' ? 'on' : ''}
              onClick={() => setViewMode('split')}
            >
              <TerminalIcon size={13} />
              终端
            </button>
            <button
              className={viewMode === 'canvas' ? 'on' : ''}
              onClick={() => setViewMode('canvas')}
            >
              <CanvasIcon size={13} />
              画布
            </button>
          </div>
          <ThemeSelect />
        </div>
      </div>
      <div className="body">
        {viewMode === 'split' && <Sidebar />}
        <main className="main">
          {viewMode === 'split' && <TabBar />}
          <div className="tab-stack">
            {viewMode === 'split' && !hasProjectTabs && (
              <div className="empty-state">
                <div className="empty-card">
                  <div className="empty-title">没有打开的终端</div>
                  {projects.length === 0 ? (
                    <button className="primary-btn" onClick={() => void addProject()}>
                      添加项目文件夹
                    </button>
                  ) : (
                    <button className="primary-btn" onClick={() => void openTerminal({})}>
                      在 {activeProject?.name ?? '主目录'} 打开终端
                    </button>
                  )}
                  <div className="empty-hint">
                    <span>⌘T 新建终端 · ⌘D 分屏 · ⌘W 关闭面板</span>
                    <span>点击文件树中的文件即可预览代码 / 图片</span>
                    <span>每个面板左上角的下拉框可切换：终端 / 代码预览 / 图片预览</span>
                  </div>
                </div>
              </div>
            )}
            {viewMode === 'canvas' && <CanvasStage />}
            <PaneLayer />
            {viewMode === 'canvas' && <CanvasDrawer />}
            {viewMode === 'canvas' && <CanvasWikiDrawer />}
            {viewMode === 'canvas' && <CanvasDictBubble />}
          </div>
        </main>
      </div>
      <ConfirmDialog />
      <AgentOnboarding />
      <Tooltip />
    </div>
  )
}
