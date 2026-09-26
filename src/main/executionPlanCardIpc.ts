import { app } from 'electron'
import { guardedHandle } from './ipcGuard.ts'
import { resolveNodePlanOwner, resolvePlanOwner } from './executionPlanOwner.ts'
import { planCardSession } from './agentChat/session.ts'
import { requestExecutionPlanCard } from './pluginHost.ts'
import { cardAccept, cardRead, type CardInput } from './executionPlanCardHost.ts'
import type { PlanCardAcceptInput } from '../shared/agentChat.ts'

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
const deps = { resolve, request: requestExecutionPlanCard }

export function registerExecutionPlanCardHandlers(): void {
  guardedHandle('agentChat:planCardRead', (e, ref: { nodeId?: string; sessionId?: string }) =>
    cardRead({ senderId: e.sender.id, nodeId: ref?.nodeId, sessionId: ref?.sessionId }, deps))
  guardedHandle('agentChat:planCardAccept', (e, input: PlanCardAcceptInput) =>
    cardAccept({ ...input, senderId: e.sender.id }, deps))
}
