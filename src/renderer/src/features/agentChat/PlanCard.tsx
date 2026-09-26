import React, { useEffect, useRef, useState } from 'react'
import type { PlanCardRef, PlanCardResult, PlanCardSnapshot } from '../../../../shared/agentChat.ts'

export function PlanCardContent({ card, busy, onAccept, onStop, onDetails, disabled = false }: {
  card: PlanCardSnapshot
  busy: boolean
  onAccept(stepId: string, accepted: boolean): void
  onStop(): void
  onDetails(): void
  disabled?: boolean
}): JSX.Element {
  const [compactOpen, setCompactOpen] = useState(false)
  const accepted = card.steps.filter(step => step.accepted).length
  return <section className={`ac-plan-card${compactOpen ? ' is-compact-open' : ''}`} aria-label="本次任务清单">
    <div className="ac-plan-card-head">
      <button type="button" className="ac-plan-card-collapse" aria-expanded={compactOpen} onClick={() => setCompactOpen(value => !value)}>{accepted}/{card.steps.length} · {card.title}</button>
      <span className="ac-plan-card-title" title={card.title}>{card.title}</span>
      <span className="ac-plan-card-count">{accepted}/{card.steps.length}</span>
    </div>
    <div className="ac-plan-card-body">
      <ul className="ac-plan-card-steps">{card.steps.map(step => {
        const canAccept = step.status === 'reported_done'
        const state = step.accepted ? '已验收' : canAccept ? '待验收' : step.status === 'blocked' ? '受阻' : step.status === 'in_progress' ? '进行中' : '待办'
        return <li key={step.stepId} data-state={step.accepted ? 'accepted' : step.status}>
          {canAccept
            ? <button type="button" className="ac-plan-card-check" aria-label={`${step.accepted ? '撤回验收' : '确认验收'}：${step.title}`} aria-pressed={step.accepted} disabled={disabled} onClick={() => onAccept(step.stepId, !step.accepted)}>{step.accepted ? '✓' : '○'}</button>
            : <span className="ac-plan-card-check" aria-hidden="true">{step.status === 'blocked' ? '!' : '·'}</span>}
          <span className="ac-plan-card-step-title">{step.title}</span><span className="ac-plan-card-step-state">{state}</span>
        </li>
      })}</ul>
      {accepted === card.steps.length && busy && <div className="ac-plan-card-wait" role="status">已全部验收 · 等待当前轮结束</div>}
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
      setResult(next)
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
  const accept = (stepId: string, accepted: boolean): void => {
    if (result.kind !== 'active') return
    act(async () => {
      const next = await window.api.agentChat.planCardAccept({ ...ownerRef, planId: result.card.planId, stepId, accepted, expectedVersion: result.card.version })
      if (next.kind === 'unavailable') setError(next.error ?? '验收失败，请重试')
      else { setError(''); setResult(next) }
    })
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
    {result.kind === 'active' && <PlanCardContent card={result.card} busy={busy} onAccept={accept} onStop={stop} onDetails={onDetails} disabled={working || !!partial} />}
    {partial && <div className="ac-plan-card-error" role="alert">执行已停止，计划状态未保存。<button type="button" onClick={retry} disabled={working}>仅重试保存</button></div>}
    {error && <div className="ac-plan-card-error" role="alert">{error}<button type="button" onClick={read}>刷新</button></div>}
  </div>
}
