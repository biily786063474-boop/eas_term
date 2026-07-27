import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BizoneCheck, BizoneProject, BizoneMedia } from '../../../../shared/types'
import { useStore } from '../../store'
import './image.css'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  RefreshIcon,
  ImageIcon,
  PlayIcon,
  CheckIcon
} from '../../ui/Icons'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const mediaUrl = (id: string): string => `bizone-media://local/${id}`

/* ---------- 本地文件预览（原有功能） ---------- */

function FilePreview({ filePath }: { filePath: string }): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(0)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [actualSize, setActualSize] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    setError(null)
    setDims(null)
    setActualSize(false)
    window.api.fs.readImageFile(filePath).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.error ?? '加载失败')
        return
      }
      setDataUrl(result.dataUrl)
      setSize(result.size)
    })
    return () => {
      cancelled = true
    }
  }, [filePath])

  return (
    <>
      <div className={`image-stage${actualSize ? ' actual' : ''}`}>
        {error && <div className="pane-status">{error}</div>}
        {!error && !dataUrl && <div className="pane-status">加载中…</div>}
        {dataUrl && (
          <img
            src={dataUrl}
            data-tip={actualSize ? '点击切换为适应窗口' : '点击查看原始大小'}
            onClick={() => setActualSize((v) => !v)}
            onLoad={(e) =>
              setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
        )}
      </div>
      <div className="image-info">
        <span>{filePath.split('/').pop()}</span>
        {dims && (
          <span>
            {dims.w} × {dims.h} · {formatSize(size)} · {actualSize ? '原始大小' : '适应窗口'}
          </span>
        )}
      </div>
    </>
  )
}

/* ---------- 笔纵画板项目下拉选择 ---------- */

