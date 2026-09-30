import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { GitStatus, GitFileEntry, GitCommit } from '../../../../shared/types'
import { computeGraphRows, parseRefs } from './gitGraph'
import { statusInfo } from './gitUi'
import { useT, t as tNow } from '../../i18n.ts'
import './git.css'
import {
  GitBranchIcon,
  RefreshIcon,
  PlusIcon,
  MinusIcon,
  UndoIcon,
  CheckIcon,
  SparkleIcon,
  ClockIcon
} from '../../ui/Icons'

const LANE_W = 14 // 轨道图每列宽度（px）
const MAX_LANES = 5 // 侧栏 gutter 最多显示的轨道数

// 兜底轮询间隔。**真正让它跟手的是 fs-dir-changed 和 focus 两个事件**（见下面的 effect），
// 这个 interval 只管「文件在应用外被改、而且没有触发目录监听」这种漏网情况。
// 原来 3s：一次 refresh 要起两个 git 进程（status + log），也就是每分钟 40 次进程创建；
// 本仓库 216 个文件时单次 20-30ms，换成几千文件的仓库会到几百毫秒，
// 于是「开着版本标签挂一下午」就变成持续几个百分点的占用。
// 有事件兜着，15s 足够，进程创建量降到 1/5。
const POLL_MS = 15000
const LOG_LIMIT = 40

function splitName(p: string): { dir: string; base: string } {
  const idx = p.lastIndexOf('/')
  return idx < 0 ? { dir: '', base: p } : { dir: p.slice(0, idx), base: p.slice(idx + 1) }
}

function relTime(sec: number): string {
  if (!sec) return ''
  const diff = Date.now() / 1000 - sec
  if (diff < 60) return tNow('git.relJustNow')
  if (diff < 3600) return tNow('git.relMinutes', { n: Math.floor(diff / 60) })
  if (diff < 86400) return tNow('git.relHours', { n: Math.floor(diff / 3600) })
  if (diff < 172800) return tNow('git.relYesterday')
  const d = new Date(sec * 1000)
  return tNow('git.relDate', { m: d.getMonth() + 1, d: d.getDate() })
}

interface AiState {
  loading?: boolean
  text?: string
  error?: string
}

// 重命名/复制条目要把新旧两个路径都交给 git：只传新路径会留下旧路径的半截暂存态
// （如取消暂存 R 条目后旧路径仍是 staged 删除，提交会默默删掉旧文件）
function pathsOf(f: GitFileEntry): string[] {
  return f.origPath ? [f.path, f.origPath] : [f.path]
}

