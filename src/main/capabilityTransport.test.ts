import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
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
