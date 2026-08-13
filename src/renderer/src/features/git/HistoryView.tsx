import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitCommit, GitCommitFile } from '../../../../shared/types'
import { computeGraphRows, parseRefs, type GraphSegment } from './gitGraph'
import { statusInfo } from './gitUi'
import { DiffView } from '../editor/DiffView'
import { RefreshIcon, GitBranchIcon } from '../../ui/Icons'
import { CanvasContextMenu } from '../canvas/CanvasContextMenu'
import { useStore } from '../../store'
import { ErrorBoundary } from '../../ui/ErrorBoundary'

const ROW_H = 30 // 提交表行高（固定，保证轨道图与各列对齐）
const LANE_W = 18 // 主视图轨道列宽
const MAX_LANES = 12
const LOG_LIMIT = 200

function fmtShort(sec: number): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
function fmtFull(sec: number): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 一段轨道线的 SVG path（同 lane 竖直；跨 lane 走 S 形曲线，SourceTree 观感）
function segPath(s: GraphSegment, cx: (l: number) => number): string {
  const x1 = cx(s.fromLane)
  const y1 = s.fromY * ROW_H
  const x2 = cx(s.toLane)
  const y2 = s.toY * ROW_H
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`
  const my = (y1 + y2) / 2
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
}

function HistoryViewInner({ cwd }: { cwd: string }): JSX.Element {
  const [log, setLog] = useState<GitCommit[]>([])
  const [branch, setBranch] = useState<string>('')
  const [isRepo, setIsRepo] = useState<boolean>(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<GitCommitFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [topRatio, setTopRatio] = useState(0.58)
  const [menu, setMenu] = useState<{ x: number; y: number; hash: string; subject: string } | null>(
    null
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const requestConfirm = useStore((s) => s.requestConfirm)

  // 右键「回退到该版本」→ 弹确认 → git reset --hard 到该提交（破坏性，故先确认），成功后刷新历史
  const askReset = (hash: string, subject: string): void => {
    requestConfirm({
      message: `回退到「${subject}」(${hash.slice(0, 8)})？当前分支会重置到该提交，之后的提交与未提交改动都会丢失。`,
      confirmLabel: '回退到该版本',
      onConfirm: () => {
        void window.api.git.resetHard(cwd, hash).then((r) => {
          if (r.ok) void refresh()
        })
      }
    })
  }

  const refresh = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const st = await window.api.git.status(cwd)
    setIsRepo(st.isRepo)
    setBranch(st.branch ?? '')
    if (st.isRepo) setLog(await window.api.git.log(cwd, LOG_LIMIT))
  }, [cwd])

  useEffect(() => {
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // 选中提交 → 拉它的改动文件，默认选第一个
  useEffect(() => {
    if (!selected) {
      setFiles([])
      setActiveFile(null)
      return
    }
    let cancelled = false
    void window.api.git.commitFiles(cwd, selected).then((fs) => {
      if (cancelled) return
      setFiles(fs)
      setActiveFile(fs[0]?.path ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [selected, cwd])

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const move = (ev: MouseEvent): void => {
      const box = wrapRef.current?.getBoundingClientRect()
      if (!box) return
      const r = (ev.clientY - box.top) / box.height
      setTopRatio(Math.min(0.85, Math.max(0.2, r)))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // 拖分隔条时每次 mousemove 都会重渲染，lane 布局只需随 log 变化重算。
  //
  // **这个 useMemo 必须留在「不是 git 仓库」的提前返回之前。**
  // isRepo 初值是 true → 首帧渲染 14 个 hook；refresh() 异步跑完发现不是 git 目录 →
  // setIsRepo(false) → 下一帧在提前返回处只渲染 13 个 → React #300
  // （Rendered fewer hooks than expected）。而这一崩是**渲染阶段**崩：
  // 版本管理没有自己的错误边界时会一路冒到根级边界，整个 <App/> 连同所有终端一起卸载；
  // 更糟的是「重新加载」救不回来——版本管理是持久化的画布节点，重载 → 画布还原 →
  // 节点重新挂载 → 再判非 git → 再崩，唯一出路「重置画布」会清掉用户全部画布布局。
  // computeGraphRows([]) 对空数组是安全的，放在这里不多花什么。
  const rows = useMemo(() => computeGraphRows(log), [log])

  if (!isRepo) {
    return (
      <div className="pane-placeholder">
        <div>历史</div>
        <div className="pane-placeholder-hint">当前目录不是 Git 仓库</div>
      </div>
    )
  }

  const maxLanes = Math.min(rows.reduce((m, r) => Math.max(m, r.laneCount), 1), MAX_LANES)
  const gutterW = maxLanes * LANE_W
  const cx = (l: number): number => Math.min(l, maxLanes - 1) * LANE_W + LANE_W / 2

  const sel = log.find((c) => c.hash === selected) ?? null

  return (
    <div className="history-view" ref={wrapRef}>
      <div className="history-top" style={{ height: `${topRatio * 100}%` }}>
        <div className="history-head">
          <GitBranchIcon size={13} />
          <span className="history-branch">{branch || '历史'}</span>
          <span className="history-count">{log.length} 个提交</span>
          <span className="pane-spacer" />
          <button className="icon-btn" data-tip="刷新" onClick={() => void refresh()}>
            <RefreshIcon size={13} />
          </button>
        </div>
        <div className="history-cols" style={{ paddingLeft: gutterW + 12 }}>
          <span className="hc-desc">描述</span>
          <span className="hc-author">作者</span>
          <span className="hc-date">日期</span>
        </div>
        <div className="history-rows">
          {rows.map((row) => {
            const c = row.commit
            const refs = parseRefs(c.refs)
            return (
              <div
                key={c.hash}
                className={`history-row${selected === c.hash ? ' active' : ''}`}
                style={{ height: ROW_H }}
                onClick={() => setSelected(c.hash)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation() // 别冒泡到画布节点的右键菜单（复制/删除节点）
                  setSelected(c.hash)
                  setMenu({ x: e.clientX, y: e.clientY, hash: c.hash, subject: c.subject })
                }}
              >
                <svg className="history-graph" width={gutterW} height={ROW_H}>
                  {row.segments.map((s, i) => (
                    <path key={i} d={segPath(s, cx)} stroke={s.color} strokeWidth={1.8} fill="none" />
                  ))}
                  <circle cx={cx(row.lane)} cy={ROW_H / 2} r={4.5} fill={row.color} stroke="#0d0f16" strokeWidth={1.4} />
                </svg>
                <span className="history-desc">
                  {refs.map((r, i) => (
                    <span key={i} className={`git-ref ${r.kind}`}>
                      {r.name}
                    </span>
                  ))}
                  <span className="history-subject">{c.subject}</span>
                </span>
                <span className="history-author">{c.author}</span>
                <span className="history-date">{fmtShort(c.at)}</span>
              </div>
            )
          })}
          {rows.length === 0 && <div className="git-empty">暂无提交</div>}
        </div>
      </div>

      <div className="history-divider" onMouseDown={startDrag} />

      <div className="history-bottom">
        {sel ? (
          <>
            <div className="history-detail-head">
              <span className="history-detail-hash">{sel.hash.slice(0, 8)}</span>
              <span className="history-detail-subject">{sel.subject}</span>
              <span className="history-detail-meta">
                {sel.author} · {fmtFull(sel.at)}
              </span>
            </div>
            <div className="history-detail">
              <div className="history-files">
                <div className="git-group-head">
                  <span>改动文件</span>
                  <span className="git-group-count">{files.length}</span>
                </div>
                {files.map((f) => {
                  const base = f.path.split('/').pop() ?? f.path
                  return (
                    <div
                      key={f.path}
                      className={`git-row${activeFile === f.path ? ' active' : ''}`}
                      data-tip={f.path}
                      onClick={() => setActiveFile(f.path)}
                    >
                      <span className={`git-badge ${statusInfo(f.status).cls}`}>{f.status}</span>
                      <span className="git-file-name">{base}</span>
                    </div>
                  )
                })}
                {files.length === 0 && <div className="git-empty">（无文件差异）</div>}
              </div>
              <div className="history-filediff">
                {activeFile ? (
                  <DiffView key={`${sel.hash}:${activeFile}`} cwd={cwd} relPath={activeFile} commit={sel.hash} />
                ) : (
                  <div className="git-diff-hint">选择左侧文件查看改动</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="git-diff-hint">在上方选择一个提交，查看这次改了什么</div>
        )}
      </div>
      {menu && (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: '回退到该版本',
              danger: true,
              onClick: () => askReset(menu.hash, menu.subject)
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/** 版本管理崩溃时的兜底：只掉这一个模块，终端和画布照常。复用 .pane-placeholder 的排版 */
function HistoryCrash({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  return (
    <div className="pane-placeholder">
      <div>版本管理遇到了一个错误</div>
      <div className="pane-placeholder-hint">
        不影响终端和画布的其它模块，可以直接删掉这个模块或重试。
      </div>
      <div className="pane-placeholder-hint">{error.message || String(error)}</div>
      <div className="err-btns">
        <button className="err-btn" onClick={reset}>
          重试
        </button>
      </div>
    </div>
  )
}

/**
 * 对外只暴露这个包了错误边界的版本。
 *
 * 边界包在**外面**是必须的：React 的边界只接住子树的错误，接不住自己的。
 * 而且必须包在这里、不是包在两个调用点（画布组件 registry.tsx + 分屏 PaneView.tsx）——
 * 包在调用点的话，以后第三个地方用到 HistoryView 就会漏。
 *
 * 为什么值得单独一层：这个模块渲染时崩掉的话，没有局部边界就会一路冒到 main.tsx 的
 * 根级边界，把整个 <App/>（含所有终端）卸载掉；而它又是**持久化**的画布/分屏节点，
 * 重载后会重新挂载、再崩一次，用户只能靠「重置画布」逃出来（代价是全部画布布局）。
 * 同一个道理见 GanttErrorBoundary.tsx 顶部注释。
 */
export function HistoryView({ cwd }: { cwd: string }): JSX.Element {
  return (
    <ErrorBoundary
      label="history"
      fallback={(error, reset) => <HistoryCrash error={error} reset={reset} />}
    >
      <HistoryViewInner cwd={cwd} />
    </ErrorBoundary>
  )
}
