import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LivePageState } from '../../../../shared/livePage'
import { collectLeaves } from '../../layout'
import { useStore } from '../../store'
import { useLivePages } from './livePageStore'
import { pickLivePage } from './livePageSelection'
import { reportForLeaf, useReportRevision, type ReportAssociation } from './reportAssociation'
import { hasDualPresentation } from './reportPresentation'
import { ReportPreview } from './ReportPreview'
import './livePage.css'

function PageContent({ state }: { state: LivePageState }): JSX.Element {
  return <div className="live-page-surface">
    {state.frame ? <img src={state.frame} alt="开发页面实时预览" draggable={false} /> : <div className="live-page-wait">{state.error || '等待开发页面画面…'}</div>}
    {state.loading && <div className="live-page-loading"><span />正在加载页面</div>}
    {state.error && state.frame && <div className="live-page-error">{state.error}</div>}
  </div>
}

function PageHeader({ state }: { state: LivePageState }): JSX.Element {
  return <header className="live-page-header">
    <span className="live-page-dot" />
    <div className="live-page-titles"><strong>{state.title || '页面开发'}</strong><small title={state.url}>{state.url || '本地开发服务器'}</small></div>
    <button title="在独立窗口中打开" aria-label="在独立窗口中打开" onClick={() => void window.api.livePage.popout(state.owner)}>↗</button>
    <button title="收起预览" aria-label="收起预览" onClick={() => void window.api.livePage.visible(state.owner, false)}>−</button>
    <button title="结束页面观察" aria-label="结束页面观察" onClick={() => void window.api.livePage.close(state.owner)}>×</button>
  </header>
}

function LivePageBody({ state, report, maximized, onMaximize }: { state: LivePageState; report?: ReportAssociation; maximized: 'live' | 'report' | null; onMaximize: (next: 'live' | 'report' | null) => void }): JSX.Element {
  const [topPercent, setTopPercent] = useState(55)
  const projectPath = useStore(store => {
    const frame = store.canvas.frames.find(item => item.id === report?.frameId)
    return store.projects.find(item => item.id === frame?.projectId)?.path ?? ''
  })
  const dual = hasDualPresentation(state, report)
  const container = useRef<HTMLDivElement>(null)
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dual || maximized) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      const rect = container.current?.getBoundingClientRect()
      if (rect && rect.height > 160) setTopPercent(Math.max(25, Math.min(75, Math.round((move.clientY - rect.top) / rect.height * 100))))
    }
    const done = (): void => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', done) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', done, { once: true })
  }
  return <div ref={container} className={'live-page-deck' + (dual ? ' is-dual' : '') + (maximized ? ' is-max-' + maximized : '')} style={{ '--live-page-top': topPercent + '%' } as React.CSSProperties}>
    <section className="live-page-region live-page-region-dev" aria-label="调试页">
      <div className="live-page-region-bar"><span>调试页</span><button type="button" onClick={() => onMaximize(maximized === 'live' ? null : 'live')} aria-label={maximized === 'live' ? '返回上下分屏' : '最大化调试页'}>{maximized === 'live' ? '返回分屏' : '⛶'}</button></div>
      <PageContent state={state} />
    </section>
    {dual && report && <>
      <div className="live-page-divider" role="separator" aria-label="调整调试页与汇报页高度" aria-orientation="horizontal" tabIndex={0} onPointerDown={resize} onKeyDown={event => { if (event.key === 'ArrowUp') setTopPercent(v => Math.max(25, v - 5)); if (event.key === 'ArrowDown') setTopPercent(v => Math.min(75, v + 5)) }} />
      <section className="live-page-region live-page-region-report" aria-label="汇报页">
        <div className="live-page-region-bar"><span>汇报页</span><button type="button" onClick={() => onMaximize(maximized === 'report' ? null : 'report')} aria-label={maximized === 'report' ? '返回上下分屏' : '最大化汇报页'}>{maximized === 'report' ? '返回分屏' : '⛶'}</button></div>
        <ReportPreview url={report.url} frameId={report.frameId} nodeId={report.nodeId} projectPath={projectPath} />
      </section>
    </>}
  </div>
}

function Reopen({ state }: { state: LivePageState }): JSX.Element {
  return <button className="live-page-reopen" onClick={() => void (state.popout ? window.api.livePage.dock(state.owner) : window.api.livePage.visible(state.owner, true))}>{state.popout ? '返回内嵌预览 ↙' : '打开页面预览 ↗'}</button>
}

