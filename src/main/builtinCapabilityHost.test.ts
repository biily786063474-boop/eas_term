import test from 'node:test'
import assert from 'node:assert/strict'
import { HostRegistry } from './hostRegistry.ts'
import { BuiltinCapabilityHost, type BuiltinHosted } from './builtinCapabilityHost.ts'

test('trusted services share lifecycle registry without claiming ordinary plugin names', async () => {
  const registry = new HostRegistry<BuiltinHosted | { kind: 'plugin' }>({ graceMs: 0, setTimer: fn => { queueMicrotask(fn); return 0 }, clearTimer() {}, onIdle: (_key, value) => { if (value.kind === 'builtin') value.close() } })
  registry.acquire('eas-term', 'panel:1', () => ({ kind: 'plugin' }))
  const host = new BuiltinCapabilityHost(registry)
  let creates = 0, closes = 0
  host.register('workbench', () => {
    creates++
    return { kind: 'builtin', tools: async () => [{ name: 'canvas_open_file' }], call: async (_name, _args, context) => context, close: () => { closes++ } }
  })
  assert.throws(() => host.register('workbench', () => { throw new Error('unreachable') }))
  const context = { project: '/项目 一', agentSessionId: 'chat-a' }
  await host.list('workbench', 'lease-a', 'connection-a')
  await host.list('workbench', 'lease-b', 'connection-b')
  assert.equal(creates, 1)
  assert.deepEqual(await host.call('workbench', 'lease-a', 'connection-a', 'canvas_open_file', { project: '/forged' }, context, () => {}), context)
  await assert.rejects(host.call('workbench', 'lease-a', 'connection-a', 'unknown', {}, context, () => {}))
  host.releaseSession('lease-a')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closes, 0)
  host.releaseSession('lease-b')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closes, 1)
  assert.equal(registry.get('eas-term')?.kind, 'plugin')
})

test('unregistered or caller-chosen module identifiers never become trusted services', async () => {
  const registry = new HostRegistry<BuiltinHosted>({ graceMs: 0, setTimer: () => 0, clearTimer() {}, onIdle() {} })
  const host = new BuiltinCapabilityHost(registry)
  await assert.rejects(host.list('eas-term', 'lease', 'connection'))
  await assert.rejects(host.list('__proto__', 'lease', 'connection'))
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
test('empty or failed tool catalogs are never reported ready, including a later call refresh', async () => {
  const registry = new HostRegistry<BuiltinHosted>({ graceMs: 0, setTimer: () => 0, clearTimer() {}, onIdle() {} })
  const host = new BuiltinCapabilityHost(registry)
  let available = false, calls = 0
  host.register('workbench', () => ({ kind: 'builtin', tools: async () => available ? [{ name: 'read' }] : [], call: async () => { calls++ }, close() {} }))
  await assert.rejects(host.list('workbench', 'lease', 'connection'), /工具目录为空/)
  assert.equal(host.status('workbench').session, 'failed')
  available = true
  await host.list('workbench', 'lease', 'connection')
  assert.equal(host.status('workbench').session, 'ready')
  available = false
  await assert.rejects(host.call('workbench', 'lease', 'connection', 'read', {}, {}, () => {}), /工具目录为空/)
  assert.equal(host.status('workbench').session, 'failed')
  assert.equal(calls, 0)
})
test('heartbeat expiry releases only abandoned connections, retaining in-flight work', async () => {
  let now = 0
  const timers: Array<() => void> = []
  let closed = 0
  const registry = new HostRegistry<BuiltinHosted>({ graceMs: 0, setTimer: fn => { timers.push(fn); return fn }, clearTimer() {}, onIdle: (_key, service) => service.close() })
  const host = new BuiltinCapabilityHost(registry, () => now)
  const done = deferred<unknown>(), started = deferred<void>()
  host.register('bizone', () => ({ kind: 'builtin', tools: async () => [{ name: 'generate' }], call: async () => { started.resolve(); return done.promise }, close: () => { closed++ } }))
  await host.list('bizone', 'lease', 'alive')
  const call = host.call('bizone', 'lease', 'abandoned', 'generate', {}, {}, () => {})
  await started.promise
  now = 40_000
  assert.equal(host.heartbeat('bizone', 'lease', 'alive'), true)
  now = 50_000
  host.sweep()
  assert.equal(host.heartbeat('bizone', 'lease', 'abandoned'), false)
  assert.equal(host.status('bizone').session, 'ready')
  host.releaseModule('lease', 'bizone', 'alive')
  for (const timer of timers.splice(0)) timer()
  assert.equal(closed, 0)
  done.resolve('receipt')
  assert.equal(await call, 'receipt')
  for (const timer of timers.splice(0)) timer()
  assert.equal(closed, 1)
  assert.equal(host.heartbeat('bizone', 'lease', 'alive'), false)
})
test('old close cannot release a newer connection, another module, or a running call', async () => {
  const closed: string[] = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const registry = new HostRegistry<BuiltinHosted>({ graceMs: 0, setTimer: fn => { const id = nextTimer++; timers.set(id, fn); return id }, clearTimer: id => { timers.delete(Number(id)) }, onIdle: (_key, service) => service.close() })
  const sweep = () => { for (const [id, timer] of timers) { timers.delete(id); timer() } }
  const host = new BuiltinCapabilityHost(registry)
  const done = deferred<unknown>()
  const started = deferred<void>()
  for (const module of ['workbench', 'bizone'] as const) host.register(module, () => ({ kind: 'builtin', tools: async () => [{ name: 'long' }], call: async () => { started.resolve(); return done.promise }, close: () => { closed.push(module) } }))
  await host.list('workbench', 'lease', 'old')
  await host.list('workbench', 'lease', 'new')
  await host.list('bizone', 'lease', 'bizone')
  assert.throws(() => host.releaseModule('lease', '', 'old'))
  assert.throws(() => host.releaseModule('lease', 'unknown', 'old'))
  host.releaseModule('lease', 'workbench', 'old')
  sweep()
  assert.deepEqual(closed, [])
  const running = host.call('workbench', 'lease', 'new', 'long', {}, {}, () => {})
  await started.promise
  host.releaseSession('lease')
  sweep()
  assert.deepEqual(closed, ['bizone'])
  done.resolve('ok')
  assert.equal(await running, 'ok')
  sweep()
  assert.deepEqual(closed, ['bizone', 'workbench'])
})

test('revocation while catalog loads prevents any tool dispatch', async () => {
  const registry = new HostRegistry<BuiltinHosted>({ graceMs: 0, setTimer: () => 0, clearTimer() {}, onIdle() {} })
  const host = new BuiltinCapabilityHost(registry)
  const catalog = deferred<{ name: string }[]>()
  let authorized = true, calls = 0
  host.register('workbench', () => ({ kind: 'builtin', tools: () => catalog.promise, call: async () => { calls++ }, close() {} }))
  const running = host.call('workbench', 'lease', 'connection', 'write', {}, {}, () => { if (!authorized) throw new Error('revoked') })
  authorized = false
  host.releaseSession('lease')
  catalog.resolve([{ name: 'write' }])
  await assert.rejects(running, /revoked/)
  assert.equal(calls, 0)
})
