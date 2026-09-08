import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBizoneGenerationGuard } from './bizoneGenerationGuard.ts'
import type { BuiltinHosted } from './builtinCapabilityHost.ts'
const answer = (data: unknown, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], ...(isError ? { isError } : {}) })
const body = (r: any) => JSON.parse(r.content.at(-1).text)
const stable = (v: any): string => v && typeof v === 'object' ? Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v)
const digest = (v: any) => createHash('sha256').update(stable(v)).digest('hex')
const paid = ['generate', 'generate_now', 'confirm_batch_generate', 'run_group', 'matting', 'upscale', 'outpaint', 'relight', 'batch_upscale']
const context = { project: '/project', agentSessionId: 'ac-one' }
const authorized = () => {}
function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'bizone-guard-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const calls: { name: string; args: any }[] = [], records = new Map<string, any>()
  let mode = 'normal', legacy = false
  let observe = (_name: string, _args: any) => {}
  const underlying: BuiltinHosted = {
    kind: 'builtin', close() {},
    async tools() { return [...paid, 'get_generation_status', 'reverse_prompt_text', ...(legacy ? [] : ['get_generation_request'])].map(name => ({ name, inputSchema: { type: 'object', properties: legacy ? {} : { requestId: { type: 'string' } } } })) },
    async call(name, args, _ctx, check) {
      check(); const a = args as any; calls.push({ name, args }); observe(name, args)
      if (name === 'get_generation_request') {
        const record = records.get(a.requestId)
        if (mode === 'mismatch') return answer({ ...record, argumentsDigest: '0'.repeat(64) })
        return answer(record ?? { requestId: a.requestId, state: 'not_found' })
      }
      if (!paid.includes(name)) return answer({ status: 'done', taskId: 'unrelated' })
      const { requestId, ...params } = a
      const meta = { requestId, tool: name, argumentsDigest: digest(params), state: mode === 'unknown' ? 'unknown' : 'acknowledged' }
      const result = mode === 'quote_error' ? { ok: false, error: 'invalid model' } : { ok: true, estimate: { credits: 3 }, nodeId: params.nodeId ?? null }
      if (mode !== 'not_found') records.set(requestId, { ...meta, ...(meta.state === 'acknowledged' ? { result } : {}) })
      if (['lost', 'unknown', 'not_found', 'mismatch'].includes(mode)) throw new Error('accepted then socket closed secret-value')
      return answer({ ...result, _request: meta })
    }
  }
  return { dir, calls, records, mode: (s: string) => { mode = s }, legacy: () => { legacy = true }, observe: (fn: typeof observe) => { observe = fn },
    create: () => createBizoneGenerationGuard({ appOwnedDataDir: dir, underlying }) }
}
test('quote and execution IDs survive restart; repeated explicit quote ID cannot create another execution', async t => {
  const f = setup(t); let g = f.create()
  const quote = body(await g.call('generate', { nodeId: 'n', modelId: 'm', requestId: 'quote-one' }, context, authorized))
  assert.notEqual(quote.easOperationId, 'quote-one')
  g = f.create()
  await g.call('generate_now', { nodeId: 'n' }, context, authorized)
  const replay = body(await g.call('generate', { nodeId: 'n', modelId: 'm', requestId: 'quote-one' }, context, authorized))
  assert.equal(replay.easOperationId, quote.easOperationId)
  await g.call('generate_now', { nodeId: 'n' }, context, authorized)
  assert.equal(f.calls.filter(c => c.name === 'generate_now').length, 1)
  await g.call('generate', { nodeId: 'n', modelId: 'm' }, context, authorized)
  await g.call('generate_now', { nodeId: 'n' }, context, authorized)
  assert.equal(f.calls.filter(c => c.name === 'generate_now').length, 2)
})
test('accepted then lost response reconciles exact request and never resubmits across restart', async t => {
  const f = setup(t); let g = f.create(); f.mode('lost')
  const first = body(await g.call('upscale', { nodeId: 'n', options: { z: 1, a: [2, 3] } }, context, authorized))
  assert.equal(first._request.state, 'acknowledged'); g = f.create()
  const replay = body(await g.call('upscale', { options: { a: [2, 3], z: 1 }, nodeId: 'n' }, context, authorized))
  assert.equal(first._request.requestId, replay._request.requestId)
  assert.equal(f.calls.filter(c => c.name === 'upscale').length, 1)
})
for (const mode of ['unknown', 'not_found', 'mismatch']) test(`${mode} cannot be bypassed by new ID, params, quote or unrelated node status`, async t => {
  const f = setup(t); let g = f.create(); f.mode(mode)
  const initial = body(await g.call('upscale', { nodeId: 'n', requestId: 'original' }, context, authorized))
  assert.equal(initial.status, 'unknown'); g = f.create()
  await g.call('get_generation_status', { nodeId: 'n' }, context, authorized)
  for (const [name, args] of [['upscale', { nodeId: 'n', requestId: 'new' }], ['generate', { nodeId: 'n', modelId: 'new' }]] as const) {
    assert.equal(body(await g.call(name, args, { ...context, project: '/other' }, authorized)).requestId, 'original')
  }
  assert.equal(f.calls.filter(c => paid.includes(c.name)).length, 1)
  assert.ok(!readFileSync(join(f.dir, 'bizone-generation-intents.json'), 'utf8').includes('secret-value'))
})
test('group unknown blocks nodes and node unknown blocks batch operations', async t => {
  const f = setup(t), g = f.create(); f.mode('unknown')
  await g.call('run_group', { groupId: 'g' }, context, authorized)
  assert.equal(body(await g.call('upscale', { nodeId: 'n' }, context, authorized)).status, 'unknown')
  assert.equal(f.calls.filter(c => paid.includes(c.name)).length, 1)
})
test('acknowledged direct operations default to replay but explicit new identity permits legitimate next run', async t => {
  const f = setup(t), g = f.create()
  await g.call('matting', { nodeId: 'n' }, context, authorized)
  await g.call('matting', { nodeId: 'n' }, context, authorized)
  await g.call('matting', { nodeId: 'n', requestId: 'second-run' }, context, authorized)
  assert.equal(f.calls.filter(c => c.name === 'matting').length, 2)
  assert.equal(body(await g.call('matting', { nodeId: 'other', requestId: 'second-run' }, context, authorized)).status, 'request_id_conflict')
})
test('all nine official operations supported with IDs; autoConfirm is one protected call', async t => {
  const f = setup(t), g = f.create()
  await g.call('generate', { nodeId: 'n' }, context, authorized)
  for (const name of paid) await g.call(name, { nodeId: 'n', ...(name === 'generate' ? { autoConfirm: true } : {}) }, context, authorized)
  assert.ok(paid.every(name => f.calls.some(c => c.name === name && c.args.requestId)))
  assert.equal(f.calls.filter(c => c.name === 'generate_now').length, 1)
})
test('legacy upstream only blocks paid; reverse_prompt_text remains usable', async t => {
  const f = setup(t), g = f.create(); f.legacy()
  assert.equal(body(await g.call('upscale', { nodeId: 'n' }, context, authorized)).status, 'unsupported')
  await g.call('reverse_prompt_text', { nodeId: 'n' }, context, authorized)
  assert.deepEqual(f.calls.map(c => c.name), ['reverse_prompt_text'])
})
test('concurrent sessions dispatch once and both durable ledgers precede submission', async t => {
  const f = setup(t), g = f.create()
  f.observe((name) => { if (name !== 'upscale') return
    assert.equal(JSON.parse(readFileSync(join(f.dir, 'bizone-generation-intents.json'), 'utf8')).intents[0].state, 'submitting')
    assert.equal(JSON.parse(readFileSync(join(f.dir, 'capability-requests/journal.json'), 'utf8')).entries[0].state, 'submitting')
  })
  await Promise.all([g.call('upscale', { nodeId: 'n' }, context, authorized), g.call('upscale', { nodeId: 'n' }, { ...context, agentSessionId: 'two' }, authorized)])
  assert.equal(f.calls.filter(c => c.name === 'upscale').length, 1)
})
test('lost or legacy intent index fails closed without replacement identities', async t => {
  const f = setup(t), g = f.create(); await g.call('upscale', { nodeId: 'n' }, context, authorized)
  rmSync(join(f.dir, 'bizone-generation-intents.json')); assert.throws(() => f.create(), /unreadable/)
  writeFileSync(join(f.dir, 'bizone-generation-intents.json'), JSON.stringify({ version: 1, intents: [] })); assert.throws(() => f.create(), /unreadable/)
})
test('failed new quote retires previous prepared authorization', async t => {
  const f = setup(t), g = f.create()
  const quote = body(await g.call('generate', { nodeId: 'n', modelId: 'm' }, context, authorized)); f.mode('quote_error')
  await g.call('generate', { nodeId: 'n', modelId: 'bad' }, context, authorized)
  assert.equal(body(await g.call('generate_now', { nodeId: 'n', easOperationId: quote.easOperationId }, context, authorized)).status, 'not_prepared')
})
test('invalid IDs and non-JSON inputs never dispatch, authorization is rechecked after queueing', async t => {
  const f = setup(t), g = f.create()
  for (const requestId of ['', null, 3, 'x'.repeat(129)]) assert.equal(body(await g.call('upscale', { nodeId: 'n', requestId }, context, authorized)).status, 'invalid_request_id')
  assert.equal(body(await g.call('upscale', { nodeId: 'n', x: Infinity }, context, authorized)).status, 'invalid_arguments')
  let valid = true
  const pending = g.call('upscale', { nodeId: 'n' }, context, () => { if (!valid) throw new Error('revoked') }); valid = false
  await assert.rejects(pending, /revoked/); assert.equal(f.calls.length, 0)
})
test('explicit execution ID followed by default retry reuses the same quote execution', async t => {
  const f = setup(t), g = f.create()
  await g.call('generate', { nodeId: 'n', requestId: 'quote' }, context, authorized)
  await g.call('generate_now', { nodeId: 'n', requestId: 'custom-execution' }, context, authorized)
  const retry = body(await g.call('generate_now', { nodeId: 'n' }, context, authorized))
  assert.equal(retry._request.requestId, 'custom-execution')
  assert.equal(f.calls.filter(c => c.name === 'generate_now').length, 1)
})
test('overlapping node unknown prevents a global batch; unrelated single node remains usable', async t => {
  const f = setup(t), g = f.create(); f.mode('unknown')
  await g.call('upscale', { nodeId: 'n' }, context, authorized)
  assert.equal(body(await g.call('batch_upscale', { groupId: 'g' }, context, authorized)).status, 'unknown')
  f.mode('normal')
  await g.call('upscale', { nodeId: 'other' }, context, authorized)
  assert.equal(f.calls.filter(c => c.name === 'upscale').length, 2)
})
test('matching digest alone cannot reconcile a different upstream tool or request identity', async t => {
  const f = setup(t), g = f.create(); f.mode('unknown')
  await g.call('upscale', { nodeId: 'n', requestId: 'one' }, context, authorized)
  const original = f.records.get('one')
  f.records.set('one', { ...original, tool: 'matting', state: 'acknowledged' })
  assert.equal(body(await g.call('upscale', { nodeId: 'n' }, context, authorized)).status, 'unknown')
  f.records.set('one', { ...original, requestId: 'other', state: 'acknowledged' })
  assert.equal(body(await g.call('upscale', { nodeId: 'n' }, context, authorized)).status, 'unknown')
  assert.equal(f.calls.filter(c => c.name === 'upscale').length, 1)
})
test('legacy catalog permits ordinary free quotes without minting execution identity', async t => {
  const f = setup(t), g = f.create(); f.legacy()
  const result = body(await g.call('generate', { nodeId: 'n', autoConfirm: false, modelId: 'm' }, context, authorized))
  assert.equal(result.easOperationId, undefined)
  assert.equal(f.calls[0].args.requestId, undefined)
  assert.equal(f.calls[0].args.autoConfirm, false)
  assert.equal(body(await g.call('generate_now', { nodeId: 'n' }, context, authorized)).status, 'not_prepared')
  for (const autoConfirm of [true, 'true', 1]) assert.equal(body(await g.call('generate', { nodeId: 'n', autoConfirm }, context, authorized)).status, 'unsupported')
  assert.equal(f.calls.filter(c => c.name === 'generate').length, 1)
})
test('failed legacy replacement quote retires prior protected quote across restart and replay', async t => {
  const f = setup(t); let g = f.create()
  const original = body(await g.call('generate', { nodeId: 'n', modelId: 'm', requestId: 'original-quote' }, context, authorized))
  f.legacy(); f.mode('quote_error')
  await g.call('generate', { nodeId: 'n', modelId: 'invalid', autoConfirm: false }, context, authorized)
  g = f.create()
  await g.call('generate', { nodeId: 'n', modelId: 'm', requestId: 'original-quote' }, context, authorized)
  assert.equal(body(await g.call('generate_now', { nodeId: 'n', easOperationId: original.easOperationId }, context, authorized)).status, 'not_prepared')
  assert.equal(f.calls.filter(c => c.name === 'generate_now').length, 0)
})
