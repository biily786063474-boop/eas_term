import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createOmpCapabilityPlugin } from './ompCapabilityPlugin.ts'
function fixture(t: { after: (fn: () => void) => void }) {
  const appOwnedRoot = realpathSync(mkdtempSync(join(tmpdir(), 'omp-plugin-')))
  t.after(() => rmSync(appOwnedRoot, { recursive: true, force: true }))
  return { appOwnedRoot, runner: { command: process.execPath, args: ['/app/shim.mjs'] }, enabled: { workbench: true, bizone: true }, version: '1.0.0' }
}
test('standard plugin root uses local executable, fixed names, and immutable reusable content', t => {
  const options = fixture(t)
  const result = createOmpCapabilityPlugin(options)
  assert.ok(result)
  const manifest = JSON.parse(readFileSync(join(result.root, 'plugin.json'), 'utf8'))
  assert.deepEqual(manifest, { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'eas-capabilities', version: '1.0.0' })
  const mcp = JSON.parse(readFileSync(join(result.root, 'mcp.json'), 'utf8'))
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
  assert.deepEqual(Object.keys(mcp.mcpServers), ['eas-term', 'bizone-canvas'])
  assert.deepEqual(mcp.mcpServers['eas-term'], { type: 'stdio', command: './runner', env: { EAS_CAPABILITY_MODULE: 'workbench' } })
  assert.equal(result.serverNames.bizone, 'eas-capabilities:bizone-canvas')
  assert.deepEqual(result.extensionArgs, ['-e', result.root])
  assert.deepEqual(createOmpCapabilityPlugin(options), result)
  assert.equal(readdirSync(join(options.appOwnedRoot, 'omp-capability-plugins')).length, 1)
  assert.equal(statSync(join(result.root, 'runner')).mode & 0o777, 0o500)
  chmodSync(join(result.root, 'mcp.json'), 0o600)
  writeFileSync(join(result.root, 'mcp.json'), '{}')
  assert.throws(() => createOmpCapabilityPlugin(options), /modified/)
})
test('module disable changes roots without touching previous snapshots; both disabled creates nothing', t => {
  const options = fixture(t)
  assert.equal(createOmpCapabilityPlugin({ ...options, enabled: { workbench: false, bizone: false } }), null)
  assert.deepEqual(readdirSync(options.appOwnedRoot), [])
  const first = createOmpCapabilityPlugin(options)
  const second = createOmpCapabilityPlugin({ ...options, enabled: { workbench: false, bizone: true } })
  assert.ok(first && second)
  assert.notEqual(first.root, second.root)
  assert.deepEqual(second.serverNames, { bizone: 'eas-capabilities:bizone-canvas' })
})
test('POSIX runner preserves literal quotes/spaces/dollar arguments with a minimal PATH', t => {
  const options = fixture(t)
  const value = "中文 空格 ' $HOME `not-a-command`"
  const result = createOmpCapabilityPlugin({ ...options, runner: { command: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', value] } })
  assert.ok(result)
  assert.equal(execFileSync(join(result.root, 'runner'), [], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' }), value)
})
test('rejects credentials in runner env and unsafe paths; Windows runner uses cmd quoting without expansion', t => {
  const options = fixture(t)
  assert.throws(() => createOmpCapabilityPlugin({ ...options, runner: { ...options.runner, env: { TOKEN: 'secret' } } }), /environment/)
  assert.throws(() => createOmpCapabilityPlugin({ ...options, runner: { command: 'node', args: [] } }), /absolute/)
  const result = createOmpCapabilityPlugin({ ...options, platform: 'win32', runner: { command: 'C:\\Program Files\\Electron.exe', args: ['C:\\app\\shim.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } } })
  assert.ok(result)
  const content = readFileSync(join(result.root, 'runner.cmd'), 'utf8')
  assert.ok(content.includes('DisableDelayedExpansion'))
  assert.ok(content.includes('"C:\\Program Files\\Electron.exe" "C:\\app\\shim.mjs"'))
  const mcp = JSON.parse(readFileSync(join(result.root, 'mcp.json'), 'utf8'))
  assert.equal(mcp.mcpServers['eas-term'].command, './runner.cmd')
  assert.equal(mcp.mcpServers['eas-term'].env.ELECTRON_RUN_AS_NODE, '1')
})
