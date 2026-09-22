import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error standalone module
import {captureAuthorized,withEventGrantLock} from './eventAuthorization.mjs'
test('dispatched capture cannot commit after revoke, exclusion, or revoke/re-enable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grant-race-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const file=path.join(dir,'grants.json');let writes=0
 const save=(enabled:boolean,epoch:string,excluded:string[]=[])=>withEventGrantLock(file,()=>fs.writeFileSync(file,JSON.stringify({timeline:{enabled,epoch,excluded}})))
 const old=()=>captureAuthorized(file,'timeline','one','p',()=>++writes)
 save(true,'one');old();assert.equal(writes,1)
 save(false,'two');old();assert.equal(writes,1)
 save(true,'three');old();assert.equal(writes,1)
 save(true,'one',['p']);old();assert.equal(writes,1)
 save(true,'one');withEventGrantLock(file,()=>assert.throws(()=>save(false,'two'),/授权/))
 old();assert.equal(writes,2)
 assert.equal(captureAuthorized(undefined,'timeline','one','p',()=>++writes).revoked,true)
})
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
test('stdio event already dispatched to stopped plugin is rejected after revoke', {skip:process.platform==='win32'}, async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grant-stdio-')),file=path.join(dir,'grants.json')
 const save=(enabled:boolean,epoch:string)=>withEventGrantLock(file,()=>fs.writeFileSync(file,JSON.stringify({timeline:{enabled,epoch,excluded:[]}})))
 save(true,'old')
 const child=spawn(process.execPath,['resources/plugins/timeline/server.mjs'],{env:{...process.env,EAS_EVENT_GRANTS_FILE:file,EAS_EVENT_PLUGIN_NAME:'timeline'}})
 t.after(()=>{child.kill('SIGCONT');child.kill();fs.rmSync(dir,{recursive:true,force:true})})
 const waiting=new Map();createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);waiting.get(m.id)?.(m)})
 let id=0
 const rpc=(method:string,params={})=>new Promise<any>((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error('rpc timeout')),3000);waiting.set(key,(m:any)=>{clearTimeout(timer);resolve(m)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n')})
 await rpc('initialize');child.kill('SIGSTOP')
 await new Promise(r=>setTimeout(r,50))
 const response=rpc('events/turn-completed',{grantEpoch:'old',event:{kind:'agent.turn.completed',eventId:'old',projectId:'p',sessionId:'s',turnId:'t',text:'已完成独立成果',date:'2026-09-18',completedAt:new Date().toISOString(),outcome:'completed'},_meta:{eas:{context:{cwd:dir}}}})
 save(false,'new');child.kill('SIGCONT')
 assert.equal((await response).result.revoked,true)
 assert.equal(fs.existsSync(path.join(dir,'.eas/timeline-candidates.json')),false)
})
