export type StopPlanResult =
  | { kind: 'terminated' }
  | { kind: 'stopped-unpersisted'; error: string }
  | { kind: 'stop-unconfirmed'; error: string }
  | { kind: 'unavailable'; error: string }

/** No terminal state is written until target turn cancellation is confirmed. */
export async function stopPlanFlow(input: { planId: string; expectedVersion: number }, deps: {
  stop(): Promise<boolean>
  write(input: { planId: string; expectedVersion: number }): Promise<unknown>
}): Promise<StopPlanResult> {
  let confirmed: boolean
  try { confirmed = await deps.stop() }
  catch (error) { return { kind: 'stop-unconfirmed', error: String(error) } }
  if (!confirmed) return { kind: 'stop-unconfirmed', error: 'AI 停止状态未确认，计划尚未终止' }
  try { await deps.write(input); return { kind: 'terminated' } }
  catch (error) { return { kind: 'stopped-unpersisted', error: String(error) } }
}

/** Completion is conservative: busy / stale / newly appended steps keep the card visible. */
export async function completeAcceptedPlan(planId: string, deps: {
  idle(): boolean
  read(): Promise<{ planId: string; version: number; steps: { accepted: boolean }[] } | null>
  write(input: { planId: string; expectedVersion: number }): Promise<unknown>
}): Promise<boolean> {
  if (!deps.idle()) return false
  const card = await deps.read()
  if (!card || card.planId !== planId || !card.steps.length || !card.steps.every(step => step.accepted) || !deps.idle()) return false
  await deps.write({ planId, expectedVersion: card.version })
  return true
}
