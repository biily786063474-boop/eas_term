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

import {spawnSync} from 'node:child_process'
test('host suggestion and new captures share the timeline writer without losing candidates',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-writer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const file=path.join(dir,'grants.json');fs.writeFileSync(file,JSON.stringify({timeline:{enabled:true,epoch:'current',excluded:[]}}))
 const meta={eas:{context:{cwd:dir}}}
 const event=(i:number)=>({kind:'agent.turn.completed',eventId:String(i),projectId:'p',sessionId:'s',turnId:String(i),text:'已完成独立成果 '+i,date:'2026-09-23',completedAt:new Date().toISOString(),outcome:'completed'})
 const first=spawnSync(process.execPath,['resources/plugins/timeline/server.mjs'],{env:{...process.env,EAS_EVENT_GRANTS_FILE:file,EAS_EVENT_PLUGIN_NAME:'timeline'},input:JSON.stringify({jsonrpc:'2.0',id:1,method:'events/turn-completed',params:{grantEpoch:'current',event:event(0),_meta:meta}})+'\n',encoding:'utf8'})
 const id=JSON.parse(first.stdout).result.id
 const messages=[];for(let i=1;i<=20;i++){
  messages.push({jsonrpc:'2.0',id:i*2,method:'host/attach-jev-suggestion',params:{grantEpoch:'current',projectId:'p',id,advice:{candidateId:id,requiresReview:true,milestone:{probability:.8,accepted:false}},_meta:meta}})
  messages.push({jsonrpc:'2.0',id:i*2+1,method:'events/turn-completed',params:{grantEpoch:'current',event:event(i),_meta:meta}})
 }
 const result=spawnSync(process.execPath,['resources/plugins/timeline/server.mjs'],{env:{...process.env,EAS_EVENT_GRANTS_FILE:file,EAS_EVENT_PLUGIN_NAME:'timeline'},input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8'})
 const replies=result.stdout.trim().split('\n').map(l=>JSON.parse(l));assert.equal(replies.length,40);assert.ok(replies.every(r=>!r.error),result.stdout)
 const stored=JSON.parse(fs.readFileSync(path.join(dir,'.eas/timeline-candidates.json'),'utf8'));assert.equal(stored.items.length,21);assert.equal(stored.items[0].jev.requiresReview,true)
 const host=fs.readFileSync('src/main/pluginHost.ts','utf8');assert.equal(host.includes('attachJevSuggestion(project.cwd'),false)
})
