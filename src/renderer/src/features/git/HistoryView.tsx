import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitCommit, GitCommitFile } from '../../../../shared/types'
import { computeGraphRows, parseRefs, type GraphSegment } from './gitGraph'
import { statusInfo } from './gitUi'
import { DiffView } from '../editor/DiffView'
import { RefreshIcon, GitBranchIcon } from '../../ui/Icons'
import { CanvasContextMenu } from '../../ui/CanvasContextMenu'
import { useStore } from '../../store'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { useT, t as tNow } from '../../i18n.ts'

const ROW_H = 30 // 提交表行高（固定，保证轨道图与各列对齐）
const LANE_W = 18 // 主视图轨道列宽
const MAX_LANES = 12
const LOG_LIMIT = 200
const LOAD_MORE_LIMIT = 50

function fmtShort(sec: number): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return tNow('git.dateShort', { m: d.getMonth() + 1, d: d.getDate() })
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
  const t = useT()
  const [log, setLog] = useState<GitCommit[]>([])
  const [branch, setBranch] = useState<string>('')
  const [isRepo, setIsRepo] = useState<boolean>(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<GitCommitFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [topRatio, setTopRatio] = useState(0.58)
  const [error, setError] = useState('')
  const [compareBase, setCompareBase] = useState<string | undefined>()
  const [comparePick, setComparePick] = useState<string | null>(null)
  const [returnBranch, setReturnBranch] = useState('')
  const [operation, setOperation] = useState<{ action: 'checkout' | 'branch' | 'tag' | 'switch'; target: string } | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; hash: string; subject: string } | null>(
    null
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef({ generation: 0, loading: false, count: 0, hasMore: false })
  const requestConfirm = useStore((s) => s.requestConfirm)
  const begin = (action: 'checkout' | 'branch' | 'tag' | 'switch', target: string): void => {
    setName(''); setError(''); setOperation({ action, target })
  }
  const execute = async (): Promise<void> => {
    if (!operation || busy) return
    setBusy(true); setError('')
    try {
      const result = await window.api.git.historyAction(cwd, operation.action, operation.target, name)
      if (!result.ok) { setError(result.error ?? t('git.opFailed')); return }
      if (operation.action === 'checkout' && branch && branch !== '(detached)') setReturnBranch(branch)
      if (operation.action === 'switch') setReturnBranch('')
      setOperation(null); setCompareBase(undefined); setRevision(v => v + 1)
      await refresh()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const copy = (text: string): void => { void navigator.clipboard.writeText(text).catch(e => setError(String(e))) }

  useEffect(() => {
    setSelected(null); setCompareBase(undefined); setComparePick(null); setReturnBranch(''); setOperation(null); setError('')
  }, [cwd])

  // 右键「回退到该版本」→ 弹确认 → git reset --hard 到该提交（破坏性，故先确认），成功后刷新历史
  const askReset = (hash: string, subject: string): void => {
    requestConfirm({
      message: t('git.askReset', { subject, hash: hash.slice(0, 8) }),
      confirmLabel: t('git.resetToVersion'),
      onConfirm: () => {
        void window.api.git.resetHard(cwd, hash).then((r) => {
          if (r.ok) void refresh()
          else setError(r.error ?? t('git.resetFailed'))
        })
      }
    })
  }

  const refresh = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const generation = ++pageRef.current.generation
    pageRef.current.loading = false
    pageRef.current.hasMore = false
    setHasMore(false)
    setLoadingMore(false)
    const st = await window.api.git.status(cwd)
    if (generation !== pageRef.current.generation) return
    setIsRepo(st.isRepo)
    setBranch(st.branch ?? '')
    if (st.isRepo) {
      const commits = await window.api.git.log(cwd, LOG_LIMIT)
      if (generation !== pageRef.current.generation) return
      pageRef.current.count = commits.length
      pageRef.current.hasMore = commits.length === LOG_LIMIT
      setLog(commits)
      setHasMore(pageRef.current.hasMore)
    } else {
      pageRef.current.count = 0
      pageRef.current.hasMore = false
      setLog([])
      setHasMore(false)
    }
  }, [cwd])

  const loadMore = useCallback(async (): Promise<void> => {
    const page = pageRef.current
    if (!cwd || page.loading || !page.hasMore) return
    page.loading = true
    const generation = page.generation
    const skip = page.count
    setLoadingMore(true)
    try {
      const commits = await window.api.git.log(cwd, LOAD_MORE_LIMIT, skip)
      if (generation !== pageRef.current.generation) return
      pageRef.current.count += commits.length
      pageRef.current.hasMore = commits.length === LOAD_MORE_LIMIT
      setHasMore(pageRef.current.hasMore)
      setLog((previous) => [...previous, ...commits])
    } catch (e) {
      if (generation === pageRef.current.generation) setError(t('git.loadMoreFailed', { err: String(e) }))
    } finally {
      if (generation === pageRef.current.generation) {
        pageRef.current.loading = false
        setLoadingMore(false)
      }
    }
  }, [cwd])

  const onHistoryScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const list = event.currentTarget
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 120) void loadMore()
  }

  useEffect(() => {
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      pageRef.current.generation++
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  // 选中提交 → 拉它的改动文件，默认选第一个
  useEffect(() => {
    if (!selected) {
      setFiles([])
      setActiveFile(null)
      return
    }
    let cancelled = false
    setFiles([]); setActiveFile(null)
    void window.api.git.historyFiles(cwd, selected, compareBase).then((result) => {
      if (cancelled) return
      if (!result.ok) { setError(result.error ?? t('git.readDiffFailed')); return }
      const fs = result.files
      setFiles(fs)
      setActiveFile(fs[0]?.path ?? null)
    }).catch(e => { if (!cancelled) setError(String(e)) })
    return () => {
      cancelled = true
    }
  }, [selected, cwd, compareBase, revision])

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
        <div>{t('git.history')}</div>
        <div className="pane-placeholder-hint">{t('git.notRepoDir')}</div>
      </div>
    )
  }

  const maxLanes = Math.min(rows.reduce((m, r) => Math.max(m, r.laneCount), 1), MAX_LANES)
  const gutterW = maxLanes * LANE_W
  const cx = (l: number): number => Math.min(l, maxLanes - 1) * LANE_W + LANE_W / 2

  const sel = log.find((c) => c.hash === selected) ?? null

  return (
    <div className="history-view" ref={wrapRef}>
      {error && <div className="history-feedback" role="alert">{error}<button onClick={() => setError('')}>{t('git.close')}</button></div>}
      {returnBranch && <div className="history-feedback">{t('git.returnBranchHint')}<button disabled={busy} onClick={() => begin('switch', returnBranch)}>{t('git.returnTo', { branch: returnBranch })}</button></div>}
      {comparePick && <div className="history-feedback">{t('git.comparePicked', { hash: comparePick.slice(0, 8) })}<button onClick={() => setComparePick(null)}>{t('git.cancel')}</button></div>}
      <div className="history-top" style={{ height: `${topRatio * 100}%` }}>
        <div className="history-head">
          <GitBranchIcon size={13} />
          <span className="history-branch">{branch || (log.length ? t('git.detachedHead') : t('git.history'))}</span>
          <span className="history-count">{t('git.commitsCount', { n: log.length })}</span>
          <span className="pane-spacer" />
          <button className="icon-btn" data-tip={t('git.refresh')} onClick={() => void refresh()}>
            <RefreshIcon size={13} />
          </button>
        </div>
        <div className="history-cols" style={{ paddingLeft: gutterW + 12 }}>
          <span className="hc-desc">{t('git.colDesc')}</span>
          <span className="hc-author">{t('git.colAuthor')}</span>
          <span className="hc-date">{t('git.colDate')}</span>
        </div>
        <div className="history-rows" onScroll={onHistoryScroll}>
          {rows.map((row) => {
            const c = row.commit
            const refs = parseRefs(c.refs)
            return (
              <div
                key={c.hash}
                className={`history-row${selected === c.hash ? ' active' : ''}`}
                style={{ height: ROW_H }}
                onClick={() => { setSelected(c.hash); setCompareBase(undefined) }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation() // 别冒泡到画布节点的右键菜单（复制/删除节点）
                  setSelected(c.hash)
                  setCompareBase(undefined)
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
          {rows.length === 0 && <div className="git-empty">{t('git.noCommits')}</div>}
          {loadingMore && <div className="history-load-status">{t('git.loadingMore')}</div>}
          {!hasMore && rows.length > 0 && <div className="history-load-status">{t('git.allShown')}</div>}
        </div>
      </div>

      <div className="history-divider" onMouseDown={startDrag} />

      <div className="history-bottom">
        {sel ? (
          <>
            <div className="history-detail-head">
              {compareBase && <button onClick={() => setCompareBase(undefined)}>{t('git.exitCompare', { hash: compareBase.slice(0, 8) })}</button>}
              <span className="history-detail-hash">{sel.hash.slice(0, 8)}</span>
              <span className="history-detail-subject">{sel.subject}</span>
              <span className="history-detail-meta">
                {sel.author} · {fmtFull(sel.at)}
              </span>
            </div>
            <div className="history-detail">
              <div className="history-files">
                <div className="git-group-head">
                  <span>{t('git.changedFiles')}</span>
                  <span className="git-group-count">{files.length}</span>
                </div>
                {files.map((f) => {
                  const base = f.path.split('/').pop() ?? f.path
                  return (
                    <div
                      key={f.path}
                      className={`git-row${activeFile === f.path ? ' active' : ''}`}
                      data-tip={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                      onClick={() => setActiveFile(f.path)}
                    >
                      <span className={`git-badge ${statusInfo(f.status).cls}`}>{f.status}</span>
                      <span className={`git-file-name history-status-${f.status}`}>{f.origPath ? `${f.origPath} → ${f.path}` : base}</span>
                      <span className="history-numstat">{f.added === null ? t('git.binary') : <><span className="history-status-A">{f.added !== undefined ? `+${f.added}` : ''}</span> <span className="history-status-D">{f.deleted !== undefined ? `−${f.deleted}` : ''}</span></>}</span>
                    </div>
                  )
                })}
                {files.length === 0 && <div className="git-empty">{t('git.noFileDiff')}</div>}
              </div>
              <div className="history-filediff">
                {activeFile ? (
                  <DiffView key={`${sel.hash}:${activeFile}:${compareBase}:${revision}`} cwd={cwd} relPath={activeFile} commit={sel.hash} base={compareBase} origPath={files.find(f => f.path === activeFile)?.origPath} />
                ) : (
                  <div className="git-diff-hint">{t('git.pickFileHint')}</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="git-diff-hint">{t('git.pickCommitHint')}</div>
        )}
      </div>
      {menu && (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: t('git.menuCheckout'), hint: 'Checkout', disabled: busy, onClick: () => begin('checkout', menu.hash) },
            { label: t('git.menuBranch'), disabled: busy, onClick: () => begin('branch', menu.hash) },
            { label: t('git.menuCompareHead'), onClick: () => { setSelected(menu.hash); setCompareBase(log.find(c => /(^|, )HEAD(?: ->|,|$)/.test(c.refs))?.hash ?? 'HEAD') } },
            { label: comparePick ? t('git.menuCompareWith', { hash: comparePick.slice(0, 8) }) : t('git.menuPickCompare'), onClick: () => {
              if (comparePick) { setSelected(menu.hash); setCompareBase(comparePick); setComparePick(null) }
              else setComparePick(menu.hash)
            } },
            { label: t('git.menuAddTag'), disabled: busy, onClick: () => begin('tag', menu.hash) },
            { label: t('git.menuCopyHash'), onClick: () => copy(menu.hash) },
            { label: t('git.menuCopySubject'), onClick: () => copy(menu.subject) },
            {
              label: t('git.resetToVersion'),
              danger: true,
              onClick: () => askReset(menu.hash, menu.subject)
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {operation && <div className="history-action-veil"><form className="history-action" role="dialog" aria-modal="true" aria-label={t('git.confirmOpAria')} onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); if (!busy) setOperation(null) }
        if (e.key === 'Tab') {
          const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')]
          if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1)?.focus() }
          if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus() }
        }
      }} onSubmit={e => { e.preventDefault(); void execute() }}>
        <h3>{({ checkout: t('git.opTitleCheckout'), branch: t('git.opTitleBranch'), tag: t('git.opTitleTag'), switch: t('git.opTitleSwitch') })[operation.action]}</h3>
        <code>{operation.target}</code>
        {operation.action === 'checkout' && <p>{t('git.checkoutNote')}</p>}
        {operation.action !== 'tag' && <p>{t('git.dirtyNote')}</p>}
        {(operation.action === 'branch' || operation.action === 'tag') && <label>{t('git.nameLabel')}<input autoFocus value={name} disabled={busy} required onChange={e => setName(e.target.value)} /></label>}
        {error && <p role="alert" className="history-status-D">{error}</p>}
        <div className="history-action-buttons"><button autoFocus={operation.action === 'checkout' || operation.action === 'switch'} type="button" disabled={busy} onClick={() => setOperation(null)}>{t('git.cancel')}</button><button disabled={busy}>{busy ? t('git.running') : t('git.confirm')}</button></div>
      </form></div>}
    </div>
  )
}

/** 版本管理崩溃时的兜底：只掉这一个模块，终端和画布照常。复用 .pane-placeholder 的排版 */
function HistoryCrash({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  const t = useT()
  return (
    <div className="pane-placeholder">
      <div>{t('git.crashTitle')}</div>
      <div className="pane-placeholder-hint">
        {t('git.crashHint')}
      </div>
      <div className="pane-placeholder-hint">{error.message || String(error)}</div>
      <div className="err-btns">
        <button className="err-btn" onClick={reset}>
          {t('git.retry')}
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
