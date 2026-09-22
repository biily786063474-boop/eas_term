// Real Excel package trees, production replacement function, injected promotion IO failure.
// This is filesystem rollback proof, not an OS-crash recovery or live-app fault injection.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {replacePluginDirectory} from '../src/main/pluginReplace.ts'
const candidate=process.argv[2]
assert.ok(candidate&&path.isAbsolute(candidate))
const root=fs.mkdtempSync(path.join(os.tmpdir(),'excel-rollback-'))
function digest(dir){const rows=[];function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else rows.push([path.relative(dir,f),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])}}walk(dir);return rows}
try{
 const installed=path.join(root,'excel'),stage=path.join(root,'stage')
 fs.cpSync('plugins-store/excel',installed,{recursive:true});fs.cpSync(candidate,stage,{recursive:true})
 const before=digest(installed)
 let oldMoved=false,failedPromotion=false
 assert.throws(()=>replacePluginDirectory(stage,installed,{...fs,renameSync:(from,to)=>{
  if(from===installed)oldMoved=true
  if(path.basename(from).startsWith('.incoming-')){failedPromotion=true;throw Error('injected promotion IO failure')}
  fs.renameSync(from,to)
 }}),/injected promotion/)
 assert.ok(oldMoved&&failedPromotion);assert.deepEqual(digest(installed),before)
 assert.deepEqual(fs.readdirSync(root).sort(),['excel','stage'])
 replacePluginDirectory(stage,installed)
 assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'plugin.json'))).version,'1.1.0')
 assert.deepEqual(digest(installed),digest(stage))
 console.log(JSON.stringify({passed:true,checks:['Old Excel directory moved before injected promotion failure','Every old Excel file SHA restored; temporary backup/incoming removed','Retry promotes complete native candidate byte-for-byte'],scope:'Production filesystem replacement with injected IO error, not crash recovery or live-app injection'},null,2))
}finally{fs.rmSync(root,{recursive:true,force:true})}
