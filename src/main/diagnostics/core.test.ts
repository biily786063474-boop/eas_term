import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeEvent, makeReport, encodeReport, MAX_RAW, MAX_WIRE } from './core.ts'
import { Journal } from './journal.ts'

test('structured allowlist drops free text, paths, arbitrary names and message', () => {
  const error = Object.assign(new Error('sk-secret prompt C:\\Users\\Alice\\secret.txt'), { code: 'ENOENT' })
  error.stack = 'Error: secret\n    at secret (C:\\Users\\Alice\\app.asar\\out\\main\\index.js:12:34)\n    at /Users/Alice/project/private.ts:1:2'
  const e = safeEvent('cli-error', { cli: 'codex', error, message: 'private', path: 'C:\\Users\\Alice', code: 1 }, 8)
  assert.deepEqual(e, { t: 8, kind: 'cli-error', cli: 'codex', code: 1, error: 'Error', errorCode: 'ENOENT', frames: ['main:12:34'] })
  assert.equal(safeEvent('arbitrary secret', {}, 0), null)
  const custom = { name: 'secret', code: 'sk-secret', stack: 'private' }
  assert.deepEqual(safeEvent('main-error', { error: custom, cli: 'secret' }, 0), { t: 0, kind: 'main-error', error: 'Unknown' })
})
test('only enumerated reasons, finite signed exit codes and numeric time survive', () => {
  assert.deepEqual(safeEvent('cli-exit', { code: NaN, signal: 'secret', reason: 'private' }, -10), { t: 0, kind: 'cli-exit' })
  assert.equal(safeEvent('cli-exit', { code: -1073741819 }, 1)?.code, -1073741819)
})
test('report rejects injected persisted content and bounds bytes', () => {
  const r = makeReport({ version: '0.4.85-diag.1', os: '10.0.22631', arch: 'x64' }, [{ t: 1, kind: 'app-start', message: 'secret' }])
  assert.equal(JSON.stringify(r).includes('secret'), false)
  const packed = encodeReport(r)
  assert.ok(packed.length <= MAX_WIRE)
  assert.throws(() => encodeReport({ ...r, events: Array(100000).fill(r.events[0]) }), /large/)
  assert.ok(MAX_RAW <= 1024 * 1024)
})
test('journal total bounded, error path nonfatal, startup marker detects unclean only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eas-diag-test-'))
  try {
    let j = new Journal(dir, 4096)
    assert.equal(j.start(), false)
    for (let i = 0; i < 300; i++) j.record('app-start', {})
    assert.ok(readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0) <= 4096)
    j = new Journal(dir, 4096)
    assert.equal(j.start(), true)
    j.finish()
    j = new Journal(dir, 4096)
    assert.equal(j.start(), false)
    assert.ok(j.events().length > 0)
    assert.ok(readFileSync(join(dir, 'events.jsonl'), 'utf8').length > 0)
    const file = join(dir, 'not-directory'); writeFileSync(file, '')
    const bad = new Journal(file)
    assert.doesNotThrow(() => { bad.start(); bad.record('app-start', {}); bad.finish() })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
