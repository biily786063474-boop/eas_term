import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { CapabilitySessions } from './capabilitySessions.ts'
import { BuiltinCapabilityHost, type BuiltinHosted } from './builtinCapabilityHost.ts'
import { HostRegistry } from './hostRegistry.ts'
import { McpClient } from './mcpClient.ts'

// Execute the actual gateway route against real Node HTTP and stdio transports.
const source = ts.createSourceFile('mcpBridge.ts', readFileSync(new URL('./mcpBridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
let route: ts.IfStatement | undefined
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source).includes("req.url === '/capability/rpc'")) route = node
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(route)
const code = ts.transpileModule('async function handle(req, res) { const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)) }; try {' + route.getText(source) + '} catch(error) { send(500, {ok:false,error:error.message}) } }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

async function fixture(legacyOptOut = false) {
  const sessions = new CapabilitySessions('test-instance', 'test-generation')
  const registry = new HostRegistry<BuiltinHosted>({ graceMs: 0, setTimer: fn => setTimeout(fn, 0), clearTimer: id => clearTimeout(id as NodeJS.Timeout), onIdle: (_key, service) => service.close() })
  const host = new BuiltinCapabilityHost(registry)
  let calls = 0
  const migrated: (string | undefined)[] = []
  host.register('workbench', () => ({ kind: 'builtin', tools: async () => [{ name: 'where', inputSchema: { type: 'object' } }], call: async (_name, _args, ctx) => { calls++; return { content: [{ type: 'text', text: JSON.stringify(ctx) }] } }, close() {} }))
  const handler = runInNewContext(code + '\nhandle', { capabilitySessions: sessions, builtinCapabilityHost: host, capabilityMigrationService: () => ({ onSuccessfulWorkbenchCall: (project: string | undefined) => migrated.push(project) }), mcpEnabled: true, shouldAutoInstall: () => !legacyOptOut, readOptOut: () => legacyOptOut, capabilityPreferences: () => ({ preferences: { workbench: true, bizone: true } }), app: { getVersion: () => 'test' }, readBody: (req: http.IncomingMessage) => new Promise<string>(resolve => { let text = ''; req.on('data', chunk => { text += chunk }); req.on('end', () => resolve(text)) }) })
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return { sessions, host, port, calls: () => calls, migrated, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
test('explicit module re-enable is not blocked by the migrated legacy opt-out marker', async () => {
  const f = await fixture(true)
  const lease = f.sessions.issue({ agentSessionId: 'reenabled' })
  try {
    const response = await fetch('http://127.0.0.1:' + f.port + '/capability/rpc', { method: 'POST', headers: { 'x-eas-capability': JSON.stringify(lease) }, body: JSON.stringify({ module: 'workbench', connectionId: 'new', method: 'tools/call', params: { name: 'where' } }) })
    assert.equal(response.status, 200)
    assert.equal(f.calls(), 1)
  } finally { f.host.releaseSession(lease.id); await f.close() }
})

test('real scoped stdio handshake and HTTP call bind owning session; external process exposes no tools', async () => {
  const f = await fixture()
  const lease = f.sessions.issue({ project: '/项目 空格', agentSessionId: 'chat-a', agentLeafId: 'leaf-a' })
  const create = (env: Record<string, string>) => new McpClient({ name: 'capability-transport-test', command: process.execPath, args: [fileURLToPath(new URL('../../mcp/eas-capability-shim.mjs', import.meta.url))], cwd: process.cwd(), env })
  const managed = create({ EAS_TERM_PORT: String(f.port), EAS_CAPABILITY_MODULE: 'workbench', EAS_CAPABILITY_LEASE: JSON.stringify(lease) })
  const external = create({})
  try {
    await managed.initialize('test')
    assert.equal((await managed.listTools()).length, 1)
    const result = await managed.request('tools/call', { name: 'where', arguments: { ctx: { project: '/forged' } } }) as { content: { text: string }[] }
    assert.deepEqual(JSON.parse(result.content[0].text), { project: '/项目 空格', agentSessionId: 'chat-a', agentLeafId: 'leaf-a' })
    assert.deepEqual(f.migrated, ['/项目 空格'], 'migration uses the authenticated lease project, never caller arguments')
    f.sessions.revoke(lease.id)
    await assert.rejects(managed.request('tools/call', { name: 'where', arguments: {} }))
    assert.equal(f.calls(), 1)
    await external.initialize('test')
    assert.deepEqual(await external.listTools(), [])
  } finally { managed.close(); external.close(); f.host.releaseSession(lease.id); await f.close() }
})

test('revocation while an HTTP request body is arriving prevents tool dispatch', async () => {
  const f = await fixture()
  const lease = f.sessions.issue({ project: '/project' })
  try {
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: f.port, path: '/capability/rpc', method: 'POST', headers: { 'x-eas-capability': JSON.stringify(lease), 'content-type': 'application/json' } }, res => { let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, body })) })
      req.on('error', reject)
      req.write('{"module":"workbench",')
      setTimeout(() => { f.sessions.revoke(lease.id); req.end('"connectionId":"test","method":"tools/call","params":{"name":"where"}}') }, 25)
    })
    const result = await response
    assert.notEqual(result.status, 200)
    assert.equal(f.calls(), 0)
  } finally { await f.close() }
})

