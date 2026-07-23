import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './features/workspace/Sidebar'
import { TabBar } from './features/workspace/TabBar'
import { PaneLayer } from './features/workspace/PaneLayer'
import { CanvasStage } from './features/canvas/CanvasStage'
import { ThemeSelect } from './ui/ThemeSelect'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { FolderIcon, TerminalIcon, CanvasIcon } from './ui/Icons'

export function App(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const loadProjects = useStore((s) => s.loadProjects)
  const openTerminal = useStore((s) => s.openTerminal)
  const addProject = useStore((s) => s.addProject)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  // 全局快捷键：mac 用 ⌘、Windows/Linux 用 Ctrl。T 新终端、W 关面板、D 右分屏、⇧D 下分屏、1-9 切标签
  useEffect(() => {
    const isMac = window.api.platform === 'darwin'
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isMac ? !e.metaKey : !e.ctrlKey) return
      const s = useStore.getState()
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

  return (
    <div className="app">
      <div className="titlebar">
        {activeProject ? (
          <div className="titlebar-project" title={activeProject.path}>
            <FolderIcon size={14} className="titlebar-project-icon" />
            <span className="titlebar-project-name">{activeProject.name}</span>
            <span className="titlebar-project-path">{activeProject.path}</span>
          </div>
        ) : (
          <span className="titlebar-title">Eas-Term</span>
        )}
        <div className="titlebar-actions">
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
        <Sidebar />
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
          </div>
        </main>
      </div>
      <ConfirmDialog />
    </div>
  )
}
