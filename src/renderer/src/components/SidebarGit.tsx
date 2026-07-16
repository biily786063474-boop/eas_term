import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { GitStatus, GitFileEntry, GitCommit } from '../../../shared/types'
import { computeGraphRows, parseRefs } from '../gitGraph'
import {
  GitBranchIcon,
  RefreshIcon,
  PlusIcon,
  MinusIcon,
  UndoIcon,
  CheckIcon,
  SparkleIcon,
  ClockIcon
} from './Icons'

const LANE_W = 14 // 轨道图每列宽度（px）
const MAX_LANES = 5 // 侧栏 gutter 最多显示的轨道数

const POLL_MS = 3000
const LOG_LIMIT = 40

function statusInfo(letter: string): { label: string; cls: string } {
  switch (letter) {
    case 'A':
    case '?':
      return { label: letter === '?' ? 'U' : 'A', cls: 'add' }
    case 'D':
      return { label: 'D', cls: 'del' }
    case 'U':
    case '!':
      return { label: 'U', cls: 'conflict' }
    case 'R':
    case 'C':
      return { label: letter, cls: 'mod' }
    default:
      return { label: 'M', cls: 'mod' }
  }
}

function splitName(p: string): { dir: string; base: string } {
  const idx = p.lastIndexOf('/')
  return idx < 0 ? { dir: '', base: p } : { dir: p.slice(0, idx), base: p.slice(idx + 1) }
}

function relTime(sec: number): string {
  if (!sec) return ''
  const diff = Date.now() / 1000 - sec
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 172800) return '昨天'
  const d = new Date(sec * 1000)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

interface AiState {
  loading?: boolean
  text?: string
  error?: string
}

