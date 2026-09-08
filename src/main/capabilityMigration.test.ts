import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { migrateCapabilityRegion, rollbackCapabilityMigration } from './capabilityMigration.ts'
const beginMarker = '<!-- owned:begin -->'
const endMarker = '<!-- owned:end -->'
const old = beginMarker + '\nold\n' + endMarker
const next = beginMarker + '\nnew\n' + endMarker
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cap-migrate-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const targetPath = join(dir, 'AGENTS.md')
  const backupDirectory = join(dir, 'backups')
  mkdirSync(backupDirectory)
  const original = '\uFEFF我的规则\r\n\n' + old + '\r\nuser tail  '
  writeFileSync(targetPath, original)
  return { dir, original, options: { backupDirectory, targetPath, beginMarker, endMarker, ownedRegions: [old], newRegion: next, healthy: true } }
}
test('exact ownership preserves user bytes, readonly mode, creates private backups, and is restart-idempotent', t => {
  const { original, options } = fixture(t)
  chmodSync(options.targetPath, 0o444)
  const result = migrateCapabilityRegion(options)
  assert.equal(result.status, 'migrated')
  assert.equal(readFileSync(options.targetPath, 'utf8'), original.replace(old, next))
  assert.equal(statSync(options.targetPath).mode & 0o777, 0o444)
  const files = readdirSync(options.backupDirectory)
  assert.equal(files.length, 2)
  for (const name of files) assert.equal(statSync(join(options.backupDirectory, name)).mode & 0o777, 0o600)
  assert.equal(migrateCapabilityRegion(options).status, 'noop')
  assert.deepEqual(readdirSync(options.backupDirectory), files)
})
test('changed, duplicate, missing, reversed or broken fences never overwrite', t => {
  const { options } = fixture(t)
  for (const value of [old.replace('old', 'user changed'), old + old, beginMarker, endMarker + beginMarker, 'user only']) {
    writeFileSync(options.targetPath, value)
    assert.notEqual(migrateCapabilityRegion(options).status, 'migrated')
    assert.equal(readFileSync(options.targetPath, 'utf8'), value)
  }
  assert.deepEqual(readdirSync(options.backupDirectory), [])
})
test('unhealthy new link does not migrate and hash ownership can delete region', t => {
  const { options, original } = fixture(t)
  assert.equal(migrateCapabilityRegion({ ...options, healthy: false }).status, 'deferred')
  assert.equal(readFileSync(options.targetPath, 'utf8'), original)
  assert.equal(migrateCapabilityRegion({ ...options, ownedRegions: [], ownedRegionHashes: [createHash('sha256').update(old).digest('hex')], newRegion: '' }).status, 'migrated')
  assert.equal(readFileSync(options.targetPath, 'utf8'), original.replace(old, ''))
  assert.equal(migrateCapabilityRegion({ ...options, newRegion: '' }).status, 'noop')
})
test('rollback restores original bytes, is idempotent, and refuses subsequent user edits', t => {
  const { options, original } = fixture(t)
  const result = migrateCapabilityRegion(options)
  assert.ok(result.migrationId)
  const rollback = { ...options, migrationId: result.migrationId }
  writeFileSync(options.targetPath, 'later user edit')
  assert.equal(rollbackCapabilityMigration(rollback).status, 'conflict')
  assert.equal(readFileSync(options.targetPath, 'utf8'), 'later user edit')
  writeFileSync(options.targetPath, original.replace(old, next))
  assert.equal(rollbackCapabilityMigration(rollback).status, 'restored')
  assert.equal(readFileSync(options.targetPath, 'utf8'), original)
  assert.equal(rollbackCapabilityMigration(rollback).status, 'noop')
})
test('backup failures and symlink paths leave target untouched', t => {
  const { options, original, dir } = fixture(t)
  const invalidBackup = join(dir, 'not-a-directory')
  writeFileSync(invalidBackup, 'file')
  assert.throws(() => migrateCapabilityRegion({ ...options, backupDirectory: invalidBackup }))
  assert.equal(readFileSync(options.targetPath, 'utf8'), original)
  const linked = join(dir, 'linked.md')
  symlinkSync(options.targetPath, linked)
  assert.throws(() => migrateCapabilityRegion({ ...options, targetPath: linked }))
  assert.equal(readFileSync(options.targetPath, 'utf8'), original)
})
test('external edit during backup is detected by the final hash recheck', t => {
  const { options } = fixture(t)
  const realSync = fs.fsyncSync
  let edited = false
  t.mock.method(fs, 'fsyncSync', (fd: number) => {
    realSync(fd)
    if (!edited) {
      edited = true
      writeFileSync(options.targetPath, 'external user change')
    }
  })
  syncBuiltinESMExports()
  try {
    assert.equal(migrateCapabilityRegion(options).status, 'conflict')
    assert.equal(readFileSync(options.targetPath, 'utf8'), 'external user change')
    assert.equal(readdirSync(options.backupDirectory).length, 2)
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
})
test('backup fsync failure cannot reach target replacement', t => {
  const { options, original } = fixture(t)
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('simulated disk failure') })
  syncBuiltinESMExports()
  try {
    assert.throws(() => migrateCapabilityRegion(options), /disk failure/)
    assert.equal(readFileSync(options.targetPath, 'utf8'), original)
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
})
