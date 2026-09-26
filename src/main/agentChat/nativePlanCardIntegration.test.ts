import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cardRead, cardAccept } from '../executionPlanCardHost.ts'
// @ts-expect-error Bundled plugin store intentionally ships as plain .mjs.
import { createPlan, updateStep, cardForOwner, cardAccept as storeAccept, completePlan, terminatePlan } from '../../../resources/plugins/execution-plan/lib/store.mjs'

test('two same-project chat nodes isolate card, acceptance, completion and termination across reread', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'native-plan-card-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const seed = { title: '执行', steps: [{ title: '一', criterion: '完成一' }, { title: '二', criterion: '完成二' }] }
  const a = await createPlan(cwd, { sessionId: 'old-a', turnId: 't', ownerKey: 'node:a' }, seed)
  const b = await createPlan(cwd, { sessionId: 'old-b', turnId: 't', ownerKey: 'node:b' }, seed)
  const deps = {
    resolve: ({ nodeId }: { nodeId?: string }) => ({ root: cwd, ownerKey: `node:${nodeId}` }),
    request: async (method: string, owner: { root: string; ownerKey: string }, args?: Record<string, any>) => {
      switch (method) {
        case 'host/card-read': return cardForOwner(owner.root, owner.ownerKey)
        case 'host/card-accept': return storeAccept(owner.root, { ...args, ownerKey: owner.ownerKey })
        case 'host/card-complete': return completePlan(owner.root, { ...args, ownerKey: owner.ownerKey })
        case 'host/card-terminate': return terminatePlan(owner.root, { ...args, ownerKey: owner.ownerKey })
        default: throw Error('unexpected')
      }
    },
    isBusy: () => false
  }
  assert.equal((await cardRead({ senderId: 1, nodeId: 'a' }, deps)).kind, 'active')
  assert.equal((await cardAccept({ senderId: 1, nodeId: 'b', planId: a.planId, stepId: a.steps[0].stepId, accepted: true, expectedVersion: b.version }, deps)).kind, 'unavailable')
  let state = { ...a, version: b.version }
  for (const step of a.steps) state = await updateStep(cwd, { sessionId: 'new-a', turnId: 'after-restart', ownerKey: 'node:a' }, { planId: a.planId, stepId: step.stepId, status: 'reported_done', expectedVersion: state.version })
  const one = await cardAccept({ senderId: 1, nodeId: 'a', planId: a.planId, stepId: a.steps[0].stepId, accepted: true, expectedVersion: state.version }, deps)
  assert.equal(one.kind, 'active')
  const version = one.kind === 'active' ? one.card.version : -1
  assert.equal((await cardAccept({ senderId: 1, nodeId: 'a', planId: a.planId, stepId: a.steps[1].stepId, accepted: true, expectedVersion: version }, deps)).kind, 'empty')
  assert.equal(cardForOwner(cwd, 'node:a'), null)
  assert.equal(cardForOwner(cwd, 'node:b')?.planId, b.planId)
  const stopped = await terminatePlan(cwd, { ownerKey: 'node:b', planId: b.planId, expectedVersion: cardForOwner(cwd, 'node:b')!.version })
  assert.equal(stopped.status, 'terminated')
  assert.equal(cardForOwner(cwd, 'node:b'), null)
})

test('registration is append-only after existing chat handlers', () => {
  const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  const chat = source.indexOf('  registerAgentChatHandlers()')
  const card = source.indexOf('  registerExecutionPlanCardHandlers()')
  const usage = source.indexOf('  registerUsageHandlers()')
  assert.ok(chat >= 0 && card > chat && usage > card)
})
