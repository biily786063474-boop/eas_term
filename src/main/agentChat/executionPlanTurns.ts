/** Main-process-only identity. CLI text, MCP arguments and renderer IPC cannot mint a turn. */
export interface ActivePlanTurn { sessionId: string; turnId: string }
export interface PlanReceipt {
  tool: 'plan_create' | 'plan_get' | 'step_update' | 'plan_archive'
  planId: string
  version: number
  steps: { stepId: string; title: string; status: string }[]
  isError?: boolean
}
export type PlanTurnEvent =
  | { k: 'plan.progress'; plan: { planId: string; done: number; total: number; currentTitle: string; version: number } }
  | { k: 'plan.missing'; executed: boolean }
interface TurnFacts extends ActivePlanTurn { executed: boolean; planSeen: boolean; receipts: Set<string> }
const active = new Map<string, TurnFacts>()
let eventSink: (sessionId: string, event: PlanTurnEvent) => void = () => {}

export function setPlanTurnEventSink(sink: (sessionId: string, event: PlanTurnEvent) => void): void { eventSink = sink }
export function publishPlanEvent(sessionId: string, event: PlanTurnEvent): void { eventSink(sessionId, event) }

export function beginPlanTurn(sessionId: string, turnId: string): ActivePlanTurn {
  if (!sessionId || !turnId) throw Error('执行清单轮次身份无效')
  const turn: TurnFacts = { sessionId, turnId, executed: false, planSeen: false, receipts: new Set() }
  active.set(sessionId, turn)
  return { sessionId, turnId }
}
export function ensurePlanTurn(sessionId: string, makeId: () => string): ActivePlanTurn {
  return activePlanTurn(sessionId) ?? beginPlanTurn(sessionId, makeId())
}
export function activePlanTurn(sessionId: string): ActivePlanTurn | null {
  const turn = active.get(sessionId)
  return turn ? { sessionId: turn.sessionId, turnId: turn.turnId } : null
}
export function notePlanExec(sessionId: string, turnId: string, exec: { kind?: string; tool?: string }): void {
  const turn = active.get(sessionId)
  if (turn?.turnId !== turnId) return
  if (exec.kind === 'terminal' || exec.kind === 'edit' || exec.kind === 'integration') turn.executed = true
}
export function notePlanReceipt(sessionId: string, turnId: string, receipt: PlanReceipt): PlanTurnEvent | null {
  const turn = active.get(sessionId)
  if (turn?.turnId !== turnId || receipt.isError || !receipt.planId || !Number.isInteger(receipt.version) || !Array.isArray(receipt.steps)) return null
  const key = `${receipt.tool}:${receipt.planId}:${receipt.version}`
  if (turn.receipts.has(key)) return null
  turn.receipts.add(key)
  turn.planSeen = true
  const done = receipt.steps.filter((step) => step.status === 'reported_done' || step.status === 'accepted').length
  const current = receipt.steps.find((step) => step.status !== 'reported_done' && step.status !== 'accepted') ?? receipt.steps.at(-1)
  return { k: 'plan.progress', plan: { planId: receipt.planId, done, total: receipt.steps.length, currentTitle: current?.title ?? '', version: receipt.version } }
}
export function endPlanTurn(sessionId: string, turnId: string, opts: { interrupted: boolean }): PlanTurnEvent | null {
  const turn = active.get(sessionId)
  if (turn?.turnId !== turnId) return null
  active.delete(sessionId)
  return opts.interrupted || turn.planSeen ? null : { k: 'plan.missing', executed: turn.executed }
}
export function retirePlanTurn(sessionId: string): void { active.delete(sessionId) }
