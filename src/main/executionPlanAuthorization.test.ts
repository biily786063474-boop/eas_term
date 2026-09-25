import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { CapabilitySessions } from './capabilitySessions.ts'
import { authorizePlanCall, preparePlanToolParams, preparePlanPanelParams } from './executionPlanAuthorization.ts'

test('real managed lease authenticates; launcher and revoked leases do not', () => {
  const sessions = new CapabilitySessions('app', 'generation')
  const lease = sessions.issue({ agentSessionId: 's', project: '/projects/one' })
  const launcher = sessions.issue({ ptyId: 'pty', project: '/projects/one' }, 'launcher')
  const context = sessions.authenticate(lease)
  assert.deepEqual(authorizePlanCall(context, { sessionId: 's', turnId: 't' }, '/projects/one'), { cwd: '/projects/one', sessionId: 's', turnId: 't' })
  assert.throws(() => sessions.authenticate(launcher), /无效|授权/)
  sessions.revoke(lease.id)
  assert.throws(() => sessions.authenticate(lease), /无效|撤销/)
})

test('session, current turn and project must agree with authenticated context', () => {
  const context = { agentSessionId: 's', project: '/projects/one' }
  assert.throws(() => authorizePlanCall(context, { sessionId: 'other', turnId: 't' }, '/projects/one'))
  assert.throws(() => authorizePlanCall(context, null, '/projects/one'))
  assert.throws(() => authorizePlanCall(context, { sessionId: 's', turnId: 't' }, '/projects/two'))
  assert.throws(() => authorizePlanCall({ project: '/projects/one' }, { sessionId: 's', turnId: 't' }, '/projects/one'))
})

test('caller _meta and body.project cannot replace the trusted project or turn', () => {
  const trusted = { cwd: '/projects/one', sessionId: 's', turnId: 't' }
  const full = preparePlanToolParams({ name: 'plan_create', arguments: { title: 'X' }, _meta: { eas: { context: { cwd: '/projects/two', sessionId: 'other', turnId: 'fake' } }, marker: 1 } }, trusted)
  assert.deepEqual((full._meta as any).eas.context, trusted)
  assert.equal((full._meta as any).marker, 1)
  assert.equal((full.arguments as any).title, 'X')
})

test('panel params bind to its original project, not supplied cwd', () => {
  const full = preparePlanPanelParams({ planId: 'p', _meta: { eas: { context: { cwd: '/projects/two' } } } }, '/projects/one')
  assert.equal((full._meta as any).eas.context.cwd, path.normalize('/projects/one'))
  assert.equal(full.planId, 'p')
})
