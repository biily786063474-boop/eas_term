import type { PlanCardAcceptInput, PlanCardRef, PlanCardResult, PlanCardSnapshot } from '../shared/agentChat.ts'

export interface CardInput extends PlanCardRef { senderId: number }
export interface CardDeps {
  resolve(input: CardInput): { root: string; ownerKey: string }
  request(method: string, owner: { root: string; ownerKey: string }, args?: Record<string, unknown>): Promise<unknown>
}

function snapshot(raw: unknown): PlanCardSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const card = raw as PlanCardSnapshot
  if (card.status !== 'active' || typeof card.planId !== 'string' || typeof card.title !== 'string' || !Number.isSafeInteger(card.version) || !Array.isArray(card.steps)) return null
  if (card.steps.some(step => typeof step.stepId !== 'string' || typeof step.title !== 'string' || !['pending', 'in_progress', 'blocked', 'reported_done'].includes(step.status) || typeof step.accepted !== 'boolean')) return null
  return { planId: card.planId, title: card.title, status: 'active', version: card.version,
    steps: card.steps.map(({ stepId, title, status, accepted }) => ({ stepId, title, status, accepted })) }
}
function unavailable(error: unknown): PlanCardResult { return { kind: 'unavailable', error: error instanceof Error ? error.message : String(error) } }

export async function cardRead(input: CardInput, deps: CardDeps): Promise<PlanCardResult> {
  try {
    const owner = deps.resolve(input)
    const raw = await deps.request('host/card-read', owner)
    if (raw === null) return { kind: 'empty' }
    const card = snapshot(raw)
    if (!card) throw Error('执行清单卡片数据无效')
    return { kind: 'active', card }
  } catch (error) { return unavailable(error) }
}

export async function cardAccept(input: CardInput & PlanCardAcceptInput, deps: CardDeps): Promise<PlanCardResult> {
  try {
    if (!input.planId || !input.stepId || typeof input.accepted !== 'boolean' || !Number.isSafeInteger(input.expectedVersion)) throw Error('验收参数无效')
    const owner = deps.resolve(input)
    const latest = snapshot(await deps.request('host/card-read', owner))
    if (!latest || latest.planId !== input.planId) throw Error('计划不属于当前对话')
    if (latest.version !== input.expectedVersion) throw Error('计划版本已变化，请刷新')
    await deps.request('host/card-accept', owner, { planId: input.planId, stepId: input.stepId, accepted: input.accepted, expectedVersion: input.expectedVersion, completeNow: false })
    return cardRead(input, deps)
  } catch (error) { return unavailable(error) }
}
