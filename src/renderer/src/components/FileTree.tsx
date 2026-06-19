import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirEntry } from '../../../shared/types'
import { useStore } from '../store'
import { collectLeaves } from '../layout'
import {
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  RefreshIcon,
  TerminalIcon,
  PencilIcon,
  TrashIcon,
  CopyIcon
} from './Icons'

interface MenuState {
  x: number
  y: number
  entry: DirEntry
}

const parentDir = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'

/** 通知某目录内容已变化，让对应的 DirChildren 重新加载（保留树展开状态） */
function emitDirChanged(dirPath: string): void {
  window.dispatchEvent(new CustomEvent('fs-dir-changed', { detail: dirPath }))
}

function shellQuote(p: string): string {
  return /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
}

/** 把路径写入当前活动终端（无回车，方便继续拼命令） */
function insertPathToTerminal(p: string): boolean {
  const s = useStore.getState()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  if (!tab) return false
  const leaves = collectLeaves(tab.root)
  const active = leaves.find((l) => l.id === tab.activeLeafId)
  const target =
    active && active.pane.kind === 'terminal'
      ? active
      : leaves.find((l) => l.pane.kind === 'terminal')
  if (!target || target.pane.kind !== 'terminal') return false
  window.api.pty.write(target.pane.ptyId, shellQuote(p) + ' ')
  return true
}

export function FileTree({ rootPath }: { rootPath: string }): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const openTerminal = useStore((s) => s.openTerminal)
  const openFile = useStore((s) => s.openFile)
  const activeProjectId = useStore((s) => s.activeProjectId)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const onContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const menuAction = (fn: () => void) => (): void => {
    setMenu(null)
    fn()
  }

  const relativePath = (p: string): string =>
    p.startsWith(rootPath + '/') ? p.slice(rootPath.length + 1) : p

  return (
    <div className="filetree">
      <div className="filetree-header">
        <span>资源管理器</span>
        <button className="icon-btn" title="刷新" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshIcon size={13} />
        </button>
      </div>
      <div className="filetree-body">
        <DirChildren
          key={refreshKey}
          dirPath={rootPath}
          depth={0}
          onContextMenu={onContextMenu}
          renamingPath={renamingPath}
          onRenameDone={() => setRenamingPath(null)}
        />
      </div>
      {menu &&
        createPortal(
          <div
            className="context-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {!menu.entry.isDir && (
              <>
                <button onClick={menuAction(() => void openFile(menu.entry.path))}>
                  <FileIcon size={13} />
                  在面板中预览
                </button>
                <button
                  onClick={menuAction(() => void window.api.fs.openPath(menu.entry.path))}
                >
                  <FolderOpenIcon size={13} />
                  用默认应用打开
                </button>
              </>
            )}
            {menu.entry.isDir && (
              <button
                onClick={menuAction(() =>
                  void openTerminal({ projectId: activeProjectId, cwd: menu.entry.path })
                )}
              >
                <TerminalIcon size={13} />
                在此文件夹打开终端
              </button>
            )}
            <button
              onClick={menuAction(() => void window.api.fs.showInFolder(menu.entry.path))}
            >
              <FolderIcon size={13} />
              在访达中显示
            </button>
            <div className="menu-sep" />
            <button onClick={menuAction(() => setRenamingPath(menu.entry.path))}>
              <PencilIcon size={13} />
              重命名
            </button>
            <button
              onClick={menuAction(() => {
                void window.api.fs.trash(menu.entry.path).then((r) => {
                  if (r.ok) emitDirChanged(parentDir(menu.entry.path))
                })
              })}
            >
              <TrashIcon size={13} />
              删除（移到废纸篓）
            </button>
            <div className="menu-sep" />
            <button onClick={menuAction(() => insertPathToTerminal(menu.entry.path))}>
              <TerminalIcon size={13} />
              插入路径到终端
            </button>
            <button
              onClick={menuAction(() => void window.api.clipboard.writeText(menu.entry.path))}
            >
              <CopyIcon size={13} />
              复制路径
            </button>
            <button
              onClick={menuAction(() =>
                void window.api.clipboard.writeText(relativePath(menu.entry.path))
              )}
            >
              <CopyIcon size={13} />
              复制相对路径
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}

