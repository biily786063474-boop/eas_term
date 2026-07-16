import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitCommit, GitCommitFile } from '../../../shared/types'
import { computeGraphRows, parseRefs, type GraphSegment } from '../gitGraph'
import { DiffView } from './DiffView'
import { RefreshIcon, GitBranchIcon } from './Icons'

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

function statusCls(s: string): string {
  if (s === 'A') return 'add'
  if (s === 'D') return 'del'
  if (s === 'R' || s === 'C') return 'mod'
  return 'mod'
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

export function HistoryView({ cwd }: { cwd: string }): JSX.Element {
  const [log, setLog] = useState<GitCommit[]>([])
  const [branch, setBranch] = useState<string>('')
  const [isRepo, setIsRepo] = useState<boolean>(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<GitCommitFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [topRatio, setTopRatio] = useState(0.58)
  const wrapRef = useRef<HTMLDivElement>(null)

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

  if (!isRepo) {
    return (
      <div className="pane-placeholder">
        <div>历史</div>
        <div className="pane-placeholder-hint">当前目录不是 Git 仓库</div>
      </div>
    )
  }

  const rows = computeGraphRows(log)
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
          <button className="icon-btn" title="刷新" onClick={() => void refresh()}>
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
                      title={f.path}
                      onClick={() => setActiveFile(f.path)}
                    >
                      <span className={`git-badge ${statusCls(f.status)}`}>{f.status}</span>
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
    </div>
  )
}
