import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import * as preview from './voicePreviewAdmission.ts'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,queuedSessionStarts,cancelSessionStart} from './sessionStartup.ts'
import {ownedSessions} from './ownedSessions.ts'
const turn=()=>new Promise(r=>setImmediate(r))
test('preview resident admission cancels loading immediately but retains budget until actual exit',async()=>{
 const open=(preview as any).openManagedPreview
 assert.equal(typeof open,'function','worker residency must replace allocation-only admission')
 let now=0,starts=0,stops=0,resolveReady!:()=>void,rejectReady!:(e:Error)=>void,exit!:()=>void
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 const owner=Object.assign(new EventEmitter(),{id:91,isDestroyed:()=>false}),errors:string[]=[]
 const create=()=>{starts++;return {ready:new Promise<void>((r,j)=>{resolveReady=r;rejectReady=j}),completed:new Promise<void>(r=>exit=r),stop(){stops++;rejectReady(Error('stopped'))},push:()=>true,takeText:async()=>''}}
 const signal=new AbortController(),waiting=open(owner,signal.signal,create,(e:string)=>errors.push(e))
 const rejected=assert.rejects(waiting,/cancelled/)
 assert.equal(starts,0);assert.equal(cancelSessionStart(queuedSessionStarts(owner.id)[0].id,92),false)
 signal.abort();await rejected;assert.equal(starts,0)
 const nextSignal=new AbortController(),loading=open(owner,nextSignal.signal,create,(e:string)=>errors.push(e))
 const failed=assert.rejects(loading,/cancelled|stopped/)
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false});await turn()
 assert.equal(starts,1);const held=manager.snapshot().reserved.memoryBytes;assert.ok(held>0)
 nextSignal.abort();await turn();assert.equal(stops,1,'cancel must terminate before worker ready')
 assert.equal(manager.snapshot().reserved.memoryBytes,held)
 exit();await failed;await turn();assert.equal(manager.snapshot().reserved.memoryBytes,0)
 assert.equal(owner.listenerCount('destroyed'),0)
 const normal=open(owner,new AbortController().signal,create,(e:string)=>errors.push(e))
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false});await turn();resolveReady();const session=await normal
 assert.equal(manager.snapshot().running,0);assert.ok(manager.snapshot().reserved.memoryBytes>0)
 const item=ownedSessions.list(owner.id)[0];assert.equal(item.kind,'voice')
 assert.equal((await ownedSessions.stop(item.id,92,async()=>true)).ok,false)
 assert.equal((await ownedSessions.stop(item.id,owner.id,async()=>true)).ok,true)
 assert.equal(errors.length,1,'manual service stop must notify recording UI')
 session.stop();assert.equal(stops,2,'manual plus caller stop must be idempotent')
 assert.ok(manager.snapshot().reserved.memoryBytes>0);exit();await session.completed;await turn()
 assert.equal(manager.snapshot().reserved.memoryBytes,0);assert.equal(ownedSessions.list(owner.id).length,0)
 manager.dispose()
})
