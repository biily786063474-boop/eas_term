import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlanCardRef, PlanCardResult, PlanCardSnapshot } from '../../../../shared/agentChat.ts'
import { planDockPlacement, planDockZ, type PlanDockPlacement } from './planDockPlacement.ts'

export function PlanTaskRings({ card, busy }: { card: PlanCardSnapshot; busy: boolean }): JSX.Element {
  return <>{card.steps.map(step => {
    const state = step.status
    const label = step.status === 'reported_done' ? '已完成' : step.status === 'blocked' ? '受阻' : step.status === 'in_progress' ? (busy ? '执行中' : '等待继续') : '待办'
    return <span key={step.stepId} className={`ac-plan-task-ring is-${state}${step.status === 'in_progress' && busy ? ' is-spinning' : ''}`} role="img" aria-label={`${step.title}：${label}`} title={`${step.title}：${label}`} />
  })}</>
}

export function PlanCardContent({ card, busy, onStop, onDetails, onCollapse, disabled = false }: {
  card: PlanCardSnapshot
  busy: boolean
  onStop(): void
  onDetails(): void
  onCollapse?(): void
  disabled?: boolean
}): JSX.Element {
  const [compactOpen, setCompactOpen] = useState(false)
  const completed = card.steps.filter(step => step.status === 'reported_done').length
  return <section className={`ac-plan-card${compactOpen ? ' is-compact-open' : ''}`} aria-label="本次任务清单">
    <div className="ac-plan-card-head">
      <button type="button" className="ac-plan-card-collapse" aria-expanded={compactOpen} onClick={() => setCompactOpen(value => !value)}>{completed}/{card.steps.length} · {card.title}</button>
      <span className="ac-plan-card-title" title={card.title}>{card.title}</span>
      <span className="ac-plan-card-count">{completed}/{card.steps.length}</span>
      {onCollapse && <button type="button" className="ac-plan-dock-toggle" aria-label="收起执行清单" title="收起执行清单" onClick={onCollapse}>‹</button>}
    </div>
    <div className="ac-plan-card-body">
      <ul className="ac-plan-card-steps">{card.steps.map(step => {
        const done = step.status === 'reported_done'
        const state = done ? '已完成' : step.status === 'blocked' ? '受阻' : step.status === 'in_progress' ? '进行中' : '待办'
        return <li key={step.stepId} data-state={done ? 'accepted' : step.status}>
          <span className="ac-plan-card-check" aria-hidden="true">{done ? '✓' : step.status === 'blocked' ? '!' : '·'}</span>
          <span className="ac-plan-card-step-title">{step.title}</span><span className="ac-plan-card-step-state">{state}</span>
        </li>
      })}</ul>
      {completed === card.steps.length && busy && <div className="ac-plan-card-wait" role="status">已全部完成 · 等待当前轮结束</div>}
      <div className="ac-plan-card-actions"><button type="button" onClick={onDetails}>查看详情</button><button type="button" onClick={onStop} disabled={disabled}>终止本次任务</button></div>
    </div>
  </section>
}

