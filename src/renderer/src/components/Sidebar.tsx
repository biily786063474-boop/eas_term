import { useStore } from '../store'
import { FileTree } from './FileTree'
import { PlusIcon, CloseIcon, TerminalIcon } from './Icons'

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
            <div className="tree-msg">
              还没有项目，点击 ＋ 选择或新建一个项目文件夹
            </div>
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
          <FileTree key={activeProject.id} rootPath={activeProject.path} />
        </div>
      )}
    </aside>
  )
}
