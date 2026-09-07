import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CliUpdateManager, newer } from './manager.ts'
import { safeArchiveEntries } from './packages.ts'

function fixture(t: import('node:test').TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-cli-update-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls: string[] = []
  const valid = new Set<string>()
  const deps = {
    latest: async () => { calls.push('network'); return '2.0.0' },
    stage: async (_id: string, version: string, _signal: AbortSignal) => { calls.push('stage'); valid.add(version) },
    verify: (id: string, version: string) => { if (!valid.has(version)) throw Error('bad binary'); return path.join(root, id, version, 'bin', id) },
    systemVersion: async () => '1.0.0', changed: () => {}
  }
  return { root, calls, valid, deps, manager: new CliUpdateManager(root, deps) }
}
test('default off and corrupt persisted preferences never request updates', async t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, 'state.json'), '{bad')
  const m = new CliUpdateManager(f.root, f.deps)
  assert.deepEqual(m.boot(), [])
  await m.refreshVersions(); await m.check('codex'); await m.check('claude')
  assert.equal(m.snapshot().every(r => !r.enabled), true)
  assert.deepEqual(f.calls, [])
})
test('download stays pending; only next boot switches binary and persists disabled setting', async t => {
  const f = fixture(t), m = f.manager
  m.boot(); await m.refreshVersions(); m.setEnabled('codex', true)
  await m.check('codex')
  assert.equal(m.snapshot()[0].current, '1.0.0')
  assert.equal(m.snapshot()[0].pending, '2.0.0')
  m.setEnabled('codex', false)
  const reboot = new CliUpdateManager(f.root, f.deps)
  assert.equal(reboot.boot()[0], path.join(f.root, 'codex', '2.0.0', 'bin'))
  assert.equal(reboot.snapshot()[0].enabled, false)
  assert.equal(reboot.snapshot()[0].current, '2.0.0')
  assert.equal(reboot.snapshot()[0].pending, undefined)
})
test('failed staged binary rolls back to active without losing conversation CLI', t => {
  const f = fixture(t)
  f.valid.add('1.0.0')
  fs.writeFileSync(path.join(f.root, 'state.json'), JSON.stringify({codex:{enabled:true,active:'1.0.0',pending:'2.0.0'}}))
  const m = new CliUpdateManager(f.root, f.deps)
  assert.equal(m.boot().length, 1)
  assert.equal(m.snapshot()[0].current, '1.0.0')
  assert.equal(m.snapshot()[0].phase, 'failed')
})
test('disabling during a download invalidates late completion and does not activate it', async t => {
  const f = fixture(t)
  let finish!: () => void
  let entered!: () => void
  const started = new Promise<void>(r => entered = r)
  f.deps.stage = async () => { entered(); await new Promise<void>(r => finish = r) }
  const m = f.manager
  m.boot(); await m.refreshVersions(); m.setEnabled('codex', true)
  const job = m.check('codex'); await started
  m.setEnabled('codex', false); finish(); await job
  assert.equal(m.snapshot()[0].pending, undefined)
  assert.equal(m.snapshot()[0].phase, 'idle')
})
test('download failure preserves current version and can retry', async t => {
  const f = fixture(t), m = f.manager
  m.boot(); await m.refreshVersions(); m.setEnabled('claude', true)
  f.deps.stage = async () => { throw Error('checksum mismatch') }
  await m.check('claude')
  assert.equal(m.snapshot()[1].current, '1.0.0')
  assert.equal(m.snapshot()[1].phase, 'failed')
  assert.equal(m.snapshot()[1].pending, undefined)
  f.deps.stage = async () => {}
  await m.check('claude')
  assert.equal(m.snapshot()[1].pending, '2.0.0')
})
test('never downgrade a newer installed CLI', async t => {
  const f = fixture(t), m = f.manager
  f.deps.systemVersion = async () => '3.0.0'
  m.boot(); await m.refreshVersions(); m.setEnabled('codex', true); await m.check('codex')
  assert.equal(f.calls.includes('stage'), false)
  assert.equal(newer('2.0.0-beta', '1.0.0'), false)
  assert.equal(newer('1.10.0', '1.9.0'), true)
  assert.equal(newer('1.0.0', '1.0.0'), false)
})
test('pending version is not downloaded twice and CLI failures are independent', async t => {
  const f = fixture(t), m = f.manager
  m.boot(); await m.refreshVersions(); m.setEnabled('codex', true)
  await m.check('codex'); await m.check('codex')
  assert.equal(f.calls.filter(c => c === 'stage').length, 1)
  assert.equal(m.snapshot()[1].enabled, false)
  assert.equal(m.snapshot()[1].phase, 'idle')
})
test('update opt-in never installs a missing CLI', async t => {
  const f = fixture(t)
  const m = new CliUpdateManager(f.root, {...f.deps, systemVersion: async () => undefined})
  m.boot(); m.setEnabled('codex', true); await m.check('codex')
  assert.equal(m.snapshot()[0].phase, 'failed')
  assert.deepEqual(f.calls, [])
})
test('rollback is deferred until restart and disables auto update', t => {
  const f = fixture(t)
  f.valid.add('1.0.0'); f.valid.add('2.0.0')
  fs.writeFileSync(path.join(f.root, 'state.json'), JSON.stringify({codex:{enabled:true,active:'2.0.0',previous:'1.0.0'}}))
  const m = new CliUpdateManager(f.root, f.deps)
  m.boot(); m.rollback('codex')
  assert.equal(m.snapshot()[0].current, '2.0.0')
  assert.equal(m.snapshot()[0].pending, '1.0.0')
  assert.equal(m.snapshot()[0].enabled, false)
  const reboot = new CliUpdateManager(f.root, f.deps); reboot.boot()
  assert.equal(reboot.snapshot()[0].current, '1.0.0')
})
test('unknown IDs and path-like versions in state cannot become executable paths', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, 'state.json'), JSON.stringify({codex:{enabled:'yes',active:'../../evil',pending:'1.0.0/bin'},other:{enabled:true}}))
  const m = new CliUpdateManager(f.root, f.deps)
  assert.deepEqual(m.boot(), [])
  assert.equal(m.snapshot().every(r => !r.enabled), true)
})
test('archive extraction rejects traversal, links and special files before extraction', () => {
  assert.deepEqual(safeArchiveEntries('package/bin/codex\n', '-rwxr-xr-x user file\n'), ['package/bin/codex'])
  for (const file of ['/tmp/evil', 'package/../../evil', 'package/..\\evil']) assert.throws(() => safeArchiveEntries(file, '-rwx user file'))
  assert.throws(() => safeArchiveEntries('package/bin/codex', 'lrwx user link -> /tmp/evil'))
})
