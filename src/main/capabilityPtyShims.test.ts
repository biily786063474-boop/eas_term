import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ensureCapabilityPtyShims, renderCapabilityPtyShim } from './capabilityPtyShims.ts'

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "能力入口 '中文 $ 空格-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const userData = path.join(root, 'user data')
  fs.mkdirSync(userData)
  const appPath = path.join(root, 'app source')
  fs.mkdirSync(path.join(appPath, 'mcp'), { recursive: true })
  const script = `process.stdout.write(JSON.stringify({args:process.argv.slice(2), fallback:process.env.EAS_CAPABILITY_NODE_FALLBACK, electron:process.env.ELECTRON_RUN_AS_NODE})); process.exitCode=37`
  fs.writeFileSync(path.join(appPath, 'mcp', 'eas-pty-launcher.mjs'), script)
  return { root, userData, appPath, resourcesPath: '', isPackaged: false }
}
test('real POSIX entry forwards every original argument and exit code without shell expansion', { skip: process.platform === 'win32' }, t => {
  const host = fixture(t)
  const dir = ensureCapabilityPtyShims(host, { electron: process.execPath, exists: () => false })
  const args = ['', '中文 空格', "single'quote", 'double"quote', '$(touch SHOULD_NOT_EXIST)', '`pwd`', 'a;b&c', 'line\nbreak', '%PATH%', '!name!']
  for (const kind of ['claude', 'codex', 'omp']) {
    const r = spawnSync(path.join(dir, kind), args, { encoding: 'utf8', cwd: host.root, env: { PATH: '/usr/bin:/bin' } })
    assert.equal(r.error, undefined)
    assert.equal(r.status, 37)
    assert.deepEqual(JSON.parse(r.stdout), { args: [kind, ...args], fallback: '1', electron: '1' })
  }
  assert.equal(fs.existsSync(path.join(host.root, 'SHOULD_NOT_EXIST')), false)
})
test('different resource roots produce independent runnable entries instead of stale cache', { skip: process.platform === 'win32' }, t => {
  const host = fixture(t)
  const opts = { electron: process.execPath, exists: () => false }
  const first = ensureCapabilityPtyShims(host, opts)
  const resourcesPath = path.join(host.root, 'packaged 资源')
  fs.mkdirSync(path.join(resourcesPath, 'mcp'), { recursive: true })
  fs.copyFileSync(path.join(host.appPath, 'mcp', 'eas-pty-launcher.mjs'), path.join(resourcesPath, 'mcp', 'eas-pty-launcher.mjs'))
  const second = ensureCapabilityPtyShims({ ...host, isPackaged: true, resourcesPath }, opts)
  assert.notEqual(first, second)
  assert.equal(ensureCapabilityPtyShims(host, opts), first)
  assert.equal(spawnSync(path.join(second, 'codex'), ['two']).status, 37)
  assert.equal(spawnSync(path.join(first, 'codex'), ['one']).status, 37)
})
test('native Node runner does not introduce Electron fallback variables', () => {
  const content = renderCapabilityPtyShim('codex', { command: '/opt/homebrew/bin/node', args: ['/app/mcp/eas-pty-launcher.mjs'] }, 'darwin')
  assert.ok(!content.includes('ELECTRON_RUN_AS_NODE'))
  assert.ok(!content.includes('EAS_CAPABILITY_NODE_FALLBACK'))
})
test('Windows batch keeps static percent paths literal, disables delayed expansion and avoids CALL reparsing', () => {
  const content = renderCapabilityPtyShim('claude', { command: 'C:\\应用 100%\\Electron.exe', args: ['C:\\应用 ! %PATH%\\mcp\\eas-pty-launcher.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } }, 'win32')
  assert.ok(content.includes('setlocal DisableDelayedExpansion'))
  assert.ok(content.includes('"C:\\应用 100%%\\Electron.exe" "C:\\应用 ! %%PATH%%\\mcp\\eas-pty-launcher.mjs" "claude" %*'))
  assert.ok(content.includes('set "EAS_CAPABILITY_NODE_FALLBACK=1"'))
  assert.ok(!/^call /im.test(content))
  assert.ok(content.includes('endlocal & exit /b'))
})
test('unsafe Windows literals and unsupported CLI names are rejected before writing', () => {
  for (const bad of ['C:\\bad"name.exe', 'C:\\bad\nname.exe', 'C:\\bad\0name.exe']) {
    assert.throws(() => renderCapabilityPtyShim('codex', { command: bad, args: ['C:\\launcher.mjs'] }, 'win32'))
  }
  assert.throws(() => renderCapabilityPtyShim('other' as any, { command: '/node', args: ['/launcher'] }, 'linux'))
})
test('app-owned shim directory cannot be redirected with a symlink', { skip: process.platform === 'win32' }, t => {
  const host = fixture(t)
  const outside = path.join(host.root, 'outside')
  fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(host.userData, 'capability-pty-bin'))
  assert.throws(() => ensureCapabilityPtyShims(host, { electron: process.execPath, exists: () => false }), /Unsafe/)
  assert.deepEqual(fs.readdirSync(outside), [])
})
