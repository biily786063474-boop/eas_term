import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPlan, getPlan, listPlans, updateStep, archivePlan, acceptStep, cardForOwner, cardAccept, completePlan, terminatePlan } from './store.mjs'

const root = (t: import('node:test').TestContext): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-plan-store-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const who = { sessionId: 'session-a', turnId: 'turn-1', ownerKey: 'node:a' }
const input = { title: '字幕同步', steps: [{ title: '定位', criterion: '复现错位' }, { title: '修复', criterion: '长音频对齐' }] }
const file = (dir: string): string => path.join(dir, '.eas', 'execution-plans.json')

test('same source turn is idempotent, a new turn creates another plan', async t => {
  const dir = root(t)
  const a = await createPlan(dir, who, input)
  const again = await createPlan(dir, who, { ...input, title: '不应覆盖' })
  const b = await createPlan(dir, { ...who, turnId: 'turn-2' }, input)
  assert.equal(again.planId, a.planId)
  assert.equal((await getPlan(dir, a.planId)).title, input.title)
  assert.notEqual(b.planId, a.planId)
  assert.equal((await listPlans(dir, { sessionId: who.sessionId })).total, 2)
})

test('step updates use CAS and only panel acceptance sets accepted', async t => {
  const dir = root(t)
  const a = await createPlan(dir, who, input)
  const stepId = a.steps[0].stepId
  await assert.rejects(updateStep(dir, who, { planId: a.planId, stepId, status: 'reported_done', expectedVersion: 0 }), { code: 'VERSION_CONFLICT' })
  const done = await updateStep(dir, who, { planId: a.planId, stepId, status: 'reported_done', evidence: '测试已过', expectedVersion: a.version })
  assert.equal(done.steps[0].accepted, false)
  assert.equal(done.steps[0].status, 'reported_done')
  await assert.rejects(updateStep(dir, who, { planId: a.planId, stepId, title: '抹除', expectedVersion: done.version }), /完成|撤回/)
  const accepted = await acceptStep(dir, { planId: a.planId, stepId, accepted: true, expectedVersion: done.version })
  assert.equal(accepted.steps[0].accepted, true)
  const undone = await updateStep(dir, who, { planId: a.planId, stepId, status: 'in_progress', expectedVersion: accepted.version })
  assert.equal(undone.steps[0].accepted, false)
  assert.ok(undone.steps[0].history.some((event: { evidence?: string }) => event.evidence === '测试已过'))
})

test('append and edit pending steps, archive without changing another plan', async t => {
  const dir = root(t)
  const a = await createPlan(dir, who, input)
  const b = await createPlan(dir, { ...who, turnId: 'turn-2' }, input)
  const changed = await updateStep(dir, who, { planId: a.planId, stepId: a.steps[0].stepId, title: '定位时间戳', expectedVersion: b.version })
  assert.equal(changed.steps[0].title, '定位时间戳')
  const added = await updateStep(dir, who, { planId: a.planId, append: [{ title: '验收', criterion: '倍速同步' }], expectedVersion: changed.version })
  assert.equal(added.steps.length, 3)
  const archived = await archivePlan(dir, who, { planId: a.planId, expectedVersion: added.version })
  assert.equal(archived.status, 'archived')
  assert.equal((await getPlan(dir, b.planId)).status, 'active')
})

test('concurrent writes to one version reject a stale writer', async t => {
  const dir = root(t)
  const a = await createPlan(dir, who, input)
  const outcomes = await Promise.allSettled([
    updateStep(dir, who, { planId: a.planId, stepId: a.steps[0].stepId, status: 'in_progress', expectedVersion: a.version }),
    updateStep(dir, who, { planId: a.planId, stepId: a.steps[1].stepId, status: 'in_progress', expectedVersion: a.version })
  ])
  assert.deepEqual(outcomes.map(x => x.status).sort(), ['fulfilled', 'rejected'])
  assert.equal((outcomes.find(x => x.status === 'rejected') as PromiseRejectedResult).reason.code, 'VERSION_CONFLICT')
})

