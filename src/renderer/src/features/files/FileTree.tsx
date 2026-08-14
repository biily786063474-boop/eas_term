// 文件树。两种模式：
//  · 只读（默认）—— 画布的资源抽屉 / 知识库抽屉 / WikiView 用。它们在**外层 div** 上用
//    mousedown 委托做「拖文件到画布」，行内不能再抢 mousedown/双击，否则两种手势打架。
//  · editable —— 项目侧栏用。完整 IDE 式操作：新建、双击重命名、F2、Delete、
//    上下键导航、⌘C/⌘X/⌘V、树内拖拽移动。
//
// 展开态和选中态都提到本组件顶层（不是每个 DirNode 各存一份 useState）。
// 原因：新建一个深层文件后要能「自动展开到它并选中」，那就必须从外面控得住展开态；
// 顺带也解决了「bump refreshKey 重建整棵树 → 用户展开的目录全折叠回去」。
//
// 刷新走 fs-dir-changed 自定义事件（精确匹配目录路径，只重读那一个目录），
// 不要图省事去 bump refreshKey —— 那是整棵树卸载重建。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry } from '../../../../shared/types'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { CanvasContextMenu, type CanvasMenuItem } from '../canvas/CanvasContextMenu'
import { shellQuote } from '../canvas/shellQuote'
import './files.css'
import { FileIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon } from '../../ui/Icons'

const parentDir = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'