test('unavailable optional Bizone does not fail stdio discovery; failure stays visible and calls stay rejected', async () => {
  const f = await fixture()
  let available = false
  let toolCalls = 0
  f.host.register('bizone', () => ({
    kind: 'builtin',
    tools: async () => {
      if (!available) throw Object.assign(new Error('未找到已验证的笔纵画板应用及正式 MCP 依赖'), { code: 'BIZONE_MISSING' })
      return [{ name: 'generate', inputSchema: { type: 'object' } }]
    },
    call: async () => { toolCalls++; return {} },
    close() {}
  }))
  const lease = f.sessions.issue({ agentSessionId: 'optional-missing' })
  const client = new McpClient({
    name: 'optional-bizone', command: process.execPath,
    args: [fileURLToPath(new URL('../../mcp/eas-capability-shim.mjs', import.meta.url))],
    cwd: process.cwd(),
    env: { EAS_TERM_PORT: String(f.port), EAS_CAPABILITY_MODULE: 'bizone', EAS_CAPABILITY_LEASE: JSON.stringify(lease) }
  })
  try {
    await client.initialize('test')
    assert.deepEqual(await client.listTools(), [])
    assert.equal(f.host.status('bizone').session, 'failed', 'empty discovery must not pretend the backend is ready')
    await assert.rejects(client.request('tools/call', { name: 'generate', arguments: {} }), /未找到/)
    assert.equal(toolCalls, 0, 'never dispatch or retry generation when unavailable')
    available = true
    assert.equal((await client.listTools()).length, 1, 'a later explicit discovery can recover without a sticky disabled flag')
    assert.equal(f.host.status('bizone').session, 'ready')
    f.sessions.revoke(lease.id)
    await assert.rejects(client.listTools(), /授权/, 'revoked authority must not be converted to empty success')
  } finally {
    client.close()
    f.host.releaseSession(lease.id)
    await f.close()
  }
})

test('required workbench discovery errors are not swallowed by optional Bizone fallback', async () => {
  const f = await fixture()
  const lease = f.sessions.issue({ agentSessionId: 'required-error' })
  try {
    const original = f.host.list.bind(f.host)
    f.host.list = async (module, ...args) => {
      if (module === 'workbench') throw new Error('workbench failed')
      return original(module, ...args)
    }
    const response = await fetch('http://127.0.0.1:' + f.port + '/capability/rpc', {
      method: 'POST', headers: { 'x-eas-capability': JSON.stringify(lease) },
      body: JSON.stringify({ module: 'workbench', connectionId: 'required', method: 'initialize' })
    })
    assert.equal(response.status, 500)
  } finally { f.host.releaseSession(lease.id); await f.close() }
})


