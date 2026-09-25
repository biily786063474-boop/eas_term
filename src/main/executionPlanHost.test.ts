import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedPlanPanelMethod, planShimMayCall } from './executionPlanAuthorization.ts'
import { activePlanTurn, beginPlanTurn, retirePlanTurn } from './agentChat/executionPlanTurns.ts'

test('only the five panel-private methods are forwarded from an active panel', () => {
  for (const method of ['panel/list', 'panel/get', 'panel/accept', 'panel/update', 'panel/archive']) assert.equal(allowedPlanPanelMethod(method), true)
  for (const method of ['panel/grant', 'panel/delete', 'tools/call', 'panel/accept/other']) assert.equal(allowedPlanPanelMethod(method), false)
})

test('model shim cannot use panel/private methods or disabled/replaced plugin', () => {
  assert.equal(planShimMayCall('tools/call', { enabled: true, sameRoot: true, live: true }), true)
  assert.equal(planShimMayCall('panel/accept', { enabled: true, sameRoot: true, live: true }), false)
  assert.equal(planShimMayCall('tools/call', { enabled: false, sameRoot: true, live: true }), false)
  assert.equal(planShimMayCall('tools/call', { enabled: true, sameRoot: false, live: true }), false)
  assert.equal(planShimMayCall('tools/call', { enabled: true, sameRoot: true, live: false }), false)
})

test('host sees only a main-issued active turn', () => {
  assert.equal(activePlanTurn('s'), null)
  beginPlanTurn('s', 't')
  assert.deepEqual(activePlanTurn('s'), { sessionId: 's', turnId: 't' })
  retirePlanTurn('s')
  assert.equal(activePlanTurn('s'), null)
})
