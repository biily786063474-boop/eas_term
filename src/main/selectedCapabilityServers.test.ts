import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { selectedNativeServers, capabilityMcpConfig } from './selectedCapabilityServers.ts'
import { assembleCapabilityServers } from '../shared/builtinCapabilities.ts'
import { writeCapabilitySnapshot } from './capabilitySnapshot.ts'
import { codexAddServerArgs } from '../shared/roleBinding.ts'
import { readMcpServers } from './agentChat/omp/launch.ts'
const plugin = { name: 'native', root: '/中文 空格/plugin', mcpServers: {
  selected: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.mjs'], env: { CONFIG: '${CODEX_PLUGIN_ROOT}/config' } },
  disabled: { enabled: false, command: 'never' }
} }
test('one selected normalized snapshot drives Claude JSON, OMP ACP and Codex command overrides', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected 能力 ')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const original = JSON.stringify(plugin), native = selectedNativeServers(plugin)
  assert.equal(JSON.stringify(plugin), original)
  assert.equal(native.length, 1); assert.equal(native[0].args![0], '/中文 空格/plugin/server.mjs')
  const servers = assembleCapabilityServers([{ enabled: true, server: { name: 'eas-term', command: 'managed' } }], native)
  const json = capabilityMcpConfig(servers), snapshot = writeCapabilitySnapshot(root, 'session-one', json)
  const claude = JSON.parse(fs.readFileSync(snapshot, 'utf8')).mcpServers
  const omp = readMcpServers(snapshot).servers
  assert.deepEqual(Object.keys(claude), servers.map(s => s.name))
  assert.deepEqual(omp.map(s => s.name), servers.map(s => s.name))
  for (const server of servers) {
    assert.equal(claude[server.name].command, server.command)
    assert.equal(omp.find(s => s.name === server.name)!.command, server.command)
    assert.ok(codexAddServerArgs(server).some(arg => arg.startsWith(`mcp_servers.${server.name}.command=`)))
  }
})
test('collision and native restrictions fail visibly instead of renaming or discarding restrictions', () => {
  assert.throws(() => assembleCapabilityServers([{ enabled: true, server: { name: 'selected', command: 'base' } }], selectedNativeServers(plugin)), /冲突/)
  for (const cfg of [{ type: 'bogus', url: 'https://example.test' }, { command: 'node', disabled_tools: ['write'] }, { command: 'node', enabled_tools: [] }, { command: 'node', args: [1] }]) {
    assert.throws(() => selectedNativeServers({ ...plugin, mcpServers: { selected: cfg } }))
  }
})
test('remote and stdio permission settings cannot be silently lost across CLI configuration formats', () => {
  for (const transport of [{ command: 'node' }, { type: 'http', url: 'https://example.test/mcp' }, { type: 'sse', url: 'https://example.test/mcp' }]) {
    for (const restriction of [
      { disabled_tools: ['write'] }, { enabled_tools: ['read'] }, { allowedTools: ['read'] },
      { disabledTools: ['write'] }, { tools: { write: { approval_mode: 'prompt' } } },
      { default_tools_approval_mode: 'prompt' }, { permissions: { write: false } }, { approval_policy: 'never' }
    ]) assert.throws(() => selectedNativeServers({ name: 'restricted', root: '/plugin', mcpServers: { selected: { ...transport, ...restriction } } }), /工具限制尚不能安全转换/)
  }
})
test('actual launcher keeps credentials out of its argv and strips inherited app authority/Electron mode', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected launcher ')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const probe = path.join(root, 'fake-cli.cjs')
  fs.writeFileSync(probe, 'console.log(JSON.stringify({argv:process.argv,secret:process.env.TEST_CREDENTIAL,electron:process.env.ELECTRON_RUN_AS_NODE,lease:process.env.EAS_CAPABILITY_LEASE,token:process.env.EAS_TERM_TOKEN}));')
  const snapshot = writeCapabilitySnapshot(root, 'selected', capabilityMcpConfig([{ name: 'selected', command: process.execPath, args: [probe], env: { TEST_CREDENTIAL: 'fixture-secret-value' } }]))
  const args = [path.resolve('mcp/eas-selected-mcp-launcher.mjs'), snapshot, 'selected']
  assert.ok(!JSON.stringify(args).includes('fixture-secret-value'))
  const child = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EAS_TERM_TOKEN: 'app-authority', EAS_CAPABILITY_LEASE: 'lease-authority' } })
  let output = ''; child.stdout.on('data', chunk => { output += chunk })
  await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Launcher failed'))) })
  const result = JSON.parse(output)
  assert.equal(result.secret, 'fixture-secret-value')
  assert.equal(result.electron, undefined); assert.equal(result.lease, undefined); assert.equal(result.token, undefined)
  assert.ok(!JSON.stringify(result.argv).includes('fixture-secret-value'))
  if (process.platform !== 'win32') assert.equal(fs.statSync(snapshot).mode & 0o777, 0o600)
})
test('production assembly uses registry selection once and writes the identical precomputed snapshot', async t => {
  const { default: ts } = await import('typescript')
  const { runInNewContext } = await import('node:vm')
  const source = ts.createSourceFile('mcpBridge.ts', fs.readFileSync(new URL('./mcpBridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const declarations = source.statements.filter(n => ts.isFunctionDeclaration(n) && ['sessionMcpServers', 'agentMcpConfigPath', 'easPluginMcpServer'].includes(n.name?.text ?? '')).map(n => n.getText(source).replace(/^export /, '')).join('\n')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production selected ')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let available = true
  const nativePlugin = { ...plugin, id: 'claude:native', cli: 'claude' }
  const runtime = runInNewContext(ts.transpileModule(declarations + '\n({sessionMcpServers,agentMcpConfigPath})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    path, fs, process, app: { getPath: () => root }, capabilityPreferences: () => ({ preferences: { workbench: true, bizone: false } }),
    runnerFor: (args: string[]) => ({ command: process.execPath, args }), serverScriptPath: () => path.resolve('mcp/eas-capability-shim.mjs'),
    findPlugin: () => available ? nativePlugin : undefined, bizoneRuntime: { installed: () => undefined },
    assembleCapabilityServers, selectedNativeServers, capabilityMcpConfig, writeCapabilitySnapshot
  })
  const snapshot = runtime.sessionMcpServers('claude:native')
  available = false // a second registry scan would now fail
  const configPath = runtime.agentMcpConfigPath('claude:native', 'session', snapshot)
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers, capabilityMcpConfig(snapshot))
  assert.ok(snapshot.find((s: any) => s.name === 'selected').args[0].endsWith('eas-selected-mcp-launcher.mjs'))
  assert.ok(!JSON.stringify(snapshot).includes('/config')) // selected env is only in its protected snapshot
  assert.throws(() => runtime.sessionMcpServers('claude:native'), /不可用/)
  assert.throws(() => runtime.agentMcpConfigPath('claude:native', 'bad'), /无法装配/)
})
test('remote fallback preserves native Claude configuration, Codex registration and explicit OMP unsupported reporting', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected remote ')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const type of ['http', 'sse']) {
    const remote = { type, url: 'https://example.test/mcp', headers: { Authorization: 'fixture-static-secret' }, env_headers: { 'X-Key': 'USER_KEY' }, bearer_token_env_var: 'USER_TOKEN' }
    const servers = selectedNativeServers({ name: 'remote', root, mcpServers: { remote, off: { ...remote, disabled: true } } })
    assert.equal(servers.length, 1)
    const snapshot = writeCapabilitySnapshot(root, type, capabilityMcpConfig(servers))
    assert.deepEqual(JSON.parse(fs.readFileSync(snapshot, 'utf8')).mcpServers.remote, remote)
    assert.deepEqual(codexAddServerArgs(servers[0]), [])
    assert.deepEqual(readMcpServers(snapshot), { servers: [], dropped: ['remote'] })
    assert.ok(!JSON.stringify(servers.flatMap(codexAddServerArgs)).includes('fixture-static-secret'))
  }
})
test('selected stdio cwd survives its private snapshot and real spawn resolves the plugin script there', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'selected cwd 中文 ')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const pluginRoot = path.join(root, 'plugin'), projectRoot = path.join(root, 'project')
  fs.mkdirSync(pluginRoot); fs.mkdirSync(projectRoot)
  fs.writeFileSync(path.join(pluginRoot, 'server.cjs'), 'console.log(JSON.stringify({source:"plugin",cwd:process.cwd()}))')
  fs.writeFileSync(path.join(projectRoot, 'server.cjs'), 'console.log(JSON.stringify({source:"wrong-project"}))')
  const servers = selectedNativeServers({ name: 'cwd-plugin', root: pluginRoot, mcpServers: { selected: { command: process.execPath, args: ['server.cjs'], cwd: '${CODEX_PLUGIN_ROOT}' } } })
  const snapshot = writeCapabilitySnapshot(root, 'selected-cwd', capabilityMcpConfig(assembleCapabilityServers([], servers)))
  assert.equal(JSON.parse(fs.readFileSync(snapshot, 'utf8')).mcpServers.selected.cwd, pluginRoot)
  const child = spawn(process.execPath, [path.resolve('mcp/eas-selected-mcp-launcher.mjs'), snapshot, 'selected'], { cwd: projectRoot })
  let output = ''; child.stdout.on('data', chunk => { output += chunk })
  await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Cwd launcher failed'))) })
  assert.deepEqual(JSON.parse(output), { source: 'plugin', cwd: pluginRoot })
})
test('stdio rejects relative or foreign-platform cwd and unknown fields instead of discarding native semantics', () => {
  const cwdValues = ['relative/path', '', 3, process.platform === 'win32' ? '/foreign/posix' : 'C:\\foreign\\windows']
  for (const cwd of cwdValues) assert.throws(() => selectedNativeServers({ ...plugin, mcpServers: { selected: { command: 'node', cwd } } }), /工作目录/)
  for (const field of ['required', 'startup_timeout_sec', 'tool_timeout_sec', 'future_native_option']) {
    assert.throws(() => selectedNativeServers({ ...plugin, mcpServers: { selected: { command: 'node', [field]: true } } }), new RegExp(field))
    assert.throws(() => selectedNativeServers({ ...plugin, mcpServers: { selected: { type: 'http', url: 'https://example.test', [field]: true } } }), new RegExp(field))
  }
})
