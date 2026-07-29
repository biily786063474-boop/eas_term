// 在 Frame 空白处双击 → 弹出「插入文件」选择器。
//
// 两种排序（用户可切）：
//   · 文件夹 —— 和访达/资源管理器一致的顺序（目录在前、名称升序），可逐级进入子目录
//   · 最近   —— 整个项目递归扫描，按文件创建时间倒序，刚产生的排最上面
//              （agent 刚写完一份报告，来这儿一眼就能找到，不用自己翻目录）

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirEntry, RecentFile } from '../../../../shared/types'
import { useMenuAnchor, useDismiss } from './CanvasContextMenu'
import { isImagePath, isVideoPath } from './media'
import {
  ChevronLeftIcon,
  ClockIcon,
  CodeIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  ImageIcon
} from '../../ui/Icons'

const MAX_RECENT = 60

function FileGlyph({ path }: { path: string }): JSX.Element {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (isImagePath(path) || isVideoPath(path)) return <ImageIcon size={13} />
  if (ext === 'html' || ext === 'htm') return <GlobeIcon size={13} />
  if (/^(ts|tsx|js|jsx|py|go|rs|java|c|h|cpp|sh|json|css|vue|swift|rb|php)$/.test(ext))
    return <CodeIcon size={13} />
  return <FileIcon size={13} />
}

// 创建时间：今天只给时分，昨天点名，更早给月日——菜单里一列窄字，越短越好扫
function fmtTime(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now)) return hm
  const y = new Date(now.getTime() - 86400000)
  if (sameDay(d, y)) return '昨天 ' + hm
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

export function CanvasFilePicker({
  x,
  y,
  root,
  rootName,
  onPick,
  onClose
}: {
  x: number
  y: number
  /** 起始目录：子 Frame 用它的 folderPath，项目 Frame 用项目根 */
  root: string
  rootName: string
  onPick: (filePath: string) => void
  onClose: () => void
}): JSX.Element {
  const [mode, setMode] = useState<'tree' | 'recent'>('tree')
  const [dir, setDir] = useState(root)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [recent, setRecent] = useState<RecentFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  // 尺寸固定（宽 + 定高列表），所以只在挂载时定位一次，切排序/进目录都不会让菜单乱跳
  const pos = useMenuAnchor(x, y, ref)
  useDismiss(onClose)

  useEffect(() => {
    if (mode !== 'tree') return
    let alive = true
    setLoading(true)
    window.api.fs
      .readDir(dir)
      .then((list) => alive && setEntries(list))
      .catch(() => alive && setEntries([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [dir, mode])

  useEffect(() => {
    if (mode !== 'recent' || recent) return
    let alive = true
    setLoading(true)
    window.api.fs
      .recentFiles(root, MAX_RECENT)
      .then((list) => alive && setRecent(list))
      .catch(() => alive && setRecent([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [mode, recent, root])

  // 路径分隔符跟随平台（Windows 是 \），否则「返回上级」在 Windows 上会切出个空串
  const sep = root.includes('\\') ? '\\' : '/'
  const rel = dir === root ? '' : dir.slice(root.length + 1)
  const upDir = dir.slice(0, dir.lastIndexOf(sep))

  const pick = (p: string): void => {
    onPick(p)
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      className="canvas-picker"
      style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="cpk-head">
        <span className="cpk-title">插入文件</span>
        <span className="cpk-scope">{rootName}</span>
      </div>
      <div className="cpk-tabs">
        <button className={mode === 'tree' ? 'on' : ''} onClick={() => setMode('tree')}>
          <FolderIcon size={12} />
          文件夹
        </button>
        <button className={mode === 'recent' ? 'on' : ''} onClick={() => setMode('recent')}>
          <ClockIcon size={12} />
          最近
        </button>
      </div>

      {mode === 'tree' && (
        <div className="cpk-path" title={dir}>
          {rel ? rootName + sep + rel : rootName}
        </div>
      )}

      <div className="cpk-list">
        {loading && <div className="cpk-empty">读取中…</div>}

        {!loading && mode === 'tree' && (
          <>
            {dir !== root && (
              <button className="cpk-row up" onClick={() => setDir(upDir)}>
                <ChevronLeftIcon size={13} />
                <span className="cpk-name">返回上级</span>
              </button>
            )}
            {entries.map((e) =>
              e.isDir ? (
                <button
                  key={e.path}
                  className={`cpk-row dir${e.isHidden ? ' faint' : ''}`}
                  onClick={() => setDir(e.path)}
                >
                  <FolderIcon size={13} />
                  <span className="cpk-name">{e.name}</span>
                  <span className="cpk-arrow">›</span>
                </button>
              ) : (
                <button
                  key={e.path}
                  className={`cpk-row${e.isHidden ? ' faint' : ''}`}
                  onClick={() => pick(e.path)}
                >
                  <FileGlyph path={e.path} />
                  <span className="cpk-name">{e.name}</span>
                </button>
              )
            )}
            {!entries.length && dir === root && <div className="cpk-empty">这个文件夹是空的</div>}
          </>
        )}

        {!loading && mode === 'recent' && (
          <>
            {(recent ?? []).map((f) => (
              <button key={f.path} className="cpk-row" onClick={() => pick(f.path)} title={f.rel}>
                <FileGlyph path={f.path} />
                <span className="cpk-name">
                  {f.name}
                  {f.rel !== f.name && <em className="cpk-rel">{f.rel.slice(0, -f.name.length)}</em>}
                </span>
                <span className="cpk-time">{fmtTime(f.time)}</span>
              </button>
            ))}
            {recent && !recent.length && <div className="cpk-empty">没扫到文件</div>}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
