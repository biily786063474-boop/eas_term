import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBizoneRuntime, bizoneClientEnv } from './bizoneRuntime.ts'

function fixture() {
  let raw: string | undefined = JSON.stringify({ port: 13140, token: 'private-token' })
  let ready = true
  let time = 0
  let launches = 0
  const ports: number[] = []
  const runtime = createBizoneRuntime({
    platform: 'darwin', home: '/Users/Chinese Space 中文',
    exists: () => true,
    read: () => raw,
    probe: async port => { ports.push(port); return ready },
    launch: async (command, args, env) => {
      assert.equal(command, '/usr/bin/open')
      assert.deepEqual(args, ['-g', '-a', '/Applications/笔纵画板.app'])
      assert.equal(env.TAPTV_TOKEN, undefined)
      launches++
    },
    now: () => time, sleep: async ms => { time += ms }
  })
  return { runtime, ports, launches: () => launches,
    raw: (s: string | undefined) => { raw = s }, ready: (v: boolean) => { ready = v } }
}
test('discovery is lazy and ready backend needs no GUI launch', async () => {
  const f = fixture()
  assert.ok(f.runtime.installed()?.server.endsWith('/electron/mcpServer.js'))
  assert.equal(f.ports.length, 0)
  assert.equal(f.launches(), 0)
  const result = await f.runtime.ensureRunning()
  assert.equal(f.launches(), 0)
  assert.equal(result.revision.length, 64)
  assert.ok(!JSON.stringify(result).includes('private-token'))
})
test('rereads port and token and changes opaque endpoint revision', async () => {
  const f = fixture()
  const first = await f.runtime.ensureRunning()
  f.raw(JSON.stringify({ port: 13141, token: 'another-token' }))
  const second = await f.runtime.ensureRunning()
  assert.notEqual(first.revision, second.revision)
  assert.deepEqual(f.ports, [13140, 13141])
})
test('unready installed backend launches once then times out', async () => {
  const f = fixture(); f.ready(false)
  await assert.rejects(f.runtime.ensureRunning(), { code: 'BIZONE_TIMEOUT' })
  assert.equal(f.launches(), 1)
})
test('malformed and missing local authentication distinguish startup failures', async () => {
  const f = fixture(); f.raw('{invalid')
  await assert.rejects(f.runtime.ensureRunning(), { code: 'BIZONE_AUTH_INVALID' })
  f.raw(undefined)
  await assert.rejects(f.runtime.ensureRunning(), { code: 'BIZONE_AUTH_MISSING' })
})
test('missing installation including unverified Windows location is explicit', async () => {
  const runtime = createBizoneRuntime({ platform: 'win32', home: 'C:\\Users\\example', exists: () => true })
  assert.equal(runtime.installed(), undefined)
  await assert.rejects(runtime.ensureRunning(), { code: 'BIZONE_MISSING' })
})
test('client environment excludes inherited API keys and endpoint overrides', () => {
  const env = bizoneClientEnv('/safe/api-token.json', { HOME: '/safe', PATH: '/usr/bin', OPENAI_API_KEY: 'secret', TAPTV_TOKEN: 'secret', TAPTV_API: 'https://remote', EAS_TERM_TOKEN: 'secret' })
  assert.deepEqual(env, { HOME: '/safe', PATH: '/usr/bin', TAPTV_TOKEN_FILE: '/safe/api-token.json' })
})

test('startup rereads newly created credentials before probing', async () => {
  let raw: string | undefined
  let launches = 0
  let time = 0
  const runtime = createBizoneRuntime({ platform: 'darwin', exists: () => true, read: () => raw,
    now: () => time, sleep: async ms => { time += ms },
    launch: async () => { launches++; raw = JSON.stringify({ port: 14444, token: 'new' }) },
    probe: async port => port === 14444
  })
  assert.equal((await runtime.ensureRunning()).revision.length, 64)
  assert.equal(launches, 1)
})

test('missing official SDK prevents launch and launch errors are surfaced', async () => {
  const absent = createBizoneRuntime({ platform: 'darwin', exists: file => !file.includes('@modelcontextprotocol') })
  await assert.rejects(absent.ensureRunning(), { code: 'BIZONE_MISSING' })
  const failed = createBizoneRuntime({ platform: 'darwin', exists: () => true, read: () => undefined,
    launch: async () => { throw new Error('launch failed') }
  })
  await assert.rejects(failed.ensureRunning(), /launch failed/)
})

test('Windows waits for native protocol discovery before launching and refreshes a removed registration', async () => {
  const executable = 'D:\\中文 便携\\笔纵画板.exe'
  const info = { app: 'D:\\中文 便携', executable, server: 'D:\\中文 便携\\resources\\app\\electron\\mcpServer.js' }
  let registered = true, ready = false, time = 0, launched = 0
  const runtime = createBizoneRuntime({ platform: 'win32', exists: () => true,
    discover: async () => { await new Promise(resolve => setImmediate(resolve)); return registered ? info : undefined },
    read: () => JSON.stringify({ port: 13330, token: 'fixture' }),
    probe: async () => ready, now: () => time, sleep: async ms => { time += ms },
    launch: async (command, args) => { assert.equal(command, executable); assert.deepEqual(args, []); launched++; ready = true }
  })
  assert.equal(runtime.installed(), undefined)
  await runtime.ensureRunning()
  assert.equal(launched, 1)
  assert.equal(runtime.installed()?.executable, executable)
  registered = false
  await assert.rejects(runtime.ensureRunning(), { code: 'BIZONE_MISSING' })
  assert.equal(launched, 1)
})
