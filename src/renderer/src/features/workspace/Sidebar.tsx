import { useState } from 'react'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { Project } from '../../../../shared/types'
import { FileTree } from '../files/FileTree'
import { SidebarGit } from '../git/SidebarGit'
import { PlusIcon, CloseIcon, TerminalIcon, RefreshIcon, GitBranchIcon, FilesIcon, FilePlusIcon, FolderPlusIcon, ChevronLeftIcon, ChevronRightIcon } from '../../ui/Icons'
import { SwipeRow } from '../../ui/SwipeRow'
import { CanvasContextMenu } from '../canvas/CanvasContextMenu'
import { projectMenuItems } from './projectMenu'
import { useProjectRows } from '../status/useStatus.ts'
import './workspace.css'

// 资源管理器区：顶部标签在「文件」(文件树) 与「版本」(Git) 间切换。
function WorkspacePanel({ project }: { project: Project }): JSX.Element {
  const [tab, setTab] = useState<'files' | 'git'>('files')
  const [filesRefresh, setFilesRefresh] = useState(0)
  const [createReq, setCreateReq] = useState<{ kind: 'file' | 'dir'; nonce: number } | undefined>()

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
        {/* 两个图标而不是一个 + 加下拉：照 IDE 惯例，各自说清建的是什么，
            少一次「点开菜单再选」。和画布抽屉「文件」节头部的那两个是同一套 */}
        {tab === 'files' && (
          <>
            <button
              className="icon-btn"
              data-tip="新建文件"
              onClick={() => setCreateReq((p) => ({ kind: 'file', nonce: (p?.nonce ?? 0) + 1 }))}
            >
              <FilePlusIcon size={13} />
            </button>
            <button
              className="icon-btn"
              data-tip="新建文件夹"
              onClick={() => setCreateReq((p) => ({ kind: 'dir', nonce: (p?.nonce ?? 0) + 1 }))}
            >
              <FolderPlusIcon size={13} />
            </button>
          </>
        )}
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
          <FileTree
            key={project.id}
            rootPath={project.path}
            refreshKey={filesRefresh}
            editable
            createRequest={createReq}
          />
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
  // 走带确认的那条 —— 这个 × 就挨着「打开终端」，一次误点会杀掉这个项目下
  // 所有正在跑的终端，并且画布上的节点摆放找不回来（.plans/data-safety H0）
  const removeProject = useStore((s) => s.requestRemoveProject)
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
  const rows = useProjectRows()

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
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const setCollapsed = useStore((s) => s.setSidebarCollapsed)

  // 收起后**留一条窄边**，不彻底消失：没有入口的隐藏等于藏起来，
  // 下次想调出来只能靠记快捷键。窄边上放展开钮 + 当前项目首字，
  // 这样收着的时候也知道自己在哪个项目里。
  if (collapsed) {
    return (
      <aside
        className="sidebar collapsed"
        onClick={() => setCollapsed(false)}
        data-tip="展开项目与文件"
      >
        <button className="sidebar-rail-btn" aria-label="展开项目与文件">
          <ChevronRightIcon size={13} />
        </button>
        {activeProject && (
          <div className="sidebar-rail-proj" title={activeProject.name}>
            {[...activeProject.name][0] ?? '·'}
          </div>
        )}
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-section projects-section">
        <div className="sidebar-header">
          <span>项目</span>
          <div className="sidebar-header-acts">
            <button className="icon-btn" data-tip="添加项目文件夹" onClick={() => void addProject()}>
              <PlusIcon size={13} />
            </button>
            <button
              className="icon-btn"
              data-tip="收起，把宽度让给终端"
              onClick={() => setCollapsed(true)}
            >
              <ChevronLeftIcon size={13} />
            </button>
          </div>
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
              // 只切项目，不清提醒。setActiveProject 原来会顺手把该项目**全部**终端的
              // 提醒清掉，而这一下只会把其中一个标签摆到眼前——别的标签里那个卡在
              // 权限确认框上的 CLI 就此没了任何指示。真正落地的那个终端由
              // TerminalView 的 focusin → clearAttention 逐个清（切标签会让它拿到
              // 输入焦点），够用且精确。详见 projectsSlice.ts 的说明。
              onClick={() => {
                // 记一次「用户主动切到了这个项目」，供画布双击菜单的「最近使用」排序用。
                // 不埋进 setActiveProject：它在 loadProjects 之后会被自动调一次（取 projects[0]）
                useStore.getState().touchProject(p.id)
                setActiveProject(p.id)
              }}
              // 双击 = 重命名（原来是「开新终端」，已移到右键菜单和行尾的终端图标按钮）
              onDoubleClick={() => setEditingProject({ id: p.id, mode: 'name' })}
              onContextMenu={(e) => {
                e.preventDefault()
                setProjMenu({ x: e.clientX, y: e.clientY, id: p.id })
              }}
            >
              {/* 有终端在等你才亮红点。判据是 attn 不是 `top !== 'running'`：
                  后者会把「agent 还在跑但响铃 / 调了 MCP notify」整类漏掉，
                  而那正是 notify 最常见的调用时机。见 machine.ts 的 ProjectRow */}
              {rows.some((r) => r.projectId === p.id && r.attn > 0) && (
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
                    useStore.getState().touchProject(p.id)
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