interface DirChildrenProps {
  dirPath: string
  depth: number
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void
  renamingPath: string | null
  onRenameDone: () => void
}

function RenameInput({
  entry,
  onDone
}: {
  entry: DirEntry
  onDone: () => void
}): JSX.Element {
  const [value, setValue] = useState(entry.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    // 选中文件名主体（不含扩展名），与 IDE 行为一致
    const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
  }, [entry])

  const submit = async (): Promise<void> => {
    const newName = value.trim()
    if (newName && newName !== entry.name) {
      const result = await window.api.fs.rename(entry.path, newName)
      if (result.ok) emitDirChanged(parentDir(entry.path))
    }
    onDone()
  }

  return (
    <input
      ref={inputRef}
      className="tree-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void submit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit()
        if (e.key === 'Escape') onDone()
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function DirChildren({
  dirPath,
  depth,
  onContextMenu,
  renamingPath,
  onRenameDone
}: DirChildrenProps): JSX.Element {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const openFile = useStore((s) => s.openFile)

  const load = useCallback(() => {
    window.api.fs
      .readDir(dirPath)
      .then(setEntries)
      .catch((err) => setError(String(err?.message ?? err)))
  }, [dirPath])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onChanged = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === dirPath) load()
    }
    window.addEventListener('fs-dir-changed', onChanged)
    return () => window.removeEventListener('fs-dir-changed', onChanged)
  }, [dirPath, load])

  if (error) return <div className="tree-msg">无法读取目录</div>
  if (entries === null) return <div className="tree-msg">加载中…</div>
  if (entries.length === 0) return <div className="tree-msg">（空）</div>

  return (
    <>
      {entries.map((entry) =>
        entry.isDir ? (
          <DirNode
            key={entry.path}
            entry={entry}
            depth={depth}
            onContextMenu={onContextMenu}
            renamingPath={renamingPath}
            onRenameDone={onRenameDone}
          />
        ) : (
          <div
            key={entry.path}
            className={`tree-item${entry.isHidden ? ' hidden-file' : ''}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            title={entry.path}
            onContextMenu={(e) => onContextMenu(e, entry)}
            onClick={() => void openFile(entry.path)}
            onDoubleClick={() => void window.api.fs.openPath(entry.path)}
          >
            <span className="tree-arrow" />
            <span className="tree-icon">
              <FileIcon size={13} />
            </span>
            {renamingPath === entry.path ? (
              <RenameInput entry={entry} onDone={onRenameDone} />
            ) : (
              <span className="tree-name">{entry.name}</span>
            )}
          </div>
        )
      )}
    </>
  )
}

function DirNode({
  entry,
  depth,
  onContextMenu,
  renamingPath,
  onRenameDone
}: { entry: DirEntry } & Omit<DirChildrenProps, 'dirPath'>): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <div
        className={`tree-item dir${entry.isHidden ? ' hidden-file' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        title={entry.path}
        onClick={() => setExpanded((v) => !v)}
        onContextMenu={(e) => onContextMenu(e, entry)}
      >
        <span className={`tree-arrow${expanded ? ' open' : ''}`}>
          <ChevronRightIcon size={11} />
        </span>
        <span className="tree-icon folder">
          {expanded ? <FolderOpenIcon size={13} /> : <FolderIcon size={13} />}
        </span>
        {renamingPath === entry.path ? (
          <RenameInput entry={entry} onDone={onRenameDone} />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
      </div>
      {expanded && (
        <DirChildren
          dirPath={entry.path}
          depth={depth + 1}
          onContextMenu={onContextMenu}
          renamingPath={renamingPath}
          onRenameDone={onRenameDone}
        />
      )}
    </>
  )
}
