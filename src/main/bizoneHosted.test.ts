import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBizoneHosted } from './bizoneHosted.ts'
import type { McpClientOpts } from './mcpClient.ts'

test('trusted host catalogs without GUI and rotates official client before calls with restricted env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bizone-host-'))
  const clients: McpClientOpts[] = []
  let starts = 0, closes = 0, calls = 0
  const server = '/Applications/笔纵 画板.app/Contents/Resources/app/electron/mcpServer.js'
  const host = createBizoneHosted({ appOwnedDataDir: root, version: 'test',
    runtime: { installed: () => ({ app: '/app', executable: '/exe', server }), tokenFile: '/private/token.json',
      ensureRunning: async () => { starts++; return { revision: 'new-token' } } },
    runner: args => ({ command: '/bundled/electron', args, env: { ELECTRON_RUN_AS_NODE: '1' } }),
    client: opts => { clients.push(opts); return {
      alive: true, initialize: async () => {}, listTools: async () => [{ name: 'list_nodes' }],
      request: async () => { calls++; return { content: [] } }, close: () => { closes++ }
    } }
  })
  try {
    await host.tools()
    assert.equal(starts, 0)
    assert.deepEqual(clients[0].args, [server])
    assert.equal(clients[0].env.ELECTRON_RUN_AS_NODE, '1')
    assert.equal(clients[0].env.TAPTV_TOKEN_FILE, '/private/token.json')
    assert.equal(clients[0].env.EAS_CAPABILITY_LEASE, undefined)
    assert.equal(clients[0].env.EAS_TERM_TOKEN, undefined)
    await host.call('list_nodes', {}, {}, () => {})
    assert.equal(starts, 1)
    assert.equal(clients.length, 2)
    assert.equal(closes, 1)
    assert.equal(calls, 1)
  } finally { host.close(); await new Promise(resolve => setImmediate(resolve)); fs.rmSync(root, { recursive: true, force: true }) }
})

test('missing installation fails catalog without spawning an unverified executable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bizone-host-'))
  const host = createBizoneHosted({ appOwnedDataDir: root, version: 'test',
    runtime: { installed: () => undefined, tokenFile: '/none', ensureRunning: async () => { throw new Error('must not launch') } },
    client: () => { throw new Error('must not spawn') }
  })
  try { await assert.rejects(host.tools(), { code: 'BIZONE_MISSING' }) }
  finally { host.close(); await new Promise(resolve => setImmediate(resolve)); fs.rmSync(root, { recursive: true, force: true }) }
})

test('first catalog awaits asynchronous protocol discovery before constructing official client', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bizone-host-'))
  let discovered = false, created = 0
  const host = createBizoneHosted({ appOwnedDataDir: root, version: 'test',
    runtime: { installed: () => discovered ? { app: '/app', executable: '/exe', server: '/app/mcpServer.js' } : undefined,
      tokenFile: '/token', refreshInstallation: async () => { await new Promise(resolve => setImmediate(resolve)); discovered = true },
      ensureRunning: async () => ({ revision: 'test' }) },
    client: () => { created++; return { alive: true, initialize: async () => {}, listTools: async () => [], request: async () => ({}), close: () => {} } }
  })
  try { await host.tools(); assert.equal(created, 1) }
  finally { host.close(); await new Promise(resolve => setImmediate(resolve)); fs.rmSync(root, { recursive: true, force: true }) }
})