export function LivePageSplitDrawer({ active }: { active: boolean }): JSX.Element {
  const states = useLivePages()
  useReportRevision()
  const frames = useStore(store => store.canvas.frames)
  const activeTab = useStore((store) => store.tabs.find((tab) => tab.id === store.activeTabId))
  const activeLeaf = activeTab && collectLeaves(activeTab.root).find((leaf) => leaf.id === activeTab.activeLeafId)
  const viewMode = useStore((store) => store.viewMode)
  const canvasLeafIds = useStore((store) => store.canvas.frames.flatMap((frame) => frame.nodes.map((node) => node.leafId)).filter(Boolean).join('|'))
  const state = pickLivePage(states, activeLeaf?.id, activeLeaf?.pane.kind === 'agent')
  const report = reportForLeaf(state?.leafId, frames)
  const [maximized, setMaximized] = useState<'live' | 'report' | null>(null)
  const open = active && !!state && state.visible && !state.popout
  useEffect(() => setMaximized(null), [state?.owner])
  useEffect(() => { if (!open || (maximized === 'report' && !report)) setMaximized(null) }, [open, maximized, report])
  useEffect(() => {
    if (!maximized) return
    const current = useStore.getState().fullscreenOverlay
    if (current && current !== 'live-page') return
    useStore.getState().setFullscreenOverlay('live-page')
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && useStore.getState().fullscreenOverlay === 'live-page') { event.stopPropagation(); setMaximized(null) } }
    window.addEventListener('keydown', escape, true)
    const offGuestEscape = window.api.livePage.onReportEscape(() => { if (useStore.getState().fullscreenOverlay === 'live-page') setMaximized(null) })
    return () => { offGuestEscape(); window.removeEventListener('keydown', escape, true); if (useStore.getState().fullscreenOverlay === 'live-page') useStore.getState().setFullscreenOverlay(null) }
  }, [maximized])
  useEffect(() => {
    const visibleCanvasLeaves = new Set(canvasLeafIds.split('|'))
    for (const item of states) {
      const shouldDisplay = active ? item.owner === state?.owner : viewMode === 'canvas' && visibleCanvasLeaves.has(item.leafId)
      if (item.visible && !item.popout && !shouldDisplay) {
        void window.api.livePage.visible(item.owner, false)
      }
    }
  }, [active, canvasLeafIds, state?.owner, states, viewMode])
  return <>
    <aside className={'live-page-drawer' + (open ? ' is-open' : '') + (maximized ? ' is-immersive' : '')} aria-hidden={!open}>
      {state && <><PageHeader state={state} />{open && <LivePageBody state={state} report={report} maximized={maximized} onMaximize={setMaximized} />}</>}
    </aside>
    {active && state && !open && <Reopen state={state} />}
  </>
}

export function LivePageChatHost({ leafId, inline, children }: { leafId: string; inline: boolean; children: ReactNode }): JSX.Element {
  const states = useLivePages()
  useReportRevision()
  const frames = useStore(store => store.canvas.frames)
  const state = [...states].reverse().find((item) => item.leafId === leafId)
  const report = reportForLeaf(leafId, frames)
  const [maximized, setMaximized] = useState<'live' | 'report' | null>(null)
  const open = inline && !!state && state.visible && !state.popout
  useEffect(() => setMaximized(null), [state?.owner])
  useEffect(() => { if (!open || (maximized === 'report' && !report)) setMaximized(null) }, [open, maximized, report])
  useEffect(() => {
    if (!maximized) return
    const current = useStore.getState().fullscreenOverlay
    if (current && current !== 'live-page') return
    useStore.getState().setFullscreenOverlay('live-page')
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && useStore.getState().fullscreenOverlay === 'live-page') { event.stopPropagation(); setMaximized(null) } }
    window.addEventListener('keydown', escape, true)
    const offGuestEscape = window.api.livePage.onReportEscape(() => { if (useStore.getState().fullscreenOverlay === 'live-page') setMaximized(null) })
    return () => { offGuestEscape(); window.removeEventListener('keydown', escape, true); if (useStore.getState().fullscreenOverlay === 'live-page') useStore.getState().setFullscreenOverlay(null) }
  }, [maximized])
  const host = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!inline || !host.current) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= 620))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [inline])
  const preview = <aside className={'live-page-inline' + (maximized ? ' is-immersive' : '')} aria-hidden={!open}>
    {state && <><PageHeader state={state} />{open && <LivePageBody state={state} report={report} maximized={maximized} onMaximize={setMaximized} />}</>}
  </aside>
  return <div ref={host} className={'live-page-chat-host' + (open ? ' has-live-page' : '') + (narrow ? ' is-narrow' : '')}>
    <div className="live-page-chat-content">{children}</div>
    {maximized ? createPortal(preview, document.body) : preview}
    {inline && state && !open && <Reopen state={state} />}
  </div>
}