function ProjectSelect({
  projects,
  value,
  onChange
}: {
  projects: BizoneProject[]
  value: string
  onChange: (id: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (e.target instanceof Node && btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const current = projects.find((p) => p.id === value)

  return (
    <>
      <button
        ref={btnRef}
        className={`pane-kind-btn${open ? ' open' : ''}`}
        onClick={() => {
          const r = btnRef.current!.getBoundingClientRect()
          setPos({ x: r.left, y: r.bottom + 6 })
          setOpen((v) => !v)
        }}
      >
        <span className="project-select-name">{current?.name ?? '选择项目'}</span>
        <ChevronDownIcon size={11} className="pane-kind-chevron" />
      </button>
      {open &&
        createPortal(
          <div className="glass-menu glass-menu-scroll" style={{ left: pos.x, top: pos.y }}>
            {projects.map((p) => (
              <button
                key={p.id}
                className={`glass-menu-item${p.id === value ? ' selected' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setOpen(false)
                  onChange(p.id)
                }}
              >
                <span className="glass-menu-label">{p.name}</span>
                <span className="glass-menu-meta">{p.nodeCount}</span>
                {p.id === value && <CheckIcon size={12} className="glass-menu-check" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

/* ---------- 生图历史画廊 ---------- */

interface GalleryMenuState {
  x: number
  y: number
  item: BizoneMedia
}

// 经典翻页：每页固定 20 张，页内容静态挂载，杜绝滚动中动态加载导致的布局抖动/遮挡
const GALLERY_PAGE = 20

function BizoneHistory(): JSX.Element {
  const [check, setCheck] = useState<BizoneCheck | null>(null)
  const [projects, setProjects] = useState<BizoneProject[]>([])
  const [projectId, setProjectId] = useState('__all__')
  const [media, setMedia] = useState<BizoneMedia[] | null>(null)
  const [pageIdx, setPageIdx] = useState(0)
  const [viewer, setViewer] = useState<BizoneMedia | null>(null)
  const [menu, setMenu] = useState<GalleryMenuState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const galleryRef = useRef<HTMLDivElement>(null)
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(null), 3200)
  }, [])

  const reload = useCallback(async () => {
    const c = await window.api.bizone.check()
    setCheck(c)
    if (!c.installed) return
    const list = await window.api.bizone.listProjects()
    setProjects(list)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!check?.installed) return
    setMedia(null)
    setPageIdx(0)
    window.api.bizone.listMedia(projectId).then(setMedia)
  }, [check?.installed, projectId])

  const pageCount = media ? Math.max(1, Math.ceil(media.length / GALLERY_PAGE)) : 1
  const pageItems = media
    ? media.slice(pageIdx * GALLERY_PAGE, (pageIdx + 1) * GALLERY_PAGE)
    : []

  const gotoPage = useCallback(
    (idx: number) => {
      setPageIdx(Math.max(0, Math.min(idx, pageCount - 1)))
      galleryRef.current?.scrollTo({ top: 0 })
    },
    [pageCount]
  )

  // 右键菜单 / 放大预览的关闭逻辑
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  useEffect(() => {
    if (!viewer) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setViewer(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [viewer])

  const insertToVAssets = async (item: BizoneMedia): Promise<void> => {
    if (!activeProject) {
      showNotice('请先在左侧选择一个项目仓库')
      return
    }
    const result = await window.api.bizone.insertToVAssets(item.mediaId, activeProject.path)
    if (result.ok) {
      // 通知文件树刷新：根目录（让新建的 V-assets 文件夹显示）+ V-assets 自身（若已展开则更新内容）
      window.dispatchEvent(new CustomEvent('fs-dir-changed', { detail: activeProject.path }))
      window.dispatchEvent(
        new CustomEvent('fs-dir-changed', { detail: `${activeProject.path}/V-assets` })
      )
    }
    showNotice(
      result.ok ? `已插入 ${activeProject.name}/${result.relPath}` : `插入失败：${result.error}`
    )
  }

  if (check && !check.installed) {
    return (
      <div className="pane-placeholder bizone-install">
        <ImageIcon size={28} />
        <div>未检测到「笔纵画板」</div>
        <div className="pane-placeholder-hint">
          安装后即可在此浏览 AI 生成的图片 / 视频历史，并一键插入项目
        </div>
        <div className="bizone-install-actions">
          <button
            className="primary-btn"
            onClick={() => void window.api.shell.openExternal(check.downloadUrl)}
          >
            下载笔纵画板
          </button>
          <button
            className="ghost-btn"
            onClick={() => void window.api.shell.openExternal(check.website)}
          >
            访问官网 bzone.biily.top
          </button>
        </div>
        <button className="ghost-btn bizone-recheck" onClick={() => void reload()}>
          已安装？重新检测
        </button>
      </div>
    )
  }

  return (
    <div className="bizone-history">
      <div className="bizone-toolbar">
        <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} />
        <span className="bizone-count">{media ? `${media.length} 项` : '加载中…'}</span>
        <span className="pane-spacer" />
        <button
          className="icon-btn"
          data-tip="刷新"
          onClick={() => {
            void reload()
            window.api.bizone.listMedia(projectId).then(setMedia)
          }}
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      <div className="gallery" ref={galleryRef}>
        {media?.length === 0 && <div className="tree-msg">该项目暂无本地媒体</div>}
        {pageItems.map((item) => (
          <div
            key={item.mediaId}
            className="gallery-item"
            data-tip={item.prompt || item.title || formatDate(item.createdAt)}
            onClick={() => setViewer(item)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, item })
            }}
          >
            {item.kind === 'image' ? (
              <img src={mediaUrl(item.mediaId)} loading="lazy" decoding="async" draggable={false} />
            ) : (
              <video src={mediaUrl(item.mediaId)} muted preload="metadata" />
            )}
            {item.kind === 'video' && (
              <span className="gallery-badge">
                <PlayIcon size={11} />
              </span>
            )}
            <span className="gallery-caption">{formatDate(item.createdAt)}</span>
          </div>
        ))}
      </div>
      {media && pageCount > 1 && (
        <div className="gallery-pager">
          <button
            className="icon-btn"
            disabled={pageIdx === 0}
            data-tip="上一页"
            onClick={() => gotoPage(pageIdx - 1)}
          >
            <ChevronLeftIcon size={13} />
          </button>
          <span className="gallery-pager-info">
            第 {pageIdx + 1} / {pageCount} 页
          </span>
          <button
            className="icon-btn"
            disabled={pageIdx >= pageCount - 1}
            data-tip="下一页"
            onClick={() => gotoPage(pageIdx + 1)}
          >
            <ChevronRightIcon size={13} />
          </button>
        </div>
      )}

      {viewer && (
        <div className="viewer-overlay" onClick={() => setViewer(null)}>
          <button className="viewer-close icon-btn" onClick={() => setViewer(null)}>
            <CloseIcon size={15} />
          </button>
          <div className="viewer-content" onClick={(e) => e.stopPropagation()}>
            {viewer.kind === 'image' ? (
              <img src={mediaUrl(viewer.mediaId)} />
            ) : (
              <video src={mediaUrl(viewer.mediaId)} controls autoPlay loop />
            )}
            <div className="viewer-caption">
              {viewer.model && <span className="viewer-model">{viewer.model}</span>}
              <span className="viewer-prompt">{viewer.prompt || viewer.title || ''}</span>
              <span className="viewer-meta">
                {formatDate(viewer.createdAt)} · {formatSize(viewer.size)}
              </span>
            </div>
          </div>
        </div>
      )}

      {menu &&
        createPortal(
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setMenu(null)
                void insertToVAssets(menu.item)
              }}
            >
              插入到 V-assets{activeProject ? `（${activeProject.name}）` : ''}
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setMenu(null)
                setViewer(menu.item)
              }}
            >
              放大预览
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setMenu(null)
                void window.api.bizone.revealMedia(menu.item.mediaId)
              }}
            >
              在访达中显示源文件
            </button>
          </div>,
          document.body
        )}

      {notice && <div className="pane-toast">{notice}</div>}
    </div>
  )
}

/* ---------- 图片面板主组件 ---------- */

/** 空图片窗口的粘贴区：⌘V 把剪贴板里的图存进 <项目>/assets/img/ 再就地预览。
 *  截图完直接粘进来，省掉「存桌面 → 拖进项目」那两步。 */
function PasteDrop({ cwd, onSaved }: { cwd?: string; onSaved: (p: string) => void }): JSX.Element {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  // 优先用**这个面板自己所属**的项目目录（tab.cwd）：画布上的图片节点常常不在当前
  // 活动项目的 Frame 里，用 activeProject 会把图存进别的项目。
  const project = cwd
    ? { path: cwd, name: cwd.split('/').filter(Boolean).pop() ?? cwd }
    : (projects.find((p) => p.id === activeProjectId) ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  const save = useCallback(async (): Promise<void> => {
    if (busy) return
    if (!project) return setErr('没有当前项目，不知道该存到哪')
    setBusy(true)
    setErr(null)
    const r = await window.api.clipboard.saveImage(project.path)
    setBusy(false)
    if (r.ok && r.path) onSaved(r.path)
    else setErr(r.error ?? '粘贴失败')
  }, [busy, project, onSaved])

  // 只接管落在本预览内的粘贴：终端、编辑器里的 ⌘V 不能被抢走
  useEffect(() => {
    const h = (e: ClipboardEvent): void => {
      const host = hostRef.current
      if (!host) return
      // 事件目标在里面、或焦点在里面，都算「粘到这个预览上」
      const inside =
        host.contains(e.target as Node) ||
        (!!document.activeElement && host.contains(document.activeElement))
      if (!inside) return
      e.preventDefault()
      void save()
    }
    document.addEventListener('paste', h)
    return () => document.removeEventListener('paste', h)
  }, [save])

  return (
    <div
      className="img-paste"
      ref={hostRef}
      tabIndex={0}
      onClick={() => hostRef.current?.focus()}
      onDoubleClick={() => void save()}
    >
      <ImageIcon size={26} className="img-paste-icon" />
      <div className="img-paste-title">{busy ? '保存中…' : '粘贴一张图片'}</div>
      <div className="img-paste-hint">
        点一下这里，再按 <b>⌘V</b>
      </div>
      <button className="img-paste-btn" disabled={busy} onClick={() => void save()}>
        从剪贴板粘贴
      </button>
      <div className="img-paste-path">
        {project ? (
          <>
            存到 <code>{project.name}/assets/img/</code>
          </>
        ) : (
          '未选择项目'
        )}
      </div>
      {err && <div className="img-paste-err">{err}</div>}
    </div>
  )
}

export function ImageView({
  filePath,
  cwd
}: {
  filePath: string | null
  cwd?: string
}): JSX.Element {
  // 空窗口也默认停在「文件预览」——那里现在是粘贴区，图片节点的主职就是放图
  const [mode, setMode] = useState<'file' | 'history'>('file')
  // 粘贴进来的图（组件内记住，不改节点数据；文件本身已经落盘在项目里了）
  const [pasted, setPasted] = useState<string | null>(null)
  const shown = filePath ?? pasted

  useEffect(() => {
    if (filePath) {
      setMode('file')
      setPasted(null)
    }
  }, [filePath])

  return (
    <div className="image-view">
      <div className="image-toolbar">
        <div className="segmented">
          <button
            className={mode === 'file' ? 'active' : ''}
            data-tip={shown ? '' : '空窗口可直接粘贴剪贴板里的图'}
            onClick={() => setMode('file')}
          >
            文件预览
          </button>
          <button
            className={mode === 'history' ? 'active' : ''}
            onClick={() => setMode('history')}
          >
            生图历史
          </button>
        </div>
      </div>
      <div className="image-body">
        {mode === 'file' ? (
          shown ? (
            <FilePreview filePath={shown} />
          ) : (
            <PasteDrop cwd={cwd} onSaved={setPasted} />
          )
        ) : (
          <BizoneHistory />
        )}
      </div>
    </div>
  )
}
