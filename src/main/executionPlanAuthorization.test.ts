import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { CapabilitySessions } from './capabilitySessions.ts'
import { authorizePlanCall, preparePlanToolParams, preparePlanPanelParams } from './executionPlanAuthorization.ts'

test('real managed lease authenticates; launcher and revoked leases do not', t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-auth-'))
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-auth-root-'))
  t.after(() => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }) })
  const sessions = new CapabilitySessions('app', 'generation')
  const lease = sessions.issue({ agentSessionId: 's', project: cwd, agentLeafId: 'leaf' })
  const launcher = sessions.issue({ ptyId: 'pty', project: '/projects/one' }, 'launcher')
  const context = sessions.authenticate(lease)
  assert.deepEqual(authorizePlanCall(context, { sessionId: 's', turnId: 't' }, cwd, userData), { cwd: fs.realpathSync(cwd), sessionId: 's', turnId: 't', ownerKey: 'session:s' })
  assert.throws(() => sessions.authenticate(launcher), /无效|授权/)
  sessions.revoke(lease.id)
  assert.throws(() => sessions.authenticate(lease), /无效|撤销/)
})

test('session, current turn and project must agree with authenticated context', () => {
  const context = { agentSessionId: 's', project: '/projects/one' }
  assert.throws(() => authorizePlanCall(context, { sessionId: 'other', turnId: 't' }, '/projects/one', '/tmp'))
  assert.throws(() => authorizePlanCall(context, null, '/projects/one', '/tmp'))
  assert.throws(() => authorizePlanCall(context, { sessionId: 's', turnId: 't' }, '/projects/two', '/tmp'))
  assert.throws(() => authorizePlanCall({ project: '/projects/one' }, { sessionId: 's', turnId: 't' }, '/projects/one', '/tmp'))
})

test('caller _meta and body.project cannot replace the trusted project or turn', () => {
  const trusted = { cwd: '/projects/one', sessionId: 's', turnId: 't', ownerKey: 'node:n-a' }
  const full = preparePlanToolParams({ name: 'plan_create', arguments: { title: 'X' }, _meta: { eas: { context: { cwd: '/projects/two', sessionId: 'other', turnId: 'fake', ownerKey: 'node:n-b' } }, marker: 1 } }, trusted)
  assert.deepEqual((full._meta as any).eas.context, trusted)
  assert.equal((full._meta as any).marker, 1)
  assert.equal((full.arguments as any).title, 'X')
})

test('panel params bind to its original project, not supplied cwd', () => {
  const full = preparePlanPanelParams({ planId: 'p', _meta: { eas: { context: { cwd: '/projects/two' } } } }, '/projects/one')
  assert.equal((full._meta as any).eas.context.cwd, path.normalize('/projects/one'))
  assert.equal(full.planId, 'p')
})
