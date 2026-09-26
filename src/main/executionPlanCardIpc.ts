import { app } from 'electron'
import { guardedHandle } from './ipcGuard.ts'
import { resolveNodePlanOwner, resolvePlanOwner } from './executionPlanOwner.ts'
import { confirmedPlanInterrupt, planCardNodeBusy, planCardSession, planCardSessionForHost, setPlanIdleSink } from './agentChat/session.ts'
import { completeAcceptedPlan, stopPlanFlow } from './agentChat/executionPlanStop.ts'
import { requestExecutionPlanCard } from './pluginHost.ts'
import { cardAccept, cardRead, type CardInput } from './executionPlanCardHost.ts'
import type { PlanCardAcceptInput, PlanCardStopInput, PlanCardStopResult, PlanCardResult } from '../shared/agentChat.ts'

function resolve(input: CardInput): { root: string; ownerKey: string } {
  if (input.sessionId) {
    const session = planCardSession(input.sessionId, input.senderId)
    if (!session) throw Error('会话不属于当前窗口')
    if (input.nodeId && session.agentNodeId !== input.nodeId) throw Error('对话节点与会话不匹配')
    return resolvePlanOwner({ userData: app.getPath('userData'), cwd: session.cwd, sessionId: input.sessionId, agentNodeId: session.agentNodeId, agentLeafId: session.agentLeafId })
  }
  if (!input.nodeId) throw Error('缺少对话节点归属')
  return resolveNodePlanOwner(app.getPath('userData'), input.nodeId)
}
function isBusy(input: CardInput): boolean {
  if (input.sessionId) {
    const session = planCardSession(input.sessionId, input.senderId)
    if (!session) throw Error('会话不属于当前窗口')
    return session.busy
  }
  return input.nodeId ? planCardNodeBusy(input.nodeId, input.senderId) : false
}
const deps = { resolve, request: requestExecutionPlanCard, isBusy }
const stoppedButUnpersisted = new Map<string, number>()
const stoppingSessions = new Set<string>()
const stopKey = (senderId: number, ownerKey: string, planId: string): string => `${senderId}:${ownerKey}:${planId}`

async function readWithCompletion(input: CardInput): Promise<PlanCardResult> {
  const result = await cardRead(input, deps)
  if (input.sessionId && stoppingSessions.has(input.sessionId)) return result
  if (result.kind !== 'active' || !result.card.steps.every(step => step.accepted) || isBusy(input)) return result
  try {
    const owner = resolve(input)
    await completeAcceptedPlan(result.card.planId, {
      idle: () => !isBusy(input),
      read: async () => await requestExecutionPlanCard('host/card-read', owner) as typeof result.card | null,
      write: async args => requestExecutionPlanCard('host/card-complete', owner, args)
    })
    return cardRead(input, deps)
  } catch { return cardRead(input, deps) } // CAS race: newest active card must remain visible.
}

async function stop(input: CardInput & PlanCardStopInput): Promise<PlanCardStopResult> {
  try {
    const owner = resolve(input)
    const current = await cardRead(input, deps)
    if (current.kind !== 'active' || current.card.planId !== input.planId || current.card.version !== input.expectedVersion) throw Error('计划已变化，请刷新后重试')
    if (!input.sessionId && isBusy(input)) throw Error('此对话仍在运行，请从当前会话终止')
    if (input.sessionId) stoppingSessions.add(input.sessionId)
    const result = await stopPlanFlow({ planId: input.planId, expectedVersion: input.expectedVersion }, {
      stop: () => input.sessionId ? confirmedPlanInterrupt(input.sessionId, input.senderId) : Promise.resolve(true),
      write: args => requestExecutionPlanCard('host/card-terminate', owner, args)
    })
    if (result.kind === 'stopped-unpersisted') stoppedButUnpersisted.set(stopKey(input.senderId, owner.ownerKey, input.planId), Date.now() + 5 * 60_000)
    if (result.kind === 'terminated' && input.sessionId) stoppingSessions.delete(input.sessionId)
    return result
  } catch (error) { return { kind: 'unavailable', error: error instanceof Error ? error.message : String(error) } }
}

async function retryTermination(input: CardInput & { planId: string }): Promise<PlanCardStopResult> {
  try {
    const owner = resolve(input)
    const key = stopKey(input.senderId, owner.ownerKey, input.planId)
    if ((stoppedButUnpersisted.get(key) ?? 0) < Date.now()) throw Error('没有可重试的已停止任务')
    if (isBusy(input)) throw Error('会话已重新运行，不能重试终止写入')
    const current = await cardRead(input, deps)
    if (current.kind !== 'active' || current.card.planId !== input.planId) throw Error('计划状态已经变化')
    await requestExecutionPlanCard('host/card-terminate', owner, { planId: input.planId, expectedVersion: current.card.version })
    stoppedButUnpersisted.delete(key)
    if (input.sessionId) stoppingSessions.delete(input.sessionId)
    return { kind: 'terminated' }
  } catch (error) { return { kind: 'unavailable', error: error instanceof Error ? error.message : String(error) } }
}

export function registerExecutionPlanCardHandlers(): void {
  setPlanIdleSink(sessionId => {
    if (stoppingSessions.has(sessionId)) return
    const session = planCardSessionForHost(sessionId)
    if (!session || session.busy) return
    void readWithCompletion({ senderId: session.senderId, sessionId, nodeId: session.agentNodeId })
  })
  guardedHandle('agentChat:planCardRead', (e, ref: { nodeId?: string; sessionId?: string }) =>
    readWithCompletion({ senderId: e.sender.id, nodeId: ref?.nodeId, sessionId: ref?.sessionId }))
  guardedHandle('agentChat:planCardAccept', (e, input: PlanCardAcceptInput) =>
    input.sessionId && stoppingSessions.has(input.sessionId)
      ? { kind: 'unavailable', error: '正在终止本次任务' }
      : cardAccept({ ...input, senderId: e.sender.id }, deps))
  guardedHandle('agentChat:planCardStop', (e, input: PlanCardStopInput) =>
    stop({ ...input, senderId: e.sender.id }))
  guardedHandle('agentChat:planCardRetryTermination', (e, input: { nodeId?: string; sessionId?: string; planId: string }) =>
    retryTermination({ ...input, senderId: e.sender.id }))
}
