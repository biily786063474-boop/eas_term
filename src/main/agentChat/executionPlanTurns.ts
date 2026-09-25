/** Main-process-only identity. CLI text, MCP arguments and renderer IPC cannot mint a turn. */
export interface ActivePlanTurn { sessionId: string; turnId: string }
const active = new Map<string, ActivePlanTurn>()

export function beginPlanTurn(sessionId: string, turnId: string): ActivePlanTurn {
  if (!sessionId || !turnId) throw Error('执行清单轮次身份无效')
  const turn = { sessionId, turnId }
  active.set(sessionId, turn)
  return turn
}
export function activePlanTurn(sessionId: string): ActivePlanTurn | null {
  return active.get(sessionId) ?? null
}
export function retirePlanTurn(sessionId: string): void { active.delete(sessionId) }
