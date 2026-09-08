import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityMigrationService } from './capabilityMigrationService.ts'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const begin = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->'
const region = begin + '\nexact old application region\n<!-- eas-term:end -->'
function fixture(t: { after: (fn: () => void) => void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'migration-service-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const homeDirectory = join(root, 'home'), appOwnedRoot = join(root, 'app'), project = join(root, '中文 project')
  for (const dir of [homeDirectory, appOwnedRoot, project, join(homeDirectory, '.codex')]) mkdirSync(dir)
  const files = [join(homeDirectory, '.codex', 'AGENTS.md'), join(project, 'AGENTS.md'), join(project, 'CLAUDE.md')]
  const original = '\uFEFF用户规则\r\n' + region + '\r\n尾部  '
  for (const file of files) writeFileSync(file, original)
  const options = { homeDirectory, appOwnedRoot, expectedRegion: () => region, isEnabled: () => true, isTrustedProject: (p: string) => p === project }
  return { options, project, files, original }
}
test('successful workbench call migrates exact fixed targets with durable evidence and restart rollback', t => {
  const { options, project, files, original } = fixture(t)
  const service = new CapabilityMigrationService(options)
  const outcomes = service.onSuccessfulWorkbenchCall(project)
  assert.equal(outcomes.length, 3)
  assert.ok(outcomes.every(x => x.status === 'migrated'))
  for (const file of files) assert.equal(readFileSync(file, 'utf8'), original.replace(region, ''))
  const audit = readdirSync(join(options.appOwnedRoot, 'capability-migrations')).filter(x => x.endsWith('.event.json'))
  assert.equal(audit.length, 6)
  const restarted = new CapabilityMigrationService(options)
  assert.equal(restarted.rollback(outcomes[1].migrationId!).status, 'restored')
  assert.equal(readFileSync(files[1], 'utf8'), original)
  new CapabilityMigrationService(options).onSuccessfulWorkbenchCall(project)
  assert.equal(readFileSync(files[1], 'utf8'), original, 'rollback persists suppression of automatic remigration')
})
test('disabled, unknown ownership, and untrusted project preserve original bytes', t => {
  const { options, project, files, original } = fixture(t)
  assert.deepEqual(new CapabilityMigrationService({ ...options, isEnabled: () => false }).onSuccessfulWorkbenchCall(project), [])
  for (const file of files) assert.equal(readFileSync(file, 'utf8'), original)
  writeFileSync(files[0], original.replace('exact old', 'user customized'))
  const result = new CapabilityMigrationService(options).onSuccessfulWorkbenchCall(join(project, 'untrusted'))
  assert.equal(result.length, 1)
  assert.equal(result[0].status, 'conflict')
  assert.equal(readFileSync(files[1], 'utf8'), original)
  assert.equal(readFileSync(files[2], 'utf8'), original)
})
test('rollback only accepts identity and rejects forged targets and later user edits', t => {
  const { options, files } = fixture(t)
  const service = new CapabilityMigrationService(options)
  const [outcome] = service.onSuccessfulWorkbenchCall()
  assert.throws(() => service.rollback('../AGENTS.md'))
  writeFileSync(files[0], 'later edit')
  assert.equal(service.rollback(outcome.migrationId!).status, 'conflict')
  assert.equal(readFileSync(files[0], 'utf8'), 'later edit')
  const manifest = join(options.appOwnedRoot, 'capability-migrations', outcome.migrationId + '.json')
  const data = JSON.parse(readFileSync(manifest, 'utf8'))
  data.targetPath = join(options.homeDirectory, 'other.md')
  writeFileSync(manifest, JSON.stringify(data))
  assert.throws(() => service.rollback(outcome.migrationId!), /target/)
})
test('audit persistence failure prevents all target mutation', t => {
  const { options, files, original } = fixture(t)
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('disk unavailable') })
  syncBuiltinESMExports()
  try {
    assert.throws(() => new CapabilityMigrationService(options).onSuccessfulWorkbenchCall(), /disk unavailable/)
    for (const file of files) assert.equal(readFileSync(file, 'utf8'), original)
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
})
