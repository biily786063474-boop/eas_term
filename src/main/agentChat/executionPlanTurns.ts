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
// continuation：CLI 自己续上的一轮（后台任务在上一轮结束后才跑完，Claude 收到通知自己接着说）。
//   它也要有轮次，否则这一轮里清单工具一律报「缺少有效项目或轮次」（2026-09-30 用户反馈「时好时坏」的根因）；
//   但清单通常在用户那一轮已经建了，续轮结束不发「本轮没有建清单」。用户在续轮进行中发消息 = 这一轮归用户，标记清掉。
interface TurnFacts extends ActivePlanTurn { executed: boolean; planSeen: boolean; continuation: boolean; receipts: Set<string> }
const active = new Map<string, TurnFacts>()
let eventSink: (sessionId: string, event: PlanTurnEvent) => void = () => {}

export function setPlanTurnEventSink(sink: (sessionId: string, event: PlanTurnEvent) => void): void { eventSink = sink }
export function publishPlanEvent(sessionId: string, event: PlanTurnEvent): void { eventSink(sessionId, event) }

export function beginPlanTurn(sessionId: string, turnId: string, opts: { continuation?: boolean } = {}): ActivePlanTurn {
  if (!sessionId || !turnId) throw Error('执行清单轮次身份无效')
  const turn: TurnFacts = { sessionId, turnId, executed: false, planSeen: false, continuation: opts.continuation === true, receipts: new Set() }
  active.set(sessionId, turn)
  return { sessionId, turnId }
}
export function ensurePlanTurn(sessionId: string, makeId: () => string, opts: { continuation?: boolean } = {}): ActivePlanTurn {
  const turn = active.get(sessionId)
  if (!turn) return beginPlanTurn(sessionId, makeId(), opts)
  // 用户发送路径拿到的是 CLI 续上的那一轮：这一轮归用户了，结束时照常判断有没有建清单
  if (!opts.continuation) turn.continuation = false
  return { sessionId: turn.sessionId, turnId: turn.turnId }
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
  return opts.interrupted || turn.planSeen || turn.continuation ? null : { k: 'plan.missing', executed: turn.executed }
}
export function retirePlanTurn(sessionId: string): void { active.delete(sessionId) }
