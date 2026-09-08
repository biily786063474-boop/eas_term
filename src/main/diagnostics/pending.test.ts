import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeReport } from './core.ts'
import { savePending, loadPending, clearPending } from './pending.ts'
test('unknown receipt survives restart with identical ID/content; bad disk report rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eas-pending-'))
  try {
    const r = makeReport({ version: '0.4.85-diag.1', os: '10.0', arch: 'x64' }, [{ t: 0, kind: 'app-start' }])
    savePending(dir, r); assert.deepEqual(loadPending(dir), r)
    clearPending(dir); assert.equal(loadPending(dir), undefined)
    writeFileSync(join(dir, 'diagnostic-pending.json'), JSON.stringify({ ...r, message: 'secret' }))
    assert.equal(loadPending(dir), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