// 侧栏「版本」标签：分支 + 变更 + 提交 + 历史（每条可按需 AI 总结）。
// 变更/提交都作用于当前项目根目录；点变更文件 → diff 开在主区域。
// active=false（侧栏切到「文件」标签）时暂停轮询，切回时立即刷新。
export function SidebarGit({ cwd, active = true }: { cwd: string; active?: boolean }): JSX.Element {
  const t = useT()
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

  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (active) void refresh() // 切回「版本」标签立即刷新
  }, [active, refresh])

  useEffect(() => {
    void refresh()
    // 组件常挂载（display 切换），隐藏时不轮询
    const tick = (): void => {
      if (activeRef.current) void refresh()
    }
    const timer = window.setInterval(tick, POLL_MS)
    window.addEventListener('fs-dir-changed', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('fs-dir-changed', tick)
      window.removeEventListener('focus', tick)
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
      if (!r.ok) showToast(t('git.failWithReason', { fail, reason: r.error ?? t('git.failedGeneric') }))
      await refresh()
    } finally {
      busyRef.current = false
    }
  }

  const stage = (f: GitFileEntry): Promise<void> =>
    run(() => window.api.git.stage(cwd, pathsOf(f)), t('git.stageFailed'))
  const unstage = (f: GitFileEntry): Promise<void> =>
    run(() => window.api.git.unstage(cwd, pathsOf(f)), t('git.unstageFailed'))
  const discard = (f: GitFileEntry): void => {
    requestConfirm({
      message: f.untracked
        ? t('git.discardUntrackedConfirm', { name: splitName(f.path).base })
        : t('git.discardConfirm', { name: splitName(f.path).base }),
      confirmLabel: t('git.discardChanges'),
      onConfirm: () => void run(() => window.api.git.discard(cwd, [f.path], f.untracked), t('git.discardFailed'))
    })
  }

  const files = status?.files ?? []
  const stagedFiles = files.filter((f) => f.staged)
  const changedFiles = files.filter((f) => f.unstaged)

  const stageAll = (): Promise<void> =>
    run(() => window.api.git.stage(cwd, changedFiles.flatMap(pathsOf)), t('git.stageFailed'))

  const doCommit = (): void => {
    void run(async () => {
      const r = await window.api.git.commit(cwd, message)
      if (r.ok) {
        setMessage('')
        showToast(t('git.committed'))
      }
      return r
    }, t('git.commitFailed'))
  }

  const describe = async (hash: string): Promise<void> => {
    if (ai[hash]?.loading) return
    setAi((m) => ({ ...m, [hash]: { loading: true } }))
    const r = await window.api.git.describe(cwd, hash)
    setAi((m) => ({
      ...m,
      [hash]: r.ok ? { text: r.text } : { error: r.error ?? t('git.generateFailed') }
    }))
  }

  if (!cwd) {
    return <div className="git-msg">{t('git.noProject')}</div>
  }
  if (status && !status.isRepo) {
    return <div className="git-msg">{t('git.notRepoProject')}</div>
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
        data-tip={f.path}
        onClick={() => openDiff({ cwd, relPath: f.path, mode })}
      >
        <span className={`git-badge ${info.cls}`}>{info.label}</span>
        <span className="git-file-name">{base}</span>
        <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
          {group === 'changed' ? (
            <>
              <button className="icon-btn" data-tip={t('git.discardChanges')} onClick={() => discard(f)}>
                <UndoIcon size={13} />
              </button>
              <button className="icon-btn" data-tip={t('git.stage')} onClick={() => void stage(f)}>
                <PlusIcon size={14} />
              </button>
            </>
          ) : (
            <button className="icon-btn" data-tip={t('git.unstage')} onClick={() => void unstage(f)}>
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
        <span className="git-branch-name" data-tip={status?.branch ?? ''}>
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
          data-tip={t('git.openGraphTip')}
          onClick={() => openHistory(cwd)}
        >
          <GitBranchIcon size={12} />
          <span>{t('git.branchGraph')}</span>
        </button>
        <button className="icon-btn" data-tip={t('git.refresh')} onClick={() => void refresh()}>
          <RefreshIcon size={13} />
        </button>
      </div>

      <div className="git-commit">
        <input
          className="git-commit-input"
          placeholder={t('git.commitPlaceholder')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doCommit()
          }}
        />
        <button
          className="git-commit-btn"
          data-tip={t('git.commitTip')}
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
              <span>{t('git.stagedChanges')}</span>
              <span className="git-group-count">{stagedFiles.length}</span>
            </div>
            {stagedFiles.map((f) => fileRow(f, 'staged'))}
          </div>
        )}

        <div className="git-group">
          <div className="git-group-head">
            <span>{t('git.changes')}</span>
            <span className="git-group-count">{changedFiles.length}</span>
            {changedFiles.length > 0 && (
              <button className="git-group-action" data-tip={t('git.stageAll')} onClick={() => void stageAll()}>
                <PlusIcon size={13} />
              </button>
            )}
          </div>
          {changedFiles.length === 0 && stagedFiles.length === 0 && (
            <div className="git-empty">{t('git.noChanges')}</div>
          )}
          {changedFiles.map((f) => fileRow(f, 'changed'))}
        </div>

        <div className="git-group">
          <div className="git-group-head">
            <span>{t('git.history')}</span>
          </div>
          {log.length === 0 && <div className="git-empty">{t('git.noCommits')}</div>}
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
                        data-tip={a?.text ? t('git.aiSummarized') : t('git.aiSummarizeTip')}
                        disabled={a?.loading}
                        onClick={() => void describe(c.hash)}
                      >
                        <SparkleIcon size={12} />
                        <span>{a?.loading ? '…' : a?.text ? 'AI' : t('git.aiSummarize')}</span>
                      </button>
                    </div>
                    <div className="git-commit-meta">
                      <ClockIcon size={11} />
                      <span>{relTime(c.at)}</span>
                      <span className="git-commit-dot">·</span>
                      <span>{t('git.filesCount', { n: c.files })}</span>
                      {a?.text && (
                        <span className="git-commit-orig" data-tip={c.subject}>
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
