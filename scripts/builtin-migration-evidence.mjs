// Isolated package acceptance fixture. No real user file is written.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const BEGIN = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->'
const END = '<!-- eas-term:end -->'
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const ensure = (condition, message) => { if (!condition) throw new Error(message) }
export function prepareMigrationFixture(project, source) {
  const text = fs.readFileSync(source, 'utf8'), begin = text.indexOf(BEGIN), end = text.indexOf(END, begin)
  ensure(begin >= 0 && end > begin && text.indexOf(BEGIN, begin + BEGIN.length) < 0, 'Migration fixture source needs one managed region')
  const region = text.slice(begin, end + END.length)
  const prefix = '# User rule\r\nPreserve this exact user text.\r\n\r\n', suffix = '\r\n\r\nUser suffix: 中文 & spaces.\r\n'
  const target = path.join(project, 'AGENTS.md'), unowned = path.join(project, 'CLAUDE.md')
  const before = Buffer.from(prefix + region + suffix), after = Buffer.from(prefix + suffix)
  const custom = Buffer.from(prefix + region.replace('# Eas-Term 扩展能力', '# Eas-Term 扩展能力（用户修改）') + suffix)
  fs.writeFileSync(target, before, { flag:'wx', mode:0o600 }); fs.writeFileSync(unowned, custom, { flag:'wx', mode:0o600 })
  return { target, unowned, before, after, custom }
}
export function checkMigrationFixture(profile, fixture) {
  ensure(fs.readFileSync(fixture.target).equals(fixture.after), 'Managed region removal changed user bytes or did not run')
  ensure(fs.readFileSync(fixture.unowned).equals(fixture.custom), 'User-edited region was changed')
  const directory = path.join(profile, 'capability-migrations')
  const manifests = fs.readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => ({name, value:JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'))})).filter(x => x.value.targetPath === fixture.target)
  ensure(manifests.length === 1, 'Expected exactly one durable migration for test target')
  const {name, value} = manifests[0], id = name.slice(0,-5), backup = fs.readFileSync(path.join(directory,id+'.bak'))
  ensure(value.beforeHash === digest(fixture.before) && value.afterHash === digest(fixture.after) && backup.equals(fixture.before), 'Migration manifest/backup hashes do not match')
  const events = fs.readdirSync(directory).filter(name=>name.endsWith('.event.json')).map(name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'))).filter(x=>x.value?.targetPath===fixture.target)
  ensure(events.some(x=>x.operation==='migration-intent') && events.some(x=>x.operation==='migration-result' && x.value.status==='migrated'), 'Missing successful migration audit')
  return {migrationId:id,target:fixture.target,beforeHash:value.beforeHash,afterHash:value.afterHash,fullBackupVerified:true,userBytesPreserved:true,userEditedRegionPreserved:true,manifestCount:manifests.length}
}
// Exercises the documented maintenance-only offline procedure after the app exits.
// Guidance is disabled first; no claim that an application rollback UI was invoked.
export function restoreMigrationFixtureOffline(profile, fixture) {
  const verified = checkMigrationFixture(profile, fixture)
  const preferencesPath = path.join(profile,'capability-preferences.json')
  const prefs = JSON.parse(fs.readFileSync(preferencesPath,'utf8'));prefs.guidance=false
  fs.writeFileSync(preferencesPath,JSON.stringify(prefs),{mode:0o600})
  const backup = fs.readFileSync(path.join(profile,'capability-migrations',verified.migrationId+'.bak'))
  ensure(digest(backup)===verified.beforeHash && digest(fs.readFileSync(fixture.target))===verified.afterHash,'Offline rollback conflict')
  const mode=fs.statSync(fixture.target).mode&0o777, temp=fixture.target+'.offline-restore'
  fs.writeFileSync(temp,backup,{flag:'wx',mode});fs.renameSync(temp,fixture.target)
  ensure(fs.readFileSync(fixture.target).equals(fixture.before),'Offline rollback did not restore full original')
  return {...verified,offlineRollbackVerified:true,guidanceDisabled:true,applicationRollbackApiInvoked:false}
}