test('real bundled OMP answers with missing Bizone through actual shim and gateway (local fixture model)', {
  skip: !process.env.EAS_VERIFY_REAL_OMP, timeout: 45_000
}, async () => {
  const f = await fixture()
  f.host.register('bizone', () => ({
    kind: 'builtin', tools: async () => { throw new Error('未找到已验证的笔纵画板应用及正式 MCP 依赖') },
    call: async () => { throw new Error('must never generate') }, close() {}
  }))
  const profile = mkdtempSync(path.join(os.tmpdir(), 'eas-omp-optional-'))
  const agent = path.join(profile, 'agent')
  mkdirSync(agent)
  let requests = 0
  const model = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      requests++
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const delta of [{ role: 'assistant', content: 'OPTIONAL_MCP_CHAT_OK' }, {}]) {
        res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1,
          model: 'fixture', choices: [{ index: 0, delta, finish_reason: delta.role ? null : 'stop' }] }) + '\n\n')
      }
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  const modelPort = (model.address() as { port: number }).port
  writeFileSync(path.join(agent, 'models.yml'), JSON.stringify({ providers: { fixture: {
    baseUrl: 'http://127.0.0.1:' + modelPort + '/v1', api: 'openai-completions', apiKey: 'local-fixture-only',
    models: [{ id: 'fixture', name: 'Fixture', api: 'openai-completions', reasoning: false,
      input: ['text'], contextWindow: 32000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]
  } } }))
  writeFileSync(path.join(agent, 'config.yml'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', tools: { approvalMode: 'yolo' } }))
  const lease = f.sessions.issue({ agentSessionId: 'real-omp', project: profile })
  const client = new McpClient({
    name: 'real-omp-optional', command: path.resolve(process.env.EAS_VERIFY_REAL_OMP!), args: ['acp', '--tools=read'],
    cwd: profile, env: { HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile,
      TEMP: profile, TMP: profile, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
      PATH: process.env.PATH ?? '', PI_CODING_AGENT_DIR: agent,
      PI_CONFIG_DIR: '.pi', OMP_SKIP_SETUP: '1' }
  })
  const exited = new Promise<void>(resolve => { client.onExit = () => resolve() })
  let answer = ''
  client.onNotification = (method, params) => {
    const event = params as { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } }
    if (method === 'session/update' && event.update?.sessionUpdate === 'agent_message_chunk' && event.update.content?.type === 'text') answer += event.update.content.text ?? ''
  }
  try {
    await client.request('initialize', { protocolVersion: 1, clientInfo: { name: 'Eas-Term-test', version: '1' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
    const session = await client.request('session/new', { cwd: profile, mcpServers: [{
      name: 'bizone-canvas', command: process.execPath,
      args: [fileURLToPath(new URL('../../mcp/eas-capability-shim.mjs', import.meta.url))],
      env: Object.entries({ EAS_TERM_PORT: String(f.port), EAS_CAPABILITY_MODULE: 'bizone',
        EAS_CAPABILITY_LEASE: JSON.stringify(lease) }).map(([name, value]) => ({ name, value }))
    }] }, 30_000) as { sessionId: string }
    assert.ok(session.sessionId)
    assert.equal(f.host.status('bizone').session, 'failed')
    const response = await client.request('session/prompt', { sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Reply hello without tools.' }] }, 30_000) as { stopReason: string }
    assert.equal(response.stopReason, 'end_turn')
    assert.equal(answer, 'OPTIONAL_MCP_CHAT_OK', 'actual OMP response stream continues after optional MCP failure')
    assert.equal(requests, 1, 'normal chat reaches local model exactly once despite missing MCP')
  } finally {
    client.close()
    f.host.releaseSession(lease.id)
    await f.close()
    model.closeAllConnections()
    await new Promise<void>(resolve => model.close(() => resolve()))
    // Windows retains cwd/SQLite handles until the owned process actually exits.
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 3000))])
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})

test('optional discovery cannot return success after authority is revoked during catalog loading', async () => {
  const f = await fixture()
  const lease = f.sessions.issue({ agentSessionId: 'revoked-in-discovery' })
  f.host.register('bizone', () => ({
    kind: 'builtin',
    tools: async () => { f.sessions.revoke(lease.id); throw new Error('backend failed after revocation') },
    call: async () => ({}), close() {}
  }))
  try {
    const response = await fetch('http://127.0.0.1:' + f.port + '/capability/rpc', {
      method: 'POST', headers: { 'x-eas-capability': JSON.stringify(lease) },
      body: JSON.stringify({ module: 'bizone', connectionId: 'revoked', method: 'tools/list' })
    })
    assert.notEqual(response.status, 200)
    assert.equal((await response.json()).ok, false)
  } finally { f.host.releaseSession(lease.id); await f.close() }
})
