import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverBizoneWindowsInstallation, validateBizoneWindowsInstallation } from './bizoneWindowsDiscovery.ts'
const exe = 'D:\\用户便携软件\\笔纵 画板\\笔纵画板.exe'
const options = { exists: () => true, read: () => JSON.stringify({ name: 'bizone-canvas', main: 'electron/main.js', type: 'module' }) }
test('registered native handler supports portable Chinese paths and spaces without parsing a command', async () => {
  const info = await discoverBizoneWindowsInstallation(async url => { assert.equal(url, 'bzone://'); return { path: exe } }, options)
  assert.equal(info?.executable, exe)
  assert.equal(info?.server, 'D:\\用户便携软件\\笔纵 画板\\resources\\app\\electron\\mcpServer.js')
})
test('rejects command strings, quotes, traversal, relative and network executables', () => {
  for (const value of [`"${exe}" "%1"`, `${exe} --flag`, `"${exe}" & calc.exe`, 'cmd.exe', '..\\bizone.exe',
    '\\\\server\\share\\bizone.exe', 'C:\\folder\\..\\bizone.exe', 'C:\\foo:stream.exe', 'C:\\foo\nbar.exe']) {
    assert.equal(validateBizoneWindowsInstallation(value, options), undefined, value)
  }
})
test('unregistered protocol, unrelated package and incomplete installation remain missing', async () => {
  assert.equal(await discoverBizoneWindowsInstallation(async () => { throw new Error('not registered') }, options), undefined)
  assert.equal(validateBizoneWindowsInstallation(exe, { ...options, read: () => '{"name":"another"}' }), undefined)
  assert.equal(validateBizoneWindowsInstallation(exe, { ...options, exists: file => !file.includes('@modelcontextprotocol') }), undefined)
})
