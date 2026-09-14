import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,queuedSessionStarts} from './sessionStartup.ts'
import {openManagedPreview} from './voicePreviewAdmission.ts'
const tick=()=>new Promise(r=>setImmediate(r))
test('preview allocation is cancelled between admission and spawn; navigation tears down resident worker',async()=>{
 let now=0,loads=0,stops=0,exit!:()=>void
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 const owner=Object.assign(new EventEmitter(),{id:4,isDestroyed:()=>false})
 const create=()=>{loads++;return {ready:Promise.resolve(),completed:new Promise<void>(r=>exit=r),stop(){stops++},push:()=>true,takeText:async()=>''}}
 const race=new AbortController(),raced=openManagedPreview(owner,race.signal,create,()=>{})
 const rejected=assert.rejects(raced,/cancelled/)
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
 race.abort();await rejected;await tick();assert.equal(loads,0)
 assert.equal(queuedSessionStarts(4).length,0)
 const live=openManagedPreview(owner,new AbortController().signal,create,()=>{})
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false});const session=await live
 owner.emit('did-navigate');assert.equal(stops,1);assert.ok(manager.snapshot().reserved.memoryBytes>0)
 exit();await session.completed;await tick();assert.equal(manager.snapshot().reserved.memoryBytes,0)
 assert.equal(owner.listenerCount('did-navigate'),0);manager.dispose()
})
