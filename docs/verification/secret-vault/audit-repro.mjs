// Read-only source audit. All stores, credentials, Electron APIs and endpoints are fixtures.
// Successful assertions CONFIRM CURRENT DEFECTS; this is not a security acceptance suite.
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
  let item = save('Group A', 'DEMO_A')
  const token = api.issueSecretToken('fixture-pty', ['Group A'])
  assert.equal(fetchVars(token, ['DEMO_A']).ok, true)

  api.grantGroupToPty(undefined, 'Group A')
  assert.equal(fetchVars(undefined, ['DEMO_A']).ok, false)
  record('missing-session-token', 'Grant without PTY identity is a silent no-op; retrieval is denied.')

  assert.equal(call('save', { name: 'New request', vars: [{ varName: 'DEMO_A', value: 'fixture-retyped' }] }).ok, false)
  record('existing-secret-create-conflict', 'The create payload used by request_secret is rejected for an existing variable.')

  assert.equal(call('save', { id: item.id, name: 'Renamed A', vars: [{ varName: 'DEMO_A', from: 'DEMO_A' }] }).ok, true)
  assert.equal(fetchVars(token, ['DEMO_A']).ok, false)
  record('rename-breaks-grant', 'Renaming the same stored ID breaks its existing name-based grant.')

  save('Group A', 'DEMO_RECREATED')
  assert.equal(fetchVars(token, ['DEMO_RECREATED']).ok, true)
  record('old-name-inherits-grant', 'A newly created group using the old name inherits access without a new grant.')
  const duplicate = save('Group A', 'DEMO_DUPLICATE')
  assert.equal(fetchVars(token, ['DEMO_DUPLICATE']).ok, true)
  record('duplicate-name-widens-grant', 'Different IDs can share a name; existing name grant covers the new ID.')
  assert.equal(call('remove', duplicate.id).ok, true)
  save('Group A', 'DEMO_AFTER_DELETE')
  assert.equal(fetchVars(token, ['DEMO_AFTER_DELETE']).ok, true)
  record('delete-recreate-inherits-grant', 'Deleting a group does not revoke its name; replacement is accessible.')

  assert.equal(fetchVars(token, ['DEMO_AFTER_DELETE', 'DEMO_MISSING']).ok, true)
  record('partial-selection-success', 'One present plus one missing variable yields ok:true with an incomplete environment.')

  fs.writeFileSync(path.join(dir, 'fixture.pem'), 'NOT A REAL PRIVATE KEY\n')
  assert.equal((await call('pickKeyFile')).ok, true)
  assert.equal(call('commitKeyFile', { groupName: 'File group', varName: 'DEMO_FILE' }).ok, true)
  const fileItem = call('list').find(x => x.name === 'File group')
  assert.ok(fileItem.vars[0].file)
  assert.equal(call('save', { id: fileItem.id, name: fileItem.name, vars: [{ varName: 'DEMO_FILE', from: 'DEMO_FILE' }] }).ok, true)
  assert.equal(call('list').find(x => x.id === fileItem.id).vars[0].file, undefined)
  assert.ok(api.secretsEnv().DEMO_FILE)
  record('file-kind-lost-on-save', 'Generic save loses the file marker even when preserving ciphertext; auto injection then exposes it as text env.')

  api.noteInjected('fixture-pty', ['DEMO_AFTER_DELETE'])
  call('lock')
  assert.equal(api.secretsHas(['DEMO_AFTER_DELETE'], 'fixture-pty')[0].inThisTerminal, true)
  assert.equal(fetchVars(token, ['DEMO_AFTER_DELETE']).ok, false)
  record('lock-does-not-revoke-env', 'Lock blocks new wrapper retrieval but injected-name readiness stays true.')
  assert.equal(call('unlock', '482619').ok, true)
  api.forgetPty('fixture-pty')
  assert.equal(fetchVars(token, ['DEMO_AFTER_DELETE']).ok, false)
  record('existing-pty-revocation-control', 'Control: explicit forgetPty does revoke the token.')

  fs.writeFileSync(path.join(dir, 'secrets.json'), '{broken-json')
  assert.equal(call('status').configured, false)
  assert.equal(call('setup', '482619').ok, true)
  assert.deepEqual(Array.from(call('list')), [])
  record('corrupt-store-treated-as-empty', 'Corrupt JSON is reported as unconfigured; setup overwrites it with an empty store.')

  const fixtureValue = 'audit-only-' + 'not-a-real-key'
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, env: { DEMO_WRAPPER: fixtureValue } }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'mcp/eas-secret.mjs'), 'run', '--vars', 'DEMO_WRAPPER', '--', process.execPath, '-e', 'process.stdout.write(process.env.DEMO_WRAPPER)'], {
      env: { PATH: '/usr/bin:/bin', HOME: dir, EAS_TERM_PORT: String(server.address().port), EAS_TERM_TOKEN: 'fixture', EAS_SECRET_TOKEN: 'fixture' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''; child.stdout.on('data', b => { out += b }); child.stderr.resume()
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out) : reject(new Error('Fixture wrapper exit ' + code)))
  })
  assert.equal(output, fixtureValue)
  record('wrapper-output-not-confined', 'The actual wrapper forwards a child printing its injected value to stdout. Output captured only in fixture memory.')
  const result = { baseline: 'ae8392d', kind: 'Defect reproductions, NOT acceptance tests', isolation: 'Mock Electron + temporary fake store + loopback fake endpoint; no production keys, no model calls.', observations }
  fs.writeFileSync(path.join(root, 'docs/verification/secret-vault/audit-results.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (server) await new Promise(r => server.close(r))
  for (const timer of timers) clearTimeout(timer)
  fs.rmSync(dir, { recursive: true, force: true })
}