export function PlanCard({ ownerRef, busy, refreshKey, hasPlanHint, onDetails, confirmStop, docked = false }: {
  ownerRef: PlanCardRef
  busy: boolean
  refreshKey: string
  hasPlanHint: boolean
  onDetails(): void
  confirmStop(proceed: () => void): void
  docked?: boolean
}): JSX.Element | null {
  const [result, setResult] = useState<PlanCardResult>({ kind: 'empty' })
  const [error, setError] = useState('')
  const [partial, setPartial] = useState<{ planId: string; error: string } | null>(null)
  const [working, setWorking] = useState(false)
  const actionRef = useRef(false)
  const requestRef = useRef(0)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [tightOpen, setTightOpen] = useState(false)
  const hovered = useRef(false)
  const focused = useRef(false)
  const introUntil = useRef(0)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLButtonElement>(null)
  const restoringFocus = useRef(false)
  const returnFocus = useRef(false)
  const planId = result.kind === 'active' ? result.card.planId : null
  const cancelLeave = (): void => { if (leaveTimer.current) clearTimeout(leaveTimer.current) }
  const collapse = (): void => { returnFocus.current = !!dockRef.current?.contains(document.activeElement); setCollapsed(true); setTightOpen(false) }
  const expand = (): void => { cancelLeave(); setCollapsed(false); setTightOpen(true) }
  const deferCollapse = (): void => {
    cancelLeave()
    leaveTimer.current = setTimeout(() => {
      if (!hovered.current && !focused.current) collapse()
    }, Math.max(240, introUntil.current - Date.now()))
  }
  useEffect(() => {
    if (!docked || !planId) return
    // Keyed by plan identity, not version: step updates must not restart the preview.
    introUntil.current = Date.now() + 3000
    setCollapsed(false)
    setTightOpen(true)
    const timer = setTimeout(() => {
      if (!hovered.current && !focused.current) collapse()
    }, 3000)
    return () => { clearTimeout(timer); cancelLeave() }
  }, [docked, planId])
  const [placement, setPlacement] = useState<(PlanDockPlacement & { zIndex: number }) | null>(null)
  const read = (): void => {
    const request = ++requestRef.current
    void window.api.agentChat.planCardRead(ownerRef).then(next => {
      if (request !== requestRef.current) return
      // A disabled/replaced plugin is an error, not evidence that the task vanished.
      if (next.kind !== 'unavailable') setResult(next)
      if (next.kind !== 'unavailable') setError('')
      else setError(next.error ?? '执行清单暂不可用')
    }).catch(cause => { if (request === requestRef.current) setError(String(cause)) })
  }
  useEffect(() => { read(); return () => { requestRef.current++ } }, [ownerRef.nodeId, ownerRef.sessionId, refreshKey])
  const act = (fn: () => Promise<void>): void => {
    if (actionRef.current) return
    actionRef.current = true
    setWorking(true)
    void fn().catch(cause => setError(String(cause))).finally(() => { actionRef.current = false; setWorking(false) })
  }
  const stop = (): void => {
    if (result.kind !== 'active') return
    confirmStop(() => act(async () => {
      const next = await window.api.agentChat.planCardStop({ ...ownerRef, planId: result.card.planId, expectedVersion: result.card.version })
      if (next.kind === 'terminated') { setPartial(null); setResult({ kind: 'empty' }); setError('') }
      else if (next.kind === 'stopped-unpersisted') { setPartial({ planId: result.card.planId, error: next.error }); setError('') }
      else setError(next.error)
    }))
  }
  const retry = (): void => {
    if (!partial) return
    act(async () => {
      const next = await window.api.agentChat.planCardRetryTermination({ ...ownerRef, planId: partial.planId })
      if (next.kind === 'terminated') { setPartial(null); setResult({ kind: 'empty' }); setError('') }
      else setError(next.error)
    })
  }
  const visible = result.kind === 'active' || !!partial || !!(error && hasPlanHint)
  useLayoutEffect(() => {
    if (!docked || !visible) { setPlacement(null); return }
    const pane = anchorRef.current?.closest<HTMLElement>('.pane')
    const layer = pane?.closest<HTMLElement>('.pane-layer')
    if (!pane || !layer) return
    let raf = 0
    let signature = ''
    const measure = (): void => {
      raf = 0
      const isMax = getComputedStyle(pane).zIndex === '200'
      if (getComputedStyle(pane).display === 'none' || getComputedStyle(pane).visibility === 'hidden') {
        if (dockRef.current) dockRef.current.style.visibility = 'hidden'
        if (signature !== 'hidden') { signature = 'hidden'; setPlacement(null) }
        return
      }
      const r = pane.getBoundingClientRect()
      const l = layer.getBoundingClientRect()
      const bounds = { left: Math.max(0, l.left), top: Math.max(0, l.top), right: Math.min(innerWidth, l.right), bottom: Math.min(innerHeight, l.bottom) }
      const scale = isMax ? 1 : r.width / pane.offsetWidth
      const next = planDockPlacement(r, bounds, collapsed, tightOpen, scale, isMax)
      const positioned = next && { ...next, zIndex: planDockZ(isMax) }
      // Apply geometry before paint, not one RAF + React render behind the pane.
      if (dockRef.current) {
        dockRef.current.style.visibility = positioned ? '' : 'hidden'
        if (positioned) {
          Object.assign(dockRef.current.style, { left: `${positioned.left}px`, top: `${positioned.top}px`,
            width: `${positioned.width}px`, transform: `scale(${positioned.scale})` })
          if (detailRef.current) detailRef.current.style.maxHeight = `${positioned.maxHeight}px`
        }
      }
      const key = JSON.stringify(positioned)
      if (key !== signature) { signature = key; setPlacement(positioned) }
      if (pane.getAnimations().some(animation => animation.playState === 'running')) raf = requestAnimationFrame(measure)
    }
    const schedule = (): void => { cancelAnimationFrame(raf); measure() }
    const resize = new ResizeObserver(schedule)
    resize.observe(pane)
    resize.observe(layer)
    const geometry = new MutationObserver(schedule)
    for (let element: HTMLElement | null = pane; element && element !== document.body; element = element.parentElement)
      geometry.observe(element, { attributes: true, attributeFilter: ['style', 'class'] })
    measure()
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    return () => { cancelAnimationFrame(raf); resize.disconnect(); geometry.disconnect(); window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true) }
  }, [docked, visible, collapsed, tightOpen, ownerRef.nodeId, ownerRef.sessionId])
  useEffect(() => {
    if (!tightOpen) return
    const close = (event: MouseEvent): void => { if (!dockRef.current?.contains(event.target as Node)) setTightOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [tightOpen])
  const compact = result.kind === 'active' && placement?.compact
  useEffect(() => {
    if (compact) detailRef.current?.setAttribute('inert', '')
    else detailRef.current?.removeAttribute('inert')
    if (compact && returnFocus.current) {
      returnFocus.current = false
      restoringFocus.current = true
      markerRef.current?.focus({ preventScroll: true })
      restoringFocus.current = false
    } else if (!compact && document.activeElement === markerRef.current) {
      detailRef.current?.querySelector<HTMLButtonElement>('.ac-plan-dock-toggle')?.focus({ preventScroll: true })
    }
  }, [compact])
  if (!visible) return null
  const content = <div ref={dockRef}
    onMouseEnter={docked ? () => { hovered.current = true; expand() } : undefined}
    onMouseLeave={docked ? () => { hovered.current = false; deferCollapse() } : undefined}
    onFocusCapture={docked ? () => { focused.current = true; if (!restoringFocus.current) expand() } : undefined}
    onBlurCapture={docked ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { focused.current = false; deferCollapse() } } : undefined}
    onKeyDown={docked ? event => { if (event.key === 'Escape') { event.stopPropagation(); introUntil.current = 0; collapse() } } : undefined} className={`ac-plan-card-shell${docked ? ' ac-plan-dock' : ''}${compact ? ' is-collapsed' : ''}`}
    style={docked && placement ? { left: placement.left, top: placement.top, width: placement.width, zIndex: placement.zIndex, transform: `scale(${placement.scale})`, transformOrigin: 'top left' } : undefined}>
    {result.kind === 'active' && docked && <button type="button" ref={markerRef} tabIndex={compact ? 0 : -1} className="ac-plan-dock-marker"
      aria-label={`展开执行清单，共 ${result.card.steps.length} 个任务`} aria-expanded={!compact}
      onClick={expand}><PlanTaskRings card={result.card} busy={busy} /></button>}
    <div ref={detailRef} className={docked ? 'ac-plan-dock-detail' : undefined} style={docked && placement ? { maxHeight: placement.maxHeight, overflowY: 'auto' } : undefined} aria-hidden={compact || undefined}>
    {result.kind === 'active' && <PlanCardContent card={result.card} busy={busy} onStop={stop} onDetails={onDetails}
      onCollapse={docked ? () => { introUntil.current = 0; collapse() } : undefined} disabled={working || !!partial} />}
    {!compact && partial && <div className="ac-plan-card-error" role="alert">执行已停止，计划状态未保存。<button type="button" onClick={retry} disabled={working}>仅重试保存</button></div>}
    {!compact && error && <div className="ac-plan-card-error" role="alert">{error}<button type="button" onClick={read}>刷新</button></div>}
    </div>
  </div>
  if (!docked) return content
  return <><span ref={anchorRef} className="ac-plan-dock-anchor" aria-hidden="true" />{placement && createPortal(content, document.body)}</>
}
