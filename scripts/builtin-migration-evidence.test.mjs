import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CapabilityMigrationService } from '../src/main/capabilityMigrationService.ts'
import { prepareMigrationFixture, checkMigrationFixture, restoreMigrationFixtureOffline } from './builtin-migration-evidence.mjs'
const region = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->\n# Eas-Term 扩展能力\n<!-- eas-term:end -->'
function setup(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'eas-migration-proof-')))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const project=path.join(root,'中文 project');fs.mkdirSync(project)
  const source=path.join(root,'source.md');fs.writeFileSync(source,region)
  const fixture=prepareMigrationFixture(project,source)
  fs.writeFileSync(path.join(root,'capability-preferences.json'),JSON.stringify({schemaVersion:1,workbench:true,bizone:true,guidance:true}))
  const service=new CapabilityMigrationService({appOwnedRoot:root,homeDirectory:root,expectedRegion:()=>region,isEnabled:()=>true,isTrustedProject:p=>p===project})
  return {root,project,fixture,service}
}
test('migration acceptance checks real service backup, user bytes, idempotence and documented offline restoration',t=>{
  const {root,project,fixture,service}=setup(t)
  assert.throws(()=>checkMigrationFixture(root,fixture),/did not run/)
  service.onSuccessfulWorkbenchCall(project)
  const first=checkMigrationFixture(root,fixture)
  service.onSuccessfulWorkbenchCall(project)
  assert.equal(checkMigrationFixture(root,fixture).migrationId,first.migrationId)
  assert.equal(restoreMigrationFixtureOffline(root,fixture).offlineRollbackVerified,true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'capability-preferences.json'))).guidance,false)
})
test('offline acceptance refuses to overwrite edits after migration',t=>{
  const {root,project,fixture,service}=setup(t);service.onSuccessfulWorkbenchCall(project)
  fs.appendFileSync(fixture.target,'new user edit')
  assert.throws(()=>restoreMigrationFixtureOffline(root,fixture),/changed user bytes/)
  assert.match(fs.readFileSync(fixture.target,'utf8'),/new user edit$/)
})
