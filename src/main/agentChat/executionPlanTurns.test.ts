import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activePlanTurn, beginPlanTurn, ensurePlanTurn, notePlanExec, notePlanReceipt, endPlanTurn, retirePlanTurn } from './executionPlanTurns.ts'

test('plain text ends with neutral missing reminder, real edit makes it stronger', () => {
  beginPlanTurn('plain', 't1')
  assert.deepEqual(endPlanTurn('plain', 't1', { interrupted: false }), { k: 'plan.missing', executed: false })
  beginPlanTurn('edited', 't1')
  notePlanExec('edited', 't1', { kind: 'edit', tool: 'apply_patch' })
  assert.deepEqual(endPlanTurn('edited', 't1', { interrupted: false }), { k: 'plan.missing', executed: true })
  assert.equal(activePlanTurn('edited'), null)
})

test('read/search alone does not claim edits, interruption has no omission verdict', () => {
  beginPlanTurn('read', 't1')
  notePlanExec('read', 't1', { kind: 'read', tool: 'Read' })
  assert.deepEqual(endPlanTurn('read', 't1', { interrupted: false }), { k: 'plan.missing', executed: false })
  beginPlanTurn('interrupt', 't1')
  notePlanExec('interrupt', 't1', { kind: 'terminal', tool: 'Bash' })
  assert.equal(endPlanTurn('interrupt', 't1', { interrupted: true }), null)
})

test('successful create/update suppresses missing and duplicate receipt does not emit progress twice', () => {
  beginPlanTurn('planned', 't1')
  const receipt = { tool: 'plan_create' as const, planId: 'p', version: 1, steps: [{ stepId: 'a', title: '定位', status: 'reported_done' }, { stepId: 'b', title: '验收', status: 'pending' }] }
  const event = notePlanReceipt('planned', 't1', receipt)
  assert.deepEqual(event, { k: 'plan.progress', plan: { planId: 'p', done: 1, total: 2, currentTitle: '验收', version: 1 } })
  assert.equal(notePlanReceipt('planned', 't1', receipt), null)
  assert.equal(endPlanTurn('planned', 't1', { interrupted: false }), null)
  beginPlanTurn('planned', 't2')
  assert.ok(notePlanReceipt('planned', 't2', { ...receipt, tool: 'step_update', version: 2 }))
  assert.equal(endPlanTurn('planned', 't2', { interrupted: false }), null)
})

test('failed, late and retired receipts never update the current turn', () => {
  beginPlanTurn('failed', 't1')
  assert.equal(notePlanReceipt('failed', 't1', { tool: 'plan_create', isError: true, planId: 'p', version: 1, steps: [] }), null)
  assert.deepEqual(endPlanTurn('failed', 't1', { interrupted: false }), { k: 'plan.missing', executed: false })
  beginPlanTurn('stale', 't1')
  beginPlanTurn('stale', 't2')
  assert.equal(notePlanReceipt('stale', 't1', { tool: 'plan_create', planId: 'old', version: 1, steps: [] }), null)
  retirePlanTurn('stale')
  assert.equal(notePlanReceipt('stale', 't2', { tool: 'plan_create', planId: 'new', version: 1, steps: [] }), null)
})

test('retry reuses user-message turn identity; next message gets a new one', () => {
  const first = ensurePlanTurn('retry', () => 'id-1')
  assert.equal(ensurePlanTurn('retry', () => 'must-not-run').turnId, first.turnId)
  endPlanTurn('retry', 'id-1', { interrupted: true })
  assert.equal(ensurePlanTurn('retry', () => 'id-2').turnId, 'id-2')
  retirePlanTurn('retry')
})