/** 通知某目录内容已变化，让对应的 DirChildren 重新加载（保留树展开状态） */
function emitDirChanged(dirPath: string): void {
  window.dispatchEvent(new CustomEvent('fs-dir-changed', { detail: dirPath }))
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

/** 新建中的占位行：目录里还没有这个 entry，所以没有真实 DirEntry 可挂输入框 */
interface Creating {
  dir: string
  kind: 'file' | 'dir'
}

/** 文件剪贴板（复制/剪切的待粘贴项）。只有 editable 的那棵树会用到 */
interface FileClip {
  path: string
  cut: boolean
}

export function FileTree({
  rootPath,
  refreshKey,
  editable = false,
  createRequest,
  viewOnly = false
}: {
  rootPath: string
  refreshKey: number
  /** 开启 IDE 式文件操作（新建/双击重命名/键盘/拖拽移动）。
   *  默认关：画布抽屉那几处的外层已经占了 mousedown 和双击做别的手势。 */
  editable?: boolean
  /** 外部（面板头部的 + 按钮）触发在根目录新建。nonce 变一次触发一次；
   *  用计数器而不是 ref，是因为 refreshKey 已经是这个模式了，不引入第二种机制 */
  createRequest?: { kind: 'file' | 'dir'; nonce: number }
  /** 连右键菜单里恒在的「重命名」「删除」也去掉（那两项不受 editable 控制，平时
   *  哪怕 editable=false 也会出现，只是点了会失败——因为 fs:rename/fs:trash 走
   *  main/fsGuard.ts 的 guardPath，只认项目根和知识库根）。给指向那两类根目录
   *  之外的只读场景用（比如 skill 面板的文件树指向 `~/.claude/skills` 之类的位置），
   *  这里加纯粹是不让用户看到一个点了必错的菜单项，guardPath 本身仍然是真正拦写的那道闸。 */
  viewOnly?: boolean
}): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry | null } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [clip, setClip] = useState<FileClip | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const openTerminal = useStore((s) => s.openTerminal)
  const openFile = useStore((s) => s.openFile)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const requestConfirm = useStore((s) => s.requestConfirm)

  // 操作失败必须说出来。原来 rename 失败是静默丢弃的——用户改了个重名，
  // 名字弹回去、没有任何解释，只会以为软件坏了。
  const fail = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600)
  }, [])

  const toggleExpand = useCallback((p: string, force?: boolean) => {
    setExpanded((prev) => {
      const want = force ?? !prev.has(p)
      if (want === prev.has(p)) return prev
      const next = new Set(prev)
      if (want) next.add(p)
      else next.delete(p)
      return next
    })
  }, [])

  // refreshKey 变了（侧栏的「刷新文件树」按钮）→ 清掉选中/新建态，但**保留展开态**
  useEffect(() => {
    setRenamingPath(null)
    setCreating(null)
  }, [refreshKey])

  const startCreate = useCallback(
    (kind: 'file' | 'dir', anchor: DirEntry | null) => {
      // 在目录上新建 → 建在它里面（并展开它）；在文件上新建 → 建在它的同级
      const dir = anchor ? (anchor.isDir ? anchor.path : parentDir(anchor.path)) : rootPath
      if (anchor?.isDir) toggleExpand(anchor.path, true)
      setCreating({ dir, kind })
    },
    [rootPath, toggleExpand]
  )

  // 外部触发：nonce 变了就在根目录起一次新建。
  // 依赖里不放 createRequest 整个对象——它每次渲染都是新对象，会无限触发
  const createNonce = createRequest?.nonce ?? 0
  const createKind = createRequest?.kind ?? 'file'
  useEffect(() => {
    if (!createNonce) return
    startCreate(createKind, null)
  }, [createNonce, createKind, startCreate])

  const doTrash = useCallback(
    (entry: DirEntry) => {
      requestConfirm({
        message: `把${entry.isDir ? '文件夹' : '文件'}「${entry.name}」移到废纸篓？`,
        confirmLabel: '移到废纸篓',
        onConfirm: () => {
          void window.api.fs.trash(entry.path).then((r) => {
            if (r.ok) {
              emitDirChanged(parentDir(entry.path))
              setSelected((s) => (s === entry.path ? null : s))
            } else fail(r.error ?? '删除失败')
          })
        }
      })
    },
    [requestConfirm, fail]
  )

  const doPaste = useCallback(
    (destDir: string) => {
      if (!clip) return
      const op = clip.cut ? window.api.fs.move : window.api.fs.copy
      void op(clip.path, destDir).then((r) => {
        if (!r.ok) return fail(r.error ?? '粘贴失败')
        emitDirChanged(destDir)
        if (clip.cut) {
          emitDirChanged(parentDir(clip.path))
          setClip(null) // 剪切是一次性的，粘完就清掉
        }
        toggleExpand(destDir, true)
        if (r.path) setSelected(r.path)
      })
    },
    [clip, fail, toggleExpand]
  )

  const relativePath = useCallback(
    (p: string): string => (p.startsWith(rootPath + '/') ? p.slice(rootPath.length + 1) : p),
    [rootPath]
  )

  // 右键菜单项。数据驱动（原来是硬编码 JSX）——新建/剪贴板这些条目数不定，
  // 而且换到 CanvasContextMenu 白拿 Esc/blur/resize 关闭（原来只监听 mousedown）。
  const menuItems = useMemo((): CanvasMenuItem[] => {
    if (!menu) return []
    const entry = menu.entry
    const items: CanvasMenuItem[] = []
    const targetDir = entry ? (entry.isDir ? entry.path : parentDir(entry.path)) : rootPath

    if (editable) {
      items.push({ label: '新建文件', onClick: () => startCreate('file', entry) })
      items.push({ label: '新建文件夹', onClick: () => startCreate('dir', entry) })
      items.push({ label: '', sep: true, onClick: () => {} })
    }

    if (entry && !entry.isDir) {
      items.push({ label: '在面板中预览', onClick: () => void openFile(entry.path) })
      // 双击已经让位给重命名了，这里是「用默认应用打开」唯一的入口
      items.push({
        label: '用默认应用打开',
        onClick: () => void window.api.fs.openPath(entry.path)
      })
    }
    if (entry?.isDir) {
      items.push({
        label: '在此文件夹打开终端',
        onClick: () => void openTerminal({ projectId: activeProjectId, cwd: entry.path })
      })
    }
    items.push({
      label: '在访达中显示',
      onClick: () => void window.api.fs.showInFolder(entry?.path ?? rootPath)
    })

    if (entry && !viewOnly) {
      items.push({ label: '', sep: true, onClick: () => {} })
      items.push({
        label: '重命名',
        kbd: editable ? 'F2' : undefined,
        onClick: () => setRenamingPath(entry.path)
      })
      if (editable) {
        items.push({ label: '复制', kbd: '⌘C', onClick: () => setClip({ path: entry.path, cut: false }) })
        items.push({ label: '剪切', kbd: '⌘X', onClick: () => setClip({ path: entry.path, cut: true }) })
      }
      items.push({
        label: '删除（移到废纸篓）',
        kbd: editable ? 'Delete' : undefined,
        danger: true,
        onClick: () => doTrash(entry)
      })
    }

    if (editable && clip) {
      items.push({ label: '', sep: true, onClick: () => {} })
      items.push({
        label: `粘贴「${clip.path.split('/').pop()}」`,
        kbd: '⌘V',
        hint: clip.cut ? '移动到这里' : '复制到这里',
        onClick: () => doPaste(targetDir)
      })
    }

    items.push({ label: '', sep: true, onClick: () => {} })
    items.push({
      label: '插入路径到终端',
      onClick: () => insertPathToTerminal(entry?.path ?? rootPath)
    })
    items.push({
      label: '复制路径',
      onClick: () => void window.api.clipboard.writeText(entry?.path ?? rootPath)
    })
    if (entry) {
      items.push({
        label: '复制相对路径',
        onClick: () => void window.api.clipboard.writeText(relativePath(entry.path))
      })
    }
    return items
  }, [
    menu,
    editable,
    viewOnly,
    clip,
    rootPath,
    activeProjectId,
    openFile,
    openTerminal,
    startCreate,
    doTrash,
    doPaste,
    relativePath
  ])

  const onContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (entry) setSelected(entry.path)
    setMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  // 键盘导航直接查 DOM 取「当前可见的行」——它们本来就按显示顺序排列，
  // 比在 React 里维护一份扁平化镜像可靠（展开/折叠/新建都会改变可见集合）。
  const visibleRows = useCallback((): HTMLElement[] => {
    const body = bodyRef.current
    if (!body) return []
    return [...body.querySelectorAll<HTMLElement>('.tree-item[data-path]')]
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!editable) return
      // 正在内联输入（重命名/新建）时全部交给输入框，别抢它的按键
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const rows = visibleRows()
      const idx = rows.findIndex((r) => r.dataset.path === selected)
      const cur = rows[idx]
      const isDir = cur?.dataset.dir === '1'
      const move = (delta: number): void => {
        const next = rows[Math.max(0, Math.min(rows.length - 1, (idx < 0 ? 0 : idx) + delta))]
        if (next?.dataset.path) {
          setSelected(next.dataset.path)
          next.scrollIntoView({ block: 'nearest' })
        }
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          move(idx < 0 ? 0 : 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          move(-1)
          break
        case 'ArrowRight':
          if (isDir && selected) {
            e.preventDefault()
            if (expanded.has(selected)) move(1)
            else toggleExpand(selected, true)
          }
          break
        case 'ArrowLeft':
          if (selected) {
            e.preventDefault()
            // 展开着的目录先收起；已经收起的（或文件）则跳到父目录那一行
            if (isDir && expanded.has(selected)) toggleExpand(selected, false)
            else {
              const parent = parentDir(selected)
              if (rows.some((r) => r.dataset.path === parent)) setSelected(parent)
            }
          }
          break
        case 'F2':
          if (selected) {
            e.preventDefault()
            setRenamingPath(selected)
          }
          break
        case 'Delete':
        case 'Backspace':
          // Backspace 也接：macOS 上删除键就是 Backspace，Delete 是 fn+Backspace
          if (selected && cur) {
            e.preventDefault()
            doTrash({
              name: cur.dataset.name ?? selected.split('/').pop() ?? '',
              path: selected,
              isDir,
              isHidden: false
            })
          }
          break
        case 'Enter':
          if (selected && cur) {
            e.preventDefault()
            if (isDir) toggleExpand(selected)
            else void openFile(selected)
          }
          break
        default:
          if (e.metaKey || e.ctrlKey) {
            const k = e.key.toLowerCase()
            if (k === 'c' && selected) {
              e.preventDefault()
              setClip({ path: selected, cut: false })
            } else if (k === 'x' && selected) {
              e.preventDefault()
              setClip({ path: selected, cut: true })
            } else if (k === 'v' && clip) {
              e.preventDefault()
              doPaste(selected ? (isDir ? selected : parentDir(selected)) : rootPath)
            }
          }
      }
    },
    [editable, visibleRows, selected, expanded, clip, toggleExpand, doTrash, doPaste, openFile, rootPath]
  )

  const shared: SharedProps = {
    rootPath,
    onContextMenu,
    renamingPath,
    onStartRename: setRenamingPath,
    onRenameDone: () => setRenamingPath(null),
    onRenameFail: fail,
    creating,
    onCreateDone: () => setCreating(null),
    onCreated: (p: string) => {
      setCreating(null)
      setSelected(p)
    },
    selected,
    onSelect: setSelected,
    expanded,
    onToggleExpand: toggleExpand,
    editable,
    cutPath: clip?.cut ? clip.path : null,
    onMoveFail: fail
  }

  return (
    <>
      <div
        ref={bodyRef}
        className="filetree-body"
        tabIndex={editable ? 0 : undefined}
        onKeyDown={onKeyDown}
        // 点树里任何地方都把焦点收到容器上——否则 tabIndex 形同虚设，
        // 键盘导航永远收不到按键（点 div 本身不会让可聚焦的父容器获得焦点）。
        // 内联输入框要排除掉，不然会把它刚拿到的焦点抢走。
        onMouseDown={
          editable
            ? (e) => {
                if ((e.target as HTMLElement).tagName === 'INPUT') return
                bodyRef.current?.focus({ preventScroll: true })
              }
            : undefined
        }
        // 空白处右键 → 根目录的菜单（原来空白区右键没有任何菜单）
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest('.tree-item')) onContextMenu(e, null)
        }}
      >
        <DirChildren key={refreshKey} dirPath={rootPath} depth={0} {...shared} />
      </div>
      {toast && <div className="tree-toast">{toast}</div>}
      {menu && (
        <CanvasContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

interface SharedProps {
  /** 树根，拖拽落在空白处时归到这里 */
  rootPath: string
  onContextMenu: (e: React.MouseEvent, entry: DirEntry | null) => void
  renamingPath: string | null
  onStartRename: (path: string) => void
  onRenameDone: () => void
  onRenameFail: (msg: string) => void
  creating: Creating | null
  onCreateDone: () => void
  onCreated: (path: string) => void
  selected: string | null
  onSelect: (path: string) => void
  expanded: Set<string>
  onToggleExpand: (path: string, force?: boolean) => void
  editable: boolean
  cutPath: string | null
  onMoveFail: (msg: string) => void
}

interface DirChildrenProps extends SharedProps {
  dirPath: string
  depth: number
}

/** 树内拖拽移动（只在 editable 时挂）。侧栏没有外层 mousedown 委托，
 *  可以直接在行上做；画布那两个抽屉的外层已经用 mousedown 做「拖到画布」了，所以那里不开。 */
function startMoveDrag(entry: DirEntry, rootPath: string, e: React.MouseEvent, onFail: (m: string) => void): void {
  if (e.button !== 0) return
  const start = { x: e.clientX, y: e.clientY, started: false }
  let ghost: HTMLDivElement | null = null
  const clearHl = (): void =>
    document.querySelectorAll('.tree-item.drop-into').forEach((el) => el.classList.remove('drop-into'))
  const dirUnder = (ev: MouseEvent): { el: HTMLElement | null; dir: string } => {
    if (ghost) ghost.style.display = 'none'
    const under = document.elementFromPoint(ev.clientX, ev.clientY)
    if (ghost) ghost.style.display = ''
    const body = under?.closest('.filetree-body')
    if (!body) return { el: null, dir: '' }
    const row = under?.closest('.tree-item[data-dir="1"]') as HTMLElement | null
    // 落在文件行或空白 → 归到它所在的目录 / 树根
    if (row?.dataset.path) return { el: row, dir: row.dataset.path }
    const fileRow = under?.closest('.tree-item[data-path]') as HTMLElement | null
    if (fileRow?.dataset.path) return { el: null, dir: parentDir(fileRow.dataset.path) }
    return { el: null, dir: rootPath }
  }
  const onMove = (ev: MouseEvent): void => {
    if (!start.started) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
      start.started = true
      ghost = document.createElement('div')
      ghost.className = 'canvas-drag-ghost'
      ghost.textContent = entry.name
      document.body.appendChild(ghost)
    }
    if (ghost) {
      ghost.style.left = ev.clientX + 12 + 'px'
      ghost.style.top = ev.clientY + 10 + 'px'
    }
    clearHl()
    const { el } = dirUnder(ev)
    if (el && el.dataset.path !== entry.path) el.classList.add('drop-into')
  }
  const onUp = (ev: MouseEvent): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    const wasDrag = start.started
    ghost?.remove()
    clearHl()
    if (!wasDrag) return
    const { dir } = dirUnder(ev)
    if (!dir || dir === parentDir(entry.path)) return // 放回原处，什么都不做
    void window.api.fs.move(entry.path, dir).then((r) => {
      if (!r.ok) return onFail(r.error ?? '移动失败')
      emitDirChanged(parentDir(entry.path))
      emitDirChanged(dir)
    })
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function RenameInput({
  entry,
  onDone,
  onFail
}: {
  entry: DirEntry
  onDone: () => void
  onFail: (msg: string) => void
}): JSX.Element {
  const [value, setValue] = useState(entry.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    // 选中文件名主体（不含扩展名），与 IDE 行为一致
    const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
  }, [entry])

  const submit = async (): Promise<void> => {
    if (done.current) return
    done.current = true
    const newName = value.trim()
    if (newName && newName !== entry.name) {
      const result = await window.api.fs.rename(entry.path, newName)
      if (result.ok) emitDirChanged(parentDir(entry.path))
      else onFail(result.error ?? '重命名失败')
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
        e.stopPropagation() // 别让按键冒到文件树的键盘导航上（否则打字会跳选中项）
        if (e.key === 'Enter') void submit()
        if (e.key === 'Escape') {
          done.current = true
          onDone()
        }
      }}
      onClick={(e) => e.stopPropagation()}
      // 必须挡 mousedown：画布的两个抽屉在外层用 mousedown 委托做「拖到画布」，
      // 它靠 closest('.tree-item') 命中父行，然后 preventDefault() —— 那会让这个输入框
      // 既定位不了光标也划不了选（在知识库抽屉里划选还会变成拖笔记出去）
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

/** 新建时的占位行：磁盘上还没有这个东西，所以拿不到 DirEntry，单独渲染一行 */
function CreateInput({
  dir,
  kind,
  depth,
  onCancel,
  onCreated,
  onFail
}: {
  dir: string
  kind: 'file' | 'dir'
  depth: number
  onCancel: () => void
  onCreated: (path: string) => void
  onFail: (msg: string) => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    if (done.current) return
    const name = value.trim()
    if (!name) {
      done.current = true
      onCancel()
      return
    }
    done.current = true
    const r = kind === 'dir' ? await window.api.fs.mkdir(dir, name) : await window.api.fs.createFile(dir, name)
    if (!r.ok) {
      onFail(r.error ?? '新建失败')
      onCancel()
      return
    }
    emitDirChanged(dir)
    onCreated(r.path ?? `${dir}/${name}`)
  }

  return (
    <div className="tree-item creating" style={{ paddingLeft: 10 + depth * 14 }}>
      <span className="tree-arrow" />
      <span className={`tree-icon${kind === 'dir' ? ' folder' : ''}`}>
        {kind === 'dir' ? <FolderIcon size={13} /> : <FileIcon size={13} />}
      </span>
      <input
        ref={inputRef}
        className="tree-rename-input"
        placeholder={kind === 'dir' ? '文件夹名' : '文件名'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            done.current = true
            onCancel()
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function DirChildren({ dirPath, depth, ...s }: DirChildrenProps): JSX.Element {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const openFile = useStore((st) => st.openFile)

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

  // 新建行属于本目录时插在最前面（一眼能看到，不用在长列表里找）
  const createRow =
    s.creating?.dir === dirPath ? (
      <CreateInput
        key="__creating"
        dir={dirPath}
        kind={s.creating.kind}
        depth={depth}
        onCancel={s.onCreateDone}
        onCreated={s.onCreated}
        onFail={s.onRenameFail}
      />
    ) : null

  if (error) return <div className="tree-msg">无法读取目录</div>
  if (entries === null) return <>{createRow ?? <div className="tree-msg">加载中…</div>}</>
  if (entries.length === 0)
    return <>{createRow ?? <div className="tree-msg">（空）</div>}</>

  return (
    <>
      {createRow}
      {entries.map((entry) =>
        entry.isDir ? (
          <DirNode key={entry.path} entry={entry} depth={depth} {...s} />
        ) : (
          <div
            key={entry.path}
            className={`tree-item${entry.isHidden ? ' hidden-file' : ''}${
              s.selected === entry.path ? ' selected' : ''
            }${s.cutPath === entry.path ? ' cut' : ''}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            data-tip={entry.path}
            data-path={entry.path}
            data-name={entry.name}
            onContextMenu={(e) => s.onContextMenu(e, entry)}
            onMouseDown={
              s.editable
                ? (e) => {
                    if ((e.target as HTMLElement).tagName === 'INPUT') return
                    startMoveDrag(entry, s.rootPath, e, s.onMoveFail)
                  }
                : undefined
            }
            onClick={() => {
              s.onSelect(entry.path)
              void openFile(entry.path)
            }}
            // editable：双击 = 重命名（「用默认应用打开」移到右键菜单里了）
            // 只读模式：保持原来的双击 = 用默认应用打开
            onDoubleClick={
              s.editable
                ? () => {
                    s.onSelect(entry.path)
                    s.onStartRename(entry.path)
                  }
                : () => void window.api.fs.openPath(entry.path)
            }
          >
            <span className="tree-arrow" />
            <span className="tree-icon">
              <FileIcon size={13} />
            </span>
            {s.renamingPath === entry.path ? (
              <RenameInput entry={entry} onDone={s.onRenameDone} onFail={s.onRenameFail} />
            ) : (
              <span className="tree-name">{entry.name}</span>
            )}
          </div>
        )
      )}
    </>
  )
}

function DirNode({ entry, depth, ...s }: { entry: DirEntry; depth: number } & SharedProps): JSX.Element {
  const expanded = s.expanded.has(entry.path)

  return (
    <>
      <div
        className={`tree-item dir${entry.isHidden ? ' hidden-file' : ''}${
          s.selected === entry.path ? ' selected' : ''
        }${s.cutPath === entry.path ? ' cut' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        data-tip={entry.path}
        data-path={entry.path}
        data-name={entry.name}
        data-dir="1"
        onContextMenu={(e) => s.onContextMenu(e, entry)}
        onMouseDown={
          s.editable
            ? (e) => {
                if ((e.target as HTMLElement).tagName === 'INPUT') return
                startMoveDrag(entry, s.rootPath, e, s.onMoveFail)
              }
            : undefined
        }
        onClick={() => {
          s.onSelect(entry.path)
          s.onToggleExpand(entry.path)
        }}
        // 双击目录 = 重命名。onClick 会先跑两次（= toggle 两遍，净效果不变），
        // 但展开状态会闪一下，所以双击后强制回到双击前的状态
        onDoubleClick={
          s.editable
            ? () => {
                s.onToggleExpand(entry.path, expanded)
                s.onSelect(entry.path)
                s.onStartRename(entry.path)
              }
            : undefined
        }
      >
        <span className={`tree-arrow${expanded ? ' open' : ''}`}>
          <ChevronRightIcon size={11} />
        </span>
        <span className="tree-icon folder">
          {expanded ? <FolderOpenIcon size={13} /> : <FolderIcon size={13} />}
        </span>
        {s.renamingPath === entry.path ? (
          <RenameInput entry={entry} onDone={s.onRenameDone} onFail={s.onRenameFail} />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
      </div>
      {/* 新建行落在这个折叠着的目录里时也要把它撑开，不然输入框看不见 */}
      {(expanded || s.creating?.dir === entry.path) && (
        <DirChildren dirPath={entry.path} depth={depth + 1} {...s} />
      )}
    </>
  )
}
