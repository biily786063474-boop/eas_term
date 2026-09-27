import React, { useEffect, useRef, useState } from 'react'
import type { PlanCardRef, PlanCardResult, PlanCardSnapshot } from '../../../../shared/agentChat.ts'

export function PlanCardContent({ card, busy, onStop, onDetails, disabled = false }: {
  card: PlanCardSnapshot
  busy: boolean
  onStop(): void
  onDetails(): void
  disabled?: boolean
}): JSX.Element {
  const [compactOpen, setCompactOpen] = useState(false)
  const completed = card.steps.filter(step => step.status === 'reported_done').length
  return <section className={`ac-plan-card${compactOpen ? ' is-compact-open' : ''}`} aria-label="本次任务清单">
    <div className="ac-plan-card-head">
      <button type="button" className="ac-plan-card-collapse" aria-expanded={compactOpen} onClick={() => setCompactOpen(value => !value)}>{completed}/{card.steps.length} · {card.title}</button>
      <span className="ac-plan-card-title" title={card.title}>{card.title}</span>
      <span className="ac-plan-card-count">{completed}/{card.steps.length}</span>
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

export function PlanCard({ ownerRef, busy, refreshKey, hasPlanHint, onDetails, confirmStop }: {
  ownerRef: PlanCardRef
  busy: boolean
  refreshKey: string
  hasPlanHint: boolean
  onDetails(): void
  confirmStop(proceed: () => void): void
}): JSX.Element | null {
  const [result, setResult] = useState<PlanCardResult>({ kind: 'empty' })
  const [error, setError] = useState('')
  const [partial, setPartial] = useState<{ planId: string; error: string } | null>(null)
  const [working, setWorking] = useState(false)
  const actionRef = useRef(false)
  const requestRef = useRef(0)
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
  if (result.kind !== 'active' && !partial && !(error && hasPlanHint)) return null
  return <div className="ac-plan-card-shell">
    {result.kind === 'active' && <PlanCardContent card={result.card} busy={busy} onStop={stop} onDetails={onDetails} disabled={working || !!partial} />}
    {partial && <div className="ac-plan-card-error" role="alert">执行已停止，计划状态未保存。<button type="button" onClick={retry} disabled={working}>仅重试保存</button></div>}
    {error && <div className="ac-plan-card-error" role="alert">{error}<button type="button" onClick={read}>刷新</button></div>}
  </div>
}