test('corrupt and oversized databases are never silently overwritten', async t => {
  const dir = root(t)
  await createPlan(dir, who, input)
  for (const bad of ['{broken', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    fs.writeFileSync(file(dir), bad)
    await assert.rejects(createPlan(dir, { ...who, turnId: 'later' }, input))
    assert.equal(fs.readFileSync(file(dir), 'utf8'), bad)
  }
})

test('symlinked .eas directory or database never redirects writes', async t => {
  const dir = root(t), elsewhere = root(t)
  fs.symlinkSync(elsewhere, path.join(dir, '.eas'), 'dir')
  await assert.rejects(createPlan(dir, who, input), /符号链接/)
  fs.unlinkSync(path.join(dir, '.eas'))
  fs.mkdirSync(path.join(dir, '.eas'))
  const target = path.join(elsewhere, 'keep')
  fs.writeFileSync(target, 'keep')
  fs.symlinkSync(target, file(dir))
  await assert.rejects(createPlan(dir, who, input), /符号链接/)
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep')
})

test('owner isolation includes model reads, writes and all-session listing', async t => {
  const dir = root(t), b = { sessionId: 'session-b', turnId: 'turn-b', ownerKey: 'node:b' }
  const aPlan = await createPlan(dir, who, input)
  const bPlan = await createPlan(dir, b, input)
  assert.equal(cardForOwner(dir, who.ownerKey)?.planId, aPlan.planId)
  assert.equal(cardForOwner(dir, b.ownerKey)?.planId, bPlan.planId)
  assert.equal(listPlans(dir, { ownerKey: who.ownerKey }).total, 1)
  assert.throws(() => getPlan(dir, bPlan.planId, who), /归属/)
  await assert.rejects(updateStep(dir, who, { planId: bPlan.planId, stepId: bPlan.steps[0].stepId, status: 'in_progress', expectedVersion: bPlan.version }), /归属/)
  await assert.rejects(archivePlan(dir, who, { planId: bPlan.planId, expectedVersion: bPlan.version }), /归属/)
})

test('legacy plan remains readable but cannot become another owner card', async t => {
  const dir = root(t)
  const a = await createPlan(dir, who, input)
  const db = JSON.parse(fs.readFileSync(file(dir), 'utf8'))
  delete db.plans[0].ownerKey
  fs.writeFileSync(file(dir), JSON.stringify(db))
  assert.equal(getPlan(dir, a.planId).planId, a.planId)
  assert.equal(cardForOwner(dir, who.ownerKey), null)
})

test('card acceptance and terminal transitions are atomic with CAS', async t => {
  const dir = root(t)
  const a = await createPlan(dir, who, input)
  await assert.rejects(cardAccept(dir, { ownerKey: who.ownerKey, planId: a.planId, stepId: a.steps[0].stepId, accepted: true, expectedVersion: a.version, completeNow: true }), /报告完成/)
  const one = await updateStep(dir, who, { planId: a.planId, stepId: a.steps[0].stepId, status: 'reported_done', expectedVersion: a.version })
  const two = await updateStep(dir, who, { planId: a.planId, stepId: a.steps[1].stepId, status: 'reported_done', expectedVersion: one.version })
  const first = await cardAccept(dir, { ownerKey: who.ownerKey, planId: a.planId, stepId: a.steps[0].stepId, accepted: true, expectedVersion: two.version, completeNow: true })
  assert.equal(first.status, 'active')
  const second = await cardAccept(dir, { ownerKey: who.ownerKey, planId: a.planId, stepId: a.steps[1].stepId, accepted: true, expectedVersion: first.version, completeNow: false })
  assert.equal(second.status, 'active')
  const outcomes = await Promise.allSettled([
    completePlan(dir, { ownerKey: who.ownerKey, planId: a.planId, expectedVersion: second.version }),
    updateStep(dir, who, { planId: a.planId, append: [{ title: '新步骤', criterion: '待验收' }], expectedVersion: second.version })
  ])
  assert.deepEqual(outcomes.map(x => x.status).sort(), ['fulfilled', 'rejected'])
  assert.equal((outcomes.find(x => x.status === 'rejected') as PromiseRejectedResult).reason.code, 'VERSION_CONFLICT')
  const latest = getPlan(dir, a.planId)
  if (latest.status === 'active') assert.equal(latest.steps.at(-1)?.accepted, false)
  else assert.equal(latest.status, 'completed')
  await assert.rejects(terminatePlan(dir, { ownerKey: 'node:b', planId: a.planId, expectedVersion: latest.version }), /归属/)
})

test('termination is owner-scoped and idempotent, never changes completed history', async t => {
  const dir = root(t)
  const a = await createPlan(dir, who, input)
  const stopped = await terminatePlan(dir, { ownerKey: who.ownerKey, planId: a.planId, expectedVersion: a.version })
  assert.equal(stopped.status, 'terminated')
  assert.equal((await terminatePlan(dir, { ownerKey: who.ownerKey, planId: a.planId, expectedVersion: a.version })).status, 'terminated')
  assert.equal(cardForOwner(dir, who.ownerKey), null)
})
