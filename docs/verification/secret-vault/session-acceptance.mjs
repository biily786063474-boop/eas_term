// Session credential acceptance: fake store, real wrapper, loopback endpoint.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(import.meta.url)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-vault-audit-'))
const handlers = new Map(), timers = new Set(), observations = []
const mockElectron = {
  app: { isReady: () => true, getPath: () => dir, getName: () => 'AuditFixtureOnly' },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  // Fake codec, not an encryption test. Never touches system keychain or production userData.
  safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(dir, 'fixture.pem')] }) }
}
const bundle = await build({
  entryPoints: [path.join(root, 'src/main/secrets.ts')], bundle: true, platform: 'node',
  format: 'cjs', write: false, external: ['electron', './island'], logLevel: 'silent'
})
const mod = { exports: {} }
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, Buffer, process,
  console: { log() {}, error() {}, warn() {} },
  require: name => name === 'electron' ? mockElectron : name === './island' ? { isIslandWindow: () => false, mainWindow: () => null } : require(name),
  setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t }, clearTimeout
}, { filename: 'fixture-secrets.cjs' })
const api = mod.exports
const call = (name, ...args) => handlers.get('secrets:' + name)({}, ...args)
const save = (name, varName, extra = {}) => {
  assert.equal(call('save', { name, vars: [{ varName, value: 'fixture-only-' + varName }], ...extra }).ok, true)
  return call('list').find(x => x.vars.some(v => v.varName === varName))
}
const fetchVars = (token, vars) => api.secretsForRun({ vars }, { secretToken: token, mcpEnabled: true })
const record = (id, result) => observations.push({ id, reproduced: true, result })
let server
try {
  api.registerSecretHandlers()
  assert.equal(call('setup', '482619').ok, true)
  save('Automatic', 'DEMO_X', { autoInject: true })
  save('Approval', 'DEMO_Y', { autoInject: false })
  const token = api.issueSecretToken('agent-fixture', api.autoInjectGroups())
  assert.equal(call('has', ['DEMO_X'], 'agent-fixture').hasCredential, true)
  assert.equal(call('has', ['DEMO_X'], 'unknown').hasCredential, false)
  assert.equal(fetchVars(token, ['DEMO_Y']).ok, false)
  assert.equal(fetchVars(token, ['DEMO_X', 'MISSING']).ok, false)
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', b => { body += b })
    req.on('end', () => {
      const result = api.secretsForRun(JSON.parse(body), { secretToken: req.headers['x-eas-secret-token'], mcpEnabled: true })
      res.writeHead(result.ok ? 200 : 403, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  async function run(name) {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'mcp/eas-secret.mjs'), 'run', '--vars', name, '--', 'sh', '-c', 'eval "echo ${#' + name + '}"'], {
        env: { PATH: '/usr/bin:/bin', HOME: dir, EAS_TERM_PORT: String(server.address().port), EAS_TERM_TOKEN: 'fixture', EAS_SECRET_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''; child.stdout.on('data', b => { output += b }); child.stderr.resume()
      child.on('error', reject); child.on('exit', code => resolve({ code, output: output.trim() }))
    })
  }
  assert.deepEqual(await run('DEMO_X'), { code: 0, output: String('fixture-only-DEMO_X'.length) })
  assert.notEqual((await run('DEMO_Y')).code, 0)
  call('grantToPty', 'agent-fixture', 'Approval')
  assert.deepEqual(await run('DEMO_Y'), { code: 0, output: String('fixture-only-DEMO_Y'.length) })
  const newToken = api.issueSecretToken('agent-fixture', api.autoInjectGroups())
  api.forgetSecretToken(token)
  assert.equal(fetchVars(newToken, ['DEMO_X']).ok, true)
  assert.equal(fetchVars(token, ['DEMO_X']).ok, false)
  api.forgetPty('agent-fixture')
  assert.equal(fetchVars(newToken, ['DEMO_X']).ok, false)
  assert.throws(() => call('grantToPty', 'agent-fixture', 'Approval'))
  assert.ok(api.secretAudit().some(e => e.sessionKey === 'agent-fixture'))
  console.log('PASS: wrapper length, approval, missing vars fail-closed, token rotation, close revocation, stale grant rejection, metadata and session audit')
} finally {
  if (server) await new Promise(r => server.close(r))
  for (const timer of timers) clearTimeout(timer)
  fs.rmSync(dir, { recursive: true, force: true })
}
