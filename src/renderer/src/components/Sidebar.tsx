import { useState } from 'react'
import { useStore } from '../store'
import type { Project } from '../../../shared/types'
import { FileTree } from './FileTree'
import { SidebarGit } from './SidebarGit'
import { PlusIcon, CloseIcon, TerminalIcon, RefreshIcon, GitBranchIcon, FilesIcon } from './Icons'

// 资源管理器区：顶部标签在「文件」(文件树) 与「版本」(Git) 间切换。
function WorkspacePanel({ project }: { project: Project }): JSX.Element {
  const [tab, setTab] = useState<'files' | 'git'>('files')
  const [filesRefresh, setFilesRefresh] = useState(0)

  return (
    <div className="workspace">
      <div className="workspace-tabs">
        <button
          className={`ws-tab${tab === 'files' ? ' active' : ''}`}
          onClick={() => setTab('files')}
        >
          <FilesIcon size={13} />
          <span>文件</span>
        </button>
        <button
          className={`ws-tab${tab === 'git' ? ' active' : ''}`}
          onClick={() => setTab('git')}
        >
          <GitBranchIcon size={13} />
          <span>版本</span>
        </button>
        <span className="pane-spacer" />
        {tab === 'files' && (
          <button
            className="icon-btn"
            title="刷新文件树"
            onClick={() => setFilesRefresh((k) => k + 1)}
          >
            <RefreshIcon size={13} />
          </button>
        )}
      </div>
      <div className="workspace-body">
        {tab === 'files' ? (
          <FileTree key={project.id} rootPath={project.path} refreshKey={filesRefresh} />
        ) : (
          <SidebarGit key={project.id} cwd={project.path} />
        )}
      </div>
    </div>
  )
}

export function Sidebar(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const addProject = useStore((s) => s.addProject)
  const removeProject = useStore((s) => s.removeProject)
  const openTerminal = useStore((s) => s.openTerminal)

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  return (
    <aside className="sidebar">
      <div className="sidebar-section projects-section">
        <div className="sidebar-header">
          <span>项目</span>
          <button className="icon-btn" title="添加项目文件夹" onClick={() => void addProject()}>
            <PlusIcon size={13} />
          </button>
        </div>
        <div className="project-list">
          {projects.length === 0 && (
            <div className="tree-msg">还没有项目，点击 ＋ 选择或新建一个项目文件夹</div>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`project-item${p.id === activeProjectId ? ' active' : ''}`}
              title={p.path}
              onClick={() => setActiveProject(p.id)}
              onDoubleClick={() => void openTerminal({ projectId: p.id })}
            >
              <span className="project-name">{p.name}</span>
              <span className="project-actions">
                <button
                  className="icon-btn"
                  title="在此项目打开新终端"
                  onClick={(e) => {
                    e.stopPropagation()
                    void openTerminal({ projectId: p.id })
                  }}
                >
                  <TerminalIcon size={12} />
                </button>
                <button
                  className="icon-btn"
                  title="从列表移除（不删除文件）"
                  onClick={(e) => {
                    e.stopPropagation()
                    void removeProject(p.id)
                  }}
                >
                  <CloseIcon size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
      {activeProject && (
        <div className="sidebar-section tree-section">
          <WorkspacePanel project={activeProject} />
        </div>
      )}
    </aside>
  )
}
