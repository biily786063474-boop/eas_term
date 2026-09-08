import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBizoneConnector, type BizoneClient } from './bizoneConnector.ts'
import type { CapabilityContext } from './capabilitySessions.ts'

const context = {} as CapabilityContext
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
function fixture() {
  const clients: Array<Omit<BizoneClient, 'alive'> & { alive: boolean; calls: number; closes: number }> = []
  const revisions: Array<string | undefined> = []
  let revision = 'one'
  let starts = 0
  let failInitialize = false
  let request: () => Promise<unknown> = async () => ({ content: [] })
  const connector = createBizoneConnector({
    version: '1.0',
    backend: { ensureRunning: async () => { starts++; return { revision } } },
    createClient: rev => {
      revisions.push(rev)
      const client = {
        alive: true, calls: 0, closes: 0,
        initialize: async (version: string) => {
          assert.equal(version, '1.0')
          if (failInitialize) throw new Error('handshake failed')
        },
        listTools: async () => [{ name: 'generate', inputSchema: { type: 'object' } }],
        request: async (method: string, params: unknown) => {
          assert.equal(method, 'tools/call')
          assert.deepEqual(params, { name: 'generate', arguments: { prompt: 'test' } })
          client.calls++
          return request()
        },
        close: () => { client.closes++; client.alive = false }
      }
      clients.push(client)
      return client
    }
  })
  return { connector, clients, revisions, starts: () => starts,
    revision: (value: string) => { revision = value },
    failInitialize: (value: boolean) => { failInitialize = value },
    request: (value: () => Promise<unknown>) => { request = value },
    call: () => connector.call('generate', { prompt: 'test' }, context, () => {}) }
}

test('parallel catalogs share one official client without starting backend', async () => {
  const f = fixture()
  const lists = await Promise.all([f.connector.tools(), f.connector.tools(), f.connector.tools()])
  assert.equal(f.clients.length, 1)
  assert.equal(f.starts(), 0)
  assert.deepEqual(lists[0], [{ name: 'generate', inputSchema: { type: 'object' } }])
  f.connector.close()
})

test('request accepted then disconnected is never replayed', async () => {
  const f = fixture()
  f.request(async () => { throw new Error('accepted then disconnected') })
  await assert.rejects(f.call(), /accepted then disconnected/)
  assert.equal(f.clients.reduce((sum, client) => sum + client.calls, 0), 1)
  assert.equal(f.starts(), 1)
  f.connector.close()
})

test('revision change closes old client only after its active call settles', async () => {
  const f = fixture()
  const entered = deferred()
  const release = deferred()
  f.request(async () => { entered.resolve(); await release.promise; return 'first' })
  const first = f.call()
  await entered.promise
  f.revision('two')
  const second = f.call()
  assert.equal(f.clients[0].closes, 0)
  f.request(async () => 'second')
  release.resolve()
  assert.equal(await first, 'first')
  assert.equal(await second, 'second')
  assert.deepEqual(f.revisions, ['one', 'two'])
  assert.equal(f.clients[0].closes, 1)
  assert.equal(f.clients[1].calls, 1)
  f.connector.close()
})

test('catalog client is refreshed with authenticated endpoint before first call', async () => {
  const f = fixture()
  await f.connector.tools()
  await f.call()
  assert.deepEqual(f.revisions, [undefined, 'one'])
  assert.equal(f.clients[0].closes, 1)
  f.connector.close()
})

test('failed handshake is reclaimed and later catalog can initialize again', async () => {
  const f = fixture()
  f.failInitialize(true)
  await assert.rejects(f.connector.tools(), /handshake failed/)
  assert.equal(f.clients[0].closes, 1)
  f.failInitialize(false)
  assert.equal((await f.connector.tools())[0].name, 'generate')
  assert.equal(f.clients.length, 2)
  f.connector.close()
})

test('close rejects new and queued work but lets active call finish', async () => {
  const f = fixture()
  const entered = deferred()
  const release = deferred()
  f.request(async () => { entered.resolve(); await release.promise; return 'done' })
  const active = f.call()
  await entered.promise
  const queued = f.call()
  const rejected = assert.rejects(queued, /closed/)
  f.connector.close()
  f.connector.close()
  await assert.rejects(f.connector.tools(), /closed/)
  await assert.rejects(f.call(), /closed/)
  assert.equal(f.clients[0].closes, 0)
  release.resolve()
  assert.equal(await active, 'done')
  await rejected
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.clients[0].closes, 1)
  assert.equal(f.starts(), 1)
})

test('dead client is reinitialized on next request without replaying previous request', async () => {
  const f = fixture()
  await f.call()
  f.clients[0].alive = false
  await f.call()
  assert.equal(f.clients.length, 2)
  assert.equal(f.clients[0].closes, 1)
  assert.equal(f.clients[0].calls, 1)
  assert.equal(f.clients[1].calls, 1)
  f.connector.close()
})

test('backend dependency failure prevents any request submission', async () => {
  let creates = 0
  const connector = createBizoneConnector({
    version: '1.0',
    backend: { ensureRunning: async () => { throw new Error('not authenticated') } },
    createClient: () => { creates++; throw new Error('must not spawn') }
  })
  await assert.rejects(connector.call('generate', {}, context, () => {}), /not authenticated/)
  assert.equal(creates, 0)
  connector.close()
})

test('revoked authorization while queued prevents submission', async () => {
  const f = fixture()
  const entered = deferred()
  const release = deferred()
  f.request(async () => { entered.resolve(); await release.promise })
  const first = f.call()
  await entered.promise
  let authorized = true
  const second = f.connector.call('generate', { prompt: 'test' }, context, () => {
    if (!authorized) throw new Error('revoked')
  })
  const rejected = assert.rejects(second, /revoked/)
  authorized = false
  release.resolve()
  await first
  await rejected
  assert.equal(f.clients.reduce((sum, client) => sum + client.calls, 0), 1)
  f.connector.close()
})

test('revoked authorization during backend startup prevents submission', async () => {
  const entered = deferred()
  const release = deferred()
  let authorized = true
  let requests = 0
  const connector = createBizoneConnector({
    version: '1.0',
    backend: { ensureRunning: async () => { entered.resolve(); await release.promise; return { revision: 'one' } } },
    createClient: () => ({
      alive: true, initialize: async () => {}, listTools: async () => [], close: () => {},
      request: async () => { requests++; return {} }
    })
  })
  const call = connector.call('generate', {}, context, () => {
    if (!authorized) throw new Error('revoked')
  })
  const rejected = assert.rejects(call, /revoked/)
  await entered.promise
  authorized = false
  release.resolve()
  await rejected
  assert.equal(requests, 0)
  connector.close()
})