// 侧栏「版本」标签：分支 + 变更 + 提交 + 历史（每条可按需 AI 总结）。
// 变更/提交都作用于当前项目根目录；点变更文件 → diff 开在主区域。
export function SidebarGit({ cwd }: { cwd: string }): JSX.Element {
  const openDiff = useStore((s) => s.openDiff)
  const openHistory = useStore((s) => s.openHistory)
  const requestConfirm = useStore((s) => s.requestConfirm)

  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitCommit[]>([])
  const [message, setMessage] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [ai, setAi] = useState<Record<string, AiState>>({})
  const busyRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!cwd) {
      setStatus({ isRepo: false, files: [] })
      return
    }
    const s = await window.api.git.status(cwd)
    setStatus(s)
    if (s.isRepo) setLog(await window.api.git.log(cwd, LOG_LIMIT))
  }, [cwd])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    const onDirChanged = (): void => void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('fs-dir-changed', onDirChanged)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('fs-dir-changed', onDirChanged)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const showToast = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    fail: string
  ): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const r = await fn()
      if (!r.ok) showToast(`${fail}：${r.error ?? '失败'}`)
      await refresh()
    } finally {
      busyRef.current = false
    }
  }

  const stage = (f: GitFileEntry): Promise<void> =>
    run(() => window.api.git.stage(cwd, [f.path]), '暂存失败')
  const unstage = (f: GitFileEntry): Promise<void> =>
    run(() => window.api.git.unstage(cwd, [f.path]), '取消暂存失败')
  const discard = (f: GitFileEntry): void => {
    requestConfirm({
      message: f.untracked
        ? `丢弃未跟踪文件「${splitName(f.path).base}」？会移入废纸篓。`
        : `丢弃「${splitName(f.path).base}」的改动？此操作不可撤销。`,
      confirmLabel: '丢弃改动',
      onConfirm: () => void run(() => window.api.git.discard(cwd, [f.path], f.untracked), '丢弃失败')
    })
  }

  const files = status?.files ?? []
  const stagedFiles = files.filter((f) => f.staged)
  const changedFiles = files.filter((f) => f.unstaged)

  const stageAll = (): Promise<void> =>
    run(() => window.api.git.stage(cwd, changedFiles.map((f) => f.path)), '暂存失败')

  const doCommit = (): void => {
    void run(async () => {
      const r = await window.api.git.commit(cwd, message)
      if (r.ok) {
        setMessage('')
        showToast('已提交')
      }
      return r
    }, '提交失败')
  }

  const describe = async (hash: string): Promise<void> => {
    if (ai[hash]?.loading) return
    setAi((m) => ({ ...m, [hash]: { loading: true } }))
    const r = await window.api.git.describe(cwd, hash)
    setAi((m) => ({
      ...m,
      [hash]: r.ok ? { text: r.text } : { error: r.error ?? '生成失败' }
    }))
  }

  if (!cwd) {
    return <div className="git-msg">未选择项目</div>
  }
  if (status && !status.isRepo) {
    return <div className="git-msg">当前项目不是 Git 仓库</div>
  }

  const fileRow = (f: GitFileEntry, group: 'staged' | 'changed'): JSX.Element => {
    const letter = group === 'staged' ? f.x : f.untracked ? '?' : f.conflicted ? 'U' : f.y
    const info = statusInfo(letter)
    const { base } = splitName(f.path)
    const mode = group === 'staged' ? 'staged' : 'worktree'
    return (
      <div
        key={`${group}:${f.path}`}
        className="git-row"
        title={f.path}
        onClick={() => openDiff({ cwd, relPath: f.path, mode })}
      >
        <span className={`git-badge ${info.cls}`}>{info.label}</span>
        <span className="git-file-name">{base}</span>
        <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
          {group === 'changed' ? (
            <>
              <button className="icon-btn" title="丢弃改动" onClick={() => discard(f)}>
                <UndoIcon size={13} />
              </button>
              <button className="icon-btn" title="暂存" onClick={() => void stage(f)}>
                <PlusIcon size={14} />
              </button>
            </>
          ) : (
            <button className="icon-btn" title="取消暂存" onClick={() => void unstage(f)}>
              <MinusIcon size={14} />
            </button>
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="git-view">
      <div className="git-branch-row">
        <GitBranchIcon size={13} />
        <span className="git-branch-name" title={status?.branch ?? ''}>
          {status?.branch ?? '—'}
        </span>
        {!!(status?.ahead || status?.behind) && (
          <span className="git-ab">
            {status?.ahead ? `↑${status.ahead}` : ''}
            {status?.behind ? `↓${status.behind}` : ''}
          </span>
        )}
        <span className="pane-spacer" />
        <button
          className="git-graph-btn"
          title="在主区域打开分支图 / 历史大视图"
          onClick={() => openHistory(cwd)}
        >
          <GitBranchIcon size={12} />
          <span>分支图</span>
        </button>
        <button className="icon-btn" title="刷新" onClick={() => void refresh()}>
          <RefreshIcon size={13} />
        </button>
      </div>

      <div className="git-commit">
        <input
          className="git-commit-input"
          placeholder="这次改了啥？一句话…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doCommit()
          }}
        />
        <button
          className="git-commit-btn"
          title="提交已暂存的更改（⌘/Ctrl+Enter）"
          disabled={!message.trim() || stagedFiles.length === 0}
          onClick={doCommit}
        >
          <CheckIcon size={14} />
        </button>
      </div>

      <div className="git-scroll">
        {stagedFiles.length > 0 && (
          <div className="git-group">
            <div className="git-group-head">
              <span>暂存的更改</span>
              <span className="git-group-count">{stagedFiles.length}</span>
            </div>
            {stagedFiles.map((f) => fileRow(f, 'staged'))}
          </div>
        )}

        <div className="git-group">
          <div className="git-group-head">
            <span>更改</span>
            <span className="git-group-count">{changedFiles.length}</span>
            {changedFiles.length > 0 && (
              <button className="git-group-action" title="全部暂存" onClick={() => void stageAll()}>
                <PlusIcon size={13} />
              </button>
            )}
          </div>
          {changedFiles.length === 0 && stagedFiles.length === 0 && (
            <div className="git-empty">没有改动</div>
          )}
          {changedFiles.map((f) => fileRow(f, 'changed'))}
        </div>

        <div className="git-group">
          <div className="git-group-head">
            <span>历史</span>
          </div>
          {log.length === 0 && <div className="git-empty">暂无提交</div>}
          {(() => {
            const rows = computeGraphRows(log)
            const maxLanes = rows.reduce((m, r) => Math.max(m, r.laneCount), 1)
            const displayLanes = Math.min(maxLanes, MAX_LANES)
            const gutterW = displayLanes * LANE_W
            const cx = (l: number): number => Math.min(l, displayLanes - 1) * LANE_W + LANE_W / 2
            return rows.map((row) => {
              const c = row.commit
              const a = ai[c.hash]
              const refs = parseRefs(c.refs)
              return (
                <div key={c.hash} className="git-commit-row">
                  <div className="git-graph-cell" style={{ width: gutterW }}>
                    <svg width={gutterW} height="100%" preserveAspectRatio="none">
                      {row.segments.map((s, i) => (
                        <line
                          key={i}
                          x1={cx(s.fromLane)}
                          y1={`${s.fromY * 100}%`}
                          x2={cx(s.toLane)}
                          y2={`${s.toY * 100}%`}
                          stroke={s.color}
                          strokeWidth={1.8}
                          fill="none"
                        />
                      ))}
                      <circle cx={cx(row.lane)} cy="50%" r={3.6} fill={row.color} stroke="#0d0f16" strokeWidth={1.2} />
                    </svg>
                  </div>
                  <div className="git-commit-body">
                    {refs.length > 0 && (
                      <div className="git-refs">
                        {refs.map((r, i) => (
                          <span key={i} className={`git-ref ${r.kind}`}>
                            {r.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="git-commit-main">
                      <span className="git-commit-subject">{a?.text ?? c.subject}</span>
                      <button
                        className={`git-ai-btn${a?.text ? ' done' : ''}`}
                        title={a?.text ? 'AI 已总结' : '让 AI 用人话总结这次改动'}
                        disabled={a?.loading}
                        onClick={() => void describe(c.hash)}
                      >
                        <SparkleIcon size={12} />
                        <span>{a?.loading ? '…' : a?.text ? 'AI' : 'AI 总结'}</span>
                      </button>
                    </div>
                    <div className="git-commit-meta">
                      <ClockIcon size={11} />
                      <span>{relTime(c.at)}</span>
                      <span className="git-commit-dot">·</span>
                      <span>{c.files} 个文件</span>
                      {a?.text && (
                        <span className="git-commit-orig" title={c.subject}>
                          {c.subject}
                        </span>
                      )}
                    </div>
                    {a?.error && <div className="git-ai-error">{a.error}</div>}
                  </div>
                </div>
              )
            })
          })()}
        </div>
      </div>

      {toast && <div className="git-toast">{toast}</div>}
    </div>
  )
}
