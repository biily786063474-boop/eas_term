// 在 Frame 空白处双击 → 弹出「插入」选择器。
//
// 三个选项卡：文件夹 / 最近 / **插件**。前两个插的是文件，第三个插的是
// 「一个绑定了某插件的 AI 对话节点」——插件本身没有界面可渲染（两个生态的插件
// 都不含 UI 代码，2026-08-24 实测），能插进画布的只有「带着它的工具的会话」。
//
// 两种排序（用户可切）：
//   · 文件夹 —— 和访达/资源管理器一致的顺序（目录在前、名称升序），可逐级进入子目录
//   · 最近   —— 整个项目递归扫描，按文件创建时间倒序，刚产生的排最上面
//              （agent 刚写完一份报告，来这儿一眼就能找到，不用自己翻目录）

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirEntry, PluginInfo, RecentFile } from '../../../../shared/types'
import { useMenuAnchor, useDismiss } from '../../ui/CanvasContextMenu'
import { isImagePath, isVideoPath, isMediaPath } from './media'
import { ChevronLeftIcon, ClockIcon, CodeIcon, FileIcon, FolderIcon, GlobeIcon, ImageIcon, PlugIcon, FilesIcon } from '../../ui/Icons'
import { SplitText } from '../../ui/SplitText'

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
  onPickPlugin,
  onClose
}: {
  x: number
  y: number
  /** 起始目录：子 Frame 用它的 folderPath，项目 Frame 用项目根 */
  root: string
  rootName: string
  onPick: (filePath: string) => void
  /** 选了一个插件：调用方据此在这个 Frame 里开一个绑定该插件的 AI 对话节点 */
  onPickPlugin: (p: PluginInfo) => void
  onClose: () => void
}): JSX.Element {
  const [mode, setMode] = useState<'tree' | 'recent' | 'plugin'>('tree')
  // 已装插件。**切到这个 tab 才拉** —— 扫两个 CLI 的缓存目录是同步 IO，
  // 没人看的时候没必要每次开选择器都跑一遍。
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [dir, setDir] = useState(root)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [recent, setRecent] = useState<RecentFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  // 「只保留文档文件」勾选状态：从 prefs 初始化，变化时写回并触发重拉（见下面的 effect）
  // 过滤三选一。**「文档」走主进程**（recentFiles 的第三个参数，它要扫全项目并限量 60，
  // 在那边筛才不会「筛完只剩三条」）；**「多媒体」走客户端**（两种模式共用一份判定，
  // 而且主进程那条 IPC 只认 docsOnly 一个布尔，扩它得改签名和 prefs 类型）。
  // 代价写在这儿：「最近」+「多媒体」时，60 条里没有媒体文件就会是空列表 ——
  // 那时切到「文件夹」模式按目录找。
  const [filter, setFilter] = useState<'all' | 'docs' | 'media'>('all')
  const docsOnly = filter === 'docs'
  useEffect(() => {
    // 记着的「只看文档」偏好恢复回来；没设过就是「全部」。
    // 「多媒体」不持久化 —— 它是「这一次我要找图」的临时意图，不是长期偏好
    void window.api.prefs.get().then((p) => {
      if (p.recentDocsOnly) setFilter('docs')
    })
  }, [])
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
    if (mode !== 'recent') return
    let alive = true
    setRecent(null)
    window.api.fs
      .recentFiles(root, MAX_RECENT, docsOnly)
      .then((list) => alive && setRecent(list))
      .catch(() => alive && setRecent([]))
    return () => {
      alive = false
    }
  }, [mode, root, docsOnly])

  useEffect(() => {
    if (mode !== 'plugin') return
    let alive = true
    setPlugins(null)
    window.api.plugins
      .list()
      .then((list) => alive && setPlugins(list))
      // 扫不到就是一个都没装 —— 空态那句话会给出路，不当错误处理
      .catch(() => alive && setPlugins([]))
    return () => {
      alive = false
    }
  }, [mode])

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
        <span className="cpk-title">插入</span>
        <span className="cpk-scope">{rootName}</span>
      </div>
      {/* ── 两组展开式胶囊 ────────────────────────────────────────
          **选中的摊开成胶囊（图标＋文字），没选中的缩成正圆（只剩图标）。**
          形态对齐知识库抽屉的书签胶囊，那边竖排、这边横排。

          之前这里「怎么看都挤」，根因不在这个设计，而在 canvas.css 里还留着
          上一代的 `.cpk-tabs button` / `.cpk-filters button` —— 权重压过
          `.cpk-pill`，把 padding 吃成 0、又 `flex: 1` 平分宽度，圆的不圆、
          胶囊挤成一团。那两块已删，样式统一由 `.cpk-pill` 一处管。

          hover 刻意**不**展开：六个按钮挨着，鼠标扫过去会一路把邻居顶来顶去。 */}
      <div className="cpk-bar">
      <div className="cpk-tabs cpk-pills">
        <button
          className={`cpk-pill${mode === 'tree' ? ' on' : ''}`}
          aria-label="文件夹"
          onClick={() => setMode('tree')}
        >
          <FolderIcon size={12} />
          <SplitText text="文件夹" />
        </button>
        <button
          className={`cpk-pill${mode === 'recent' ? ' on' : ''}`}
          aria-label="最近"
          onClick={() => setMode('recent')}
        >
          <ClockIcon size={12} />
          <SplitText text="最近" />
        </button>
        <button
          className={`cpk-pill${mode === 'plugin' ? ' on' : ''}`}
          aria-label="插件"
          onClick={() => setMode('plugin')}
        >
          <PlugIcon size={12} />
          <SplitText text="插件" />
        </button>
      </div>

      {/* 过滤三选一。原来这里是「只保留文档」一个复选框、而且只在「最近」模式出现——
          插图片进画布是这个选择器最常见的用途之一，却只能靠肉眼在一堆代码文件里找。
          **插件 tab 不出现这条** —— 「文档/多媒体」对插件没有意义，留着只是噪声。 */}
      {mode !== 'plugin' && (
      <div className="cpk-filters cpk-pills">
        {(
          [
            { id: 'all', label: '全部', Icon: FilesIcon },
            { id: 'docs', label: '文档', Icon: FileIcon },
            { id: 'media', label: '多媒体', Icon: ImageIcon }
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            aria-label={f.label}
            className={`cpk-pill${filter === f.id ? ' on' : ''}`}
            data-tip={
              f.id === 'docs'
                ? '.md / .txt / .html'
                : f.id === 'media'
                  ? '图片 / 视频 / 音频'
                  : undefined
            }
            onClick={() => {
              setFilter(f.id)
              // 「文档」那档由主进程筛（见 filter 的说明），要同步过去
              void window.api.prefs.set('recentDocsOnly', f.id === 'docs')
            }}
          >
            <f.Icon size={12} />
            <SplitText text={f.label} />
          </button>
        ))}
      </div>
      )}
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
            {entries
              .filter((e) => e.isDir || filter !== 'media' || isMediaPath(e.path))
              .map((e) =>
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
            {!!entries.length &&
              filter === 'media' &&
              !entries.some((e) => !e.isDir && isMediaPath(e.path)) && (
                <div className="cpk-empty">这个文件夹里没有图片 / 视频 / 音频</div>
              )}
          </>
        )}

        {!loading && mode === 'recent' && (
          <>
            {(recent ?? [])
              .filter((f) => filter !== 'media' || isMediaPath(f.path))
              .map((f) => (
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

        {mode === 'plugin' && (
          <>
            {plugins === null && <div className="cpk-empty">读取中…</div>}
            {plugins?.map((p) => (
              <button
                key={p.id}
                className="cpk-row"
                onClick={() => {
                  onPickPlugin(p)
                  onClose()
                }}
              >
                {/* 有品牌色就用它画一个小圆点 —— Codex 插件都带 brandColor，
                    Claude 插件一律没有，那时退回中性色，不为了好看去猜一个。 */}
                <span
                  className="cpk-plug-dot"
                  style={{ background: p.brandColor ?? '#525252' }}
                  aria-hidden="true"
                />
                <span className="cpk-name">{p.displayName}</span>
                <span className="cpk-time">{p.category ?? p.cli}</span>
              </button>
            ))}
            {plugins && !plugins.length && (
              <div className="cpk-empty">
                还没装任何插件 —— 在终端里跑 <code>codex plugin add …</code> 或{' '}
                <code>claude plugin install …</code> 装一个
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
