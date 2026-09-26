import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import readline from 'node:readline'

function client(t: import('node:test').TestContext) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let seq = 0
  child.on('exit', code => {
    for (const entry of pending.values()) entry.reject(new Error(`MCP server exited ${code}`))
    pending.clear()
  })
  readline.createInterface({ input: child.stdout }).on('line', line => {
    const msg = JSON.parse(line)
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result)
  })
  return (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} 超时`)) }, 3000).unref()
  })
}
const seed = { title: '字幕同步', steps: [{ title: '定位', criterion: '复现错位' }, { title: '修复', criterion: '验收倍速' }] }
const fixture = (t: import('node:test').TestContext) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-plan-server-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  return cwd
}

test('lists exactly five model tools, no panel-private methods', async t => {
  const rpc = client(t)
  const init = await rpc('initialize')
  assert.equal(init.serverInfo.name, 'execution-plan')
  const names = (await rpc('tools/list')).tools.map((x: { name: string }) => x.name).sort()
  assert.deepEqual(names, ['plan_archive', 'plan_create', 'plan_get', 'plan_list', 'step_update'])
  assert.ok((await rpc('tools/list')).tools.every((x: { inputSchema: { additionalProperties: boolean } }) => x.inputSchema.additionalProperties === false))
})

test('model write needs trusted host metadata and rejects identity/acceptance arguments', async t => {
  const rpc = client(t), cwd = fixture(t), other = fixture(t)
  const absent = await rpc('tools/call', { name: 'plan_create', arguments: seed })
  assert.equal(absent.isError, true)
  const context = { _meta: { eas: { context: { cwd, sessionId: 's', turnId: 't', ownerKey: 'node:a' } } } }
  const forged = await rpc('tools/call', { name: 'plan_create', arguments: { ...seed, cwd: other, accepted: true }, ...context })
  assert.equal(forged.isError, true)
  assert.equal(fs.existsSync(path.join(other, '.eas', 'execution-plans.json')), false)
  const created = await rpc('tools/call', { name: 'plan_create', arguments: seed, ...context })
  assert.equal(created.isError, undefined)
  assert.equal(created.structuredContent.steps.every((x: { accepted: boolean }) => x.accepted === false), true)
  assert.equal(fs.existsSync(path.join(cwd, '.eas', 'execution-plans.json')), true)
})

test('panel accept is private; model cannot call it, panel must receive project context', async t => {
  const rpc = client(t), cwd = fixture(t)
  const context = { _meta: { eas: { context: { cwd, sessionId: 's', turnId: 't', ownerKey: 'node:a' } } } }
  const made = await rpc('tools/call', { name: 'plan_create', arguments: seed, ...context })
  const plan = made.structuredContent
  const model = await rpc('tools/call', { name: 'panel/accept', arguments: { planId: plan.planId, stepId: plan.steps[0].stepId, accepted: true, expectedVersion: plan.version }, ...context })
  assert.equal(model.isError, true)
  await assert.rejects(rpc('panel/accept', { planId: plan.planId, stepId: plan.steps[0].stepId, accepted: true, expectedVersion: plan.version }), /项目|上下文/)
  const detail = await rpc('panel/get', { planId: plan.planId, _meta: { eas: { context: { cwd } } } })
  assert.equal(detail.steps[0].accepted, false)
})

test('model cannot read, list, update or archive a different owner plan', async t => {
  const rpc = client(t), cwd = fixture(t)
  const meta = (ownerKey: string, sessionId: string) => ({ _meta: { eas: { context: { cwd, sessionId, turnId: 't', ownerKey } } } })
  const a = (await rpc('tools/call', { name: 'plan_create', arguments: seed, ...meta('node:a', 'a') })).structuredContent
  await rpc('tools/call', { name: 'plan_create', arguments: seed, ...meta('node:b', 'b') })
  const b = meta('node:b', 'b')
  for (const [name, args] of [
    ['plan_get', { planId: a.planId }],
    ['step_update', { planId: a.planId, stepId: a.steps[0].stepId, status: 'in_progress', expectedVersion: 2 }],
    ['plan_archive', { planId: a.planId, expectedVersion: 2 }]
  ] as const) assert.equal((await rpc('tools/call', { name, arguments: args, ...b })).isError, true)
  const list = await rpc('tools/call', { name: 'plan_list', arguments: { allSessions: true }, ...b })
  assert.equal(list.structuredContent.total, 1)
})

test('host card RPC is private and owner-scoped', async t => {
  const rpc = client(t), cwd = fixture(t)
  const context = { _meta: { eas: { context: { cwd, sessionId: 's', turnId: 't', ownerKey: 'node:a' } } } }
  const made = (await rpc('tools/call', { name: 'plan_create', arguments: seed, ...context })).structuredContent
  assert.equal((await rpc('tools/call', { name: 'host/card-read', arguments: {}, ...context })).isError, true)
  const host = { _meta: { eas: { context: { cwd, ownerKey: 'node:a' } } } }
  assert.equal((await rpc('host/card-read', host)).planId, made.planId)
  assert.equal(await rpc('host/card-read', { _meta: { eas: { context: { cwd, ownerKey: 'node:b' } } } }), null)
  await assert.rejects(rpc('host/card-terminate', { planId: made.planId, expectedVersion: made.version, _meta: { eas: { context: { cwd, ownerKey: 'node:b' } } } }), /归属/)
})
