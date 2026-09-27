import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stopPlanFlow, completeReportedPlan, withStopGate } from './executionPlanStop.ts'

test('confirmed stop precedes terminal write; uncertainty never writes', async () => {
  const calls: string[] = []
  const deps = { stop: async () => { calls.push('stop'); return true }, write: async () => { calls.push('write') }, read: async () => ({ version: 2, steps: [] }) }
  assert.equal((await stopPlanFlow({ planId: 'p', expectedVersion: 2 }, deps)).kind, 'terminated')
  assert.deepEqual(calls, ['stop', 'write'])
  calls.length = 0
  assert.equal((await stopPlanFlow({ planId: 'p', expectedVersion: 2 }, { ...deps, stop: async () => false })).kind, 'stop-unconfirmed')
  assert.deepEqual(calls, [])
})

test('persist failure is partial; completed plans need model-done steps and idle', async () => {
  const partial = await stopPlanFlow({ planId: 'p', expectedVersion: 1 }, { stop: async () => true, write: async () => { throw Error('readonly') } })
  assert.equal(partial.kind, 'stopped-unpersisted')
  let writes = 0
  const deps = { idle: () => false, read: async () => ({ planId: 'p', version: 1, steps: [{ status: 'reported_done', accepted: false }] }), write: async () => { writes++ } }
  assert.equal(await completeReportedPlan('p', deps), false)
  assert.equal(writes, 0)
  assert.equal(await completeReportedPlan('p', { ...deps, idle: () => true }), true)
  assert.equal(writes, 1)
})

test('stop gate releases an unconfirmed or failed stop but holds a stopped-unpersisted task', async () => {
  const gate = new Set<string>()
  const run = (result: Awaited<ReturnType<typeof stopPlanFlow>>) => withStopGate('s', gate, async () => {
    assert.equal(gate.has('s'), true)
    return result
  })
  await run({ kind: 'stop-unconfirmed', error: 'timeout' })
  assert.equal(gate.has('s'), false)
  await run({ kind: 'stopped-unpersisted', error: 'readonly' })
  assert.equal(gate.has('s'), true)
  gate.clear()
  await run({ kind: 'terminated' })
  assert.equal(gate.has('s'), false)
  await assert.rejects(withStopGate('s', gate, async () => { throw Error('crash') }), /crash/)
  assert.equal(gate.has('s'), false)
})

test('pending/blocked/withdrawn steps never finish even with legacy acceptance',async()=>{
 for(const status of ['pending','blocked','in_progress']){
  assert.equal(await completeReportedPlan('p',{idle:()=>true,read:async()=>({planId:'p',version:1,steps:[{status,accepted:true}]}),write:async()=>{throw Error('must not complete')}}),false)
 }
})
