import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {EventEmitter} from 'node:events'
import ts from 'typescript'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,startManagedSession,cancelSessionStart,queuedSessionStarts} from './sessionStartup.ts'
import {createOwnedSessions} from './ownedSessions.ts'
test('managed VAD queues before worker launch, isolates cancellation and retains resident budget until exit',async()=>{
 const source=readFileSync(new URL('./managedVad.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ','')
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let now=0,starts=0,stops=0,exit!:()=>void
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 const owned=createOwnedSessions(()=>now),notices:string[]=[]
 const owner=Object.assign(new EventEmitter(),{id:7,isDestroyed:()=>false})
 const raw=async()=>{starts++;return {completed:new Promise<void>(r=>exit=r),stop(){stops++},drain:async()=>{},push:()=>true}}
 const open=new Function('startManagedSession','cancelSessionStart','ownedSessions','openVoiceVad',js+';return openManagedVad')(startManagedSession,cancelSessionStart,owned,raw)
 const args=[owner,'/model',()=>{},(message:string)=>notices.push(message),false]
 const cancelled=open(...args);const cancellation=assert.rejects(cancelled,/cancelled/)
 assert.equal(starts,0);const id=queuedSessionStarts(7)[0].id
 assert.equal(cancelSessionStart(id,8),false);assert.equal(cancelSessionStart(id,7),true);await cancellation;assert.equal(starts,0)
 assert.equal(owner.listenerCount('destroyed'),0)
 const waiting=open(...args);assert.equal(starts,0)
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
 await waiting;assert.equal(starts,1);assert.equal(manager.snapshot().running,0)
 const held=manager.snapshot().reserved.memoryBytes;assert.ok(held>0)
 assert.equal(owned.list(8).length,0);assert.equal(owned.list(7)[0].kind,'voice')
 assert.equal((await owned.stop(owned.list(7)[0].id,7,async()=>true)).ok,true)
 assert.equal(stops,1);assert.equal(notices.length,1);assert.equal(manager.snapshot().reserved.memoryBytes,held)
 exit();await new Promise(r=>setImmediate(r));assert.equal(manager.snapshot().reserved.memoryBytes,0);assert.equal(owned.list(7).length,0)
 assert.equal(owner.listenerCount('destroyed'),0)
 const aborter=new AbortController()
 const aborted=open(...args,aborter.signal);const rejected=assert.rejects(aborted,/cancelled/)
 aborter.abort();assert.equal(queuedSessionStarts(7).length,0,'recording cancellation removes waiting VAD immediately');await rejected;assert.equal(starts,1);assert.equal(queuedSessionStarts(7).length,0)
 const next=open(...args);manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false});await next
 owner.emit('did-navigate');assert.equal(stops,2);assert.ok(manager.snapshot().reserved.memoryBytes>0)
 exit();await new Promise(r=>setImmediate(r));assert.equal(manager.snapshot().reserved.memoryBytes,0);manager.dispose()
})
