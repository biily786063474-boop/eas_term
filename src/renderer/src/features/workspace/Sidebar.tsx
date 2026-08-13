import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { Project } from '../../../../shared/types'
import { FileTree } from '../files/FileTree'
import { SidebarGit } from '../git/SidebarGit'
import { PlusIcon, CloseIcon, TerminalIcon, RefreshIcon, GitBranchIcon, FilesIcon } from '../../ui/Icons'
import { SwipeRow } from '../../ui/SwipeRow'
import { CanvasContextMenu } from '../canvas/CanvasContextMenu'
import { projectMenuItems } from './projectMenu'
import './workspace.css'

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
            data-tip="刷新文件树"
            onClick={() => setFilesRefresh((k) => k + 1)}
          >
            <RefreshIcon size={13} />
          </button>
        )}
      </div>
      <div className="workspace-body">
        {/* 两个面板常挂载、display 切换：卸载会丢文件树的滚动位置和选中态 */}
        <div className="ws-keep" style={{ display: tab === 'files' ? undefined : 'none' }}>
          {/* editable：项目文件树是唯一开 IDE 式文件操作的地方。
              画布的资源/知识库抽屉不开——那两处的外层已经用 mousedown 做「拖到画布」了 */}
          <FileTree key={project.id} rootPath={project.path} refreshKey={filesRefresh} editable />
        </div>
        <div className="ws-keep" style={{ display: tab === 'git' ? undefined : 'none' }}>
          <SidebarGit key={project.id} cwd={project.path} active={tab === 'git'} />
        </div>
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
  const renameProject = useStore((s) => s.renameProject)
  /** 项目行右键菜单的落点 */
  const [projMenu, setProjMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** 正在内联改名的项目（双击/菜单进入）。mode 区分改的是显示名还是文件夹 */
  const [editingProject, setEditingProject] = useState<{
    id: string
    mode: 'name' | 'folder'
  } | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameProjectFolder = useStore((s) => s.renameProjectFolder)
  const attentionPtys = useStore((s) => s.attentionPtys)
  const tabs = useStore((s) => s.tabs)

  // 真改文件夹：有终端在跑就先把后果说清楚，让人决定
  const startFolderRename = (projectId: string, newName: string): void => {
    const s = useStore.getState()
    const running = s.tabs
      .filter((t) => t.projectId === projectId)
      .flatMap((t) => collectLeaves(t.root))
      .filter((l) => l.pane.kind === 'terminal').length
    const go = async (): Promise<void> => {
      const err = await renameProjectFolder(projectId, newName)
      setRenameError(err)
    }
    if (running > 0) {
      s.requestConfirm({
        message:
          `把文件夹改名成「${newName}」？\n\n` +
          `这个项目下有 ${running} 个终端开着。改名不会杀掉它们（系统认的是目录本身、不是名字），` +
          `但里面的 agent 记着的路径会对不上，它下次读写那些路径可能会失败。\n\n` +
          `画板上已经打开的该项目文件节点会显示「文件不存在」，重新打开即可。`,
        confirmLabel: '改名',
        onConfirm: () => void go()
      })
    } else {
      void go()
    }
  }

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  // 有「任务完成」提醒的项目 id（终端完成任务后 flagAttention；切到该项目即清除）
  const attnProjectIds = useMemo(() => {
    if (!attentionPtys.length) return new Set<string>()
    const attn = new Set(attentionPtys)
    const ids = new Set<string>()
    for (const t of tabs) {
      if (!t.projectId) continue
      if (
        collectLeaves(t.root).some(
          (l) => l.pane.kind === 'terminal' && attn.has((l.pane as { ptyId: string }).ptyId)
        )
      )
        ids.add(t.projectId)
    }
    return ids
  }, [attentionPtys, tabs])

  return (
    <aside className="sidebar">
      <div className="sidebar-section projects-section">
        <div className="sidebar-header">
          <span>项目</span>
          <button className="icon-btn" data-tip="添加项目文件夹" onClick={() => void addProject()}>
            <PlusIcon size={13} />
          </button>
        </div>
        {renameError && (
          <div className="ws-inline-error" onClick={() => setRenameError(null)}>
            {renameError}
          </div>
        )}
        <div className="project-list">
          {projects.length === 0 && (
            <div className="tree-msg">还没有项目，点击 ＋ 选择或新建一个项目文件夹</div>
          )}
          {projects.map((p) => (
            // 这里左键没被别的手势占，鼠标拖和触控板横滑都能用
            <SwipeRow
              key={p.id}
              pointer
              onRemove={() => void removeProject(p.id)}
              className={`project-item${p.id === activeProjectId ? ' active' : ''}`}
              data-tip={p.path}
              onClick={() => setActiveProject(p.id)}
              // 双击 = 重命名（原来是「开新终端」，已移到右键菜单和行尾的终端图标按钮）
              onDoubleClick={() => setEditingProject({ id: p.id, mode: 'name' })}
              onContextMenu={(e) => {
                e.preventDefault()
                setProjMenu({ x: e.clientX, y: e.clientY, id: p.id })
              }}
            >
              {attnProjectIds.has(p.id) && (
                <span className="project-attn-dot" data-tip="该项目有任务完成" />
              )}
              {editingProject?.id === p.id ? (
                <input
                  className="project-rename"
                  // 改显示名时预填显示名；改文件夹时预填**目录名**（那才是要改的东西）
                  defaultValue={
                    editingProject.mode === 'folder' ? (p.path.split('/').pop() ?? '') : p.name
                  }
                  autoFocus
                  // SwipeRow 用 pointer 事件做横滑删除，不挡住就会一边打字一边把行滑走
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const mode = editingProject.mode
                    const val = e.target.value
                    setEditingProject(null)
                    if (mode === 'name') {
                      void renameProject(p.id, val)
                      return
                    }
                    const cur = p.path.split('/').pop() ?? ''
                    if (!val.trim() || val === cur) return
                    startFolderRename(p.id, val)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditingProject(null)
                  }}
                />
              ) : (
                <span className="project-name">{p.name}</span>
              )}
              <span className="project-actions">
                <button
                  className="icon-btn"
                  data-tip="在此项目打开新终端"
                  onClick={(e) => {
                    e.stopPropagation()
                    void openTerminal({ projectId: p.id })
                  }}
                >
                  <TerminalIcon size={12} />
                </button>
                <button
                  className="icon-btn"
                  data-tip="从列表移除（不删除文件）"
                  onClick={(e) => {
                    e.stopPropagation()
                    void removeProject(p.id)
                  }}
                >
                  <CloseIcon size={12} />
                </button>
              </span>
            </SwipeRow>
          ))}
        </div>
      </div>
      {activeProject && (
        <div className="sidebar-section tree-section">
          <WorkspacePanel project={activeProject} />
        </div>
      )}
      {projMenu && (
        <CanvasContextMenu
          x={projMenu.x}
          y={projMenu.y}
          items={projectMenuItems(projMenu.id, (id, mode) => setEditingProject({ id, mode }))}
          onClose={() => setProjMenu(null)}
        />
      )}
    </aside>
  )
}
