import path from 'node:path'
import fs from 'node:fs'
import { projectRootOf } from '../shared/roleWorktree.ts'
import type { CapabilityContext } from './capabilitySessions.ts'
import { resolvePlanOwner } from './executionPlanOwner.ts'

export interface PlanTurnIdentity { sessionId: string; turnId: string }
export interface TrustedPlanContext extends PlanTurnIdentity { cwd: string; ownerKey: string }

/** The lease context comes from CapabilitySessions, never a model argument or HTTP project field. */
export function authorizePlanCall(context: CapabilityContext, turn: PlanTurnIdentity | null, guardedProjectRoot: string, userData: string): TrustedPlanContext {
  if (!context.agentSessionId || !context.project || !turn?.sessionId || !turn.turnId || turn.sessionId !== context.agentSessionId) throw Error('缺少有效的受管会话轮次')
  if (!path.isAbsolute(guardedProjectRoot) || path.resolve(projectRootOf(context.project)) !== path.resolve(guardedProjectRoot)) throw Error('执行清单项目不匹配')
  const owner = resolvePlanOwner({ userData, cwd: context.project, sessionId: context.agentSessionId, agentNodeId: context.agentNodeId, agentLeafId: context.agentLeafId })
  if (owner.root !== fs.realpathSync(guardedProjectRoot)) throw Error('执行清单项目归属不匹配')
  return { cwd: owner.root, sessionId: context.agentSessionId, turnId: turn.turnId, ownerKey: owner.ownerKey }
}

/** The entire Eas context is replaced; preserving arbitrary other MCP metadata is harmless. */
export function preparePlanToolParams(params: unknown, trusted: TrustedPlanContext): Record<string, unknown> {
  const p = params && typeof params === 'object' && !Array.isArray(params) ? { ...params as Record<string, unknown> } : {}
  const old = p._meta && typeof p._meta === 'object' && !Array.isArray(p._meta) ? p._meta as Record<string, unknown> : {}
  return { ...p, _meta: { ...old, eas: { context: trusted } } }
}

export function preparePlanPanelParams(params: unknown, cwd: string): Record<string, unknown> {
  const p = params && typeof params === 'object' && !Array.isArray(params) ? { ...params as Record<string, unknown> } : {}
  delete p._meta
  return { ...p, _meta: { eas: { context: { cwd: path.normalize(cwd) } } } }
}

const PANEL_METHODS = new Set(['panel/list', 'panel/get', 'panel/accept', 'panel/update', 'panel/archive'])
export function allowedPlanPanelMethod(method: string): boolean { return PANEL_METHODS.has(method) }
export function planShimMayCall(method: string, state: { enabled: boolean; sameRoot: boolean; live: boolean }): boolean {
  return ['initialize', 'tools/list', 'tools/call', 'resources/list', 'resources/read'].includes(method) && state.enabled && state.sameRoot && state.live
}
