import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,queuedSessionStarts,cancelSessionStart} from './sessionStartup.ts'
import {sharedServices} from './sharedServices.ts'
import {createManagedAsr} from './managedAsr.ts'
const tick=()=>new Promise(r=>setImmediate(r))
test('shared ASR admission precedes creation, keeps idle reservation and releases only on exit',async()=>{
 let now=0,starts=0,stops=0,exit!:()=>void,ready!:()=>void
 const manager=createRuntimeManager({now:()=>now,maxRunning:1});installSessionStartup(manager)
 const sample=()=>manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
 const cache=createManagedAsr(()=>{starts++;return {value:{generation:starts},ready:new Promise<void>(r=>ready=r),completed:new Promise<void>(r=>exit=r),stop(){stops++}}})
 const a=Object.assign(new EventEmitter(),{id:21,isDestroyed:()=>false})
 const b=Object.assign(new EventEmitter(),{id:22,isDestroyed:()=>false})
 const first=cache.get(a),second=cache.get(b)
 const firstRejected=assert.rejects(first,/cancelled/)
 assert.equal(starts,0)
 const id=queuedSessionStarts(21)[0].id
 assert.equal(cancelSessionStart(id,21),false,'one window cannot cancel both windows startup')
 a.emit('did-navigate');sample();await tick();assert.equal(starts,1)
 ready();await firstRejected;assert.equal((await second)?.generation,1)
 assert.equal(manager.snapshot().running,0,'resident model cannot occupy a decode execution slot')
 const held=manager.snapshot().reserved.memoryBytes;assert.ok(held>0)
 assert.equal(sharedServices.list(21).length,0);assert.equal(sharedServices.list(22)[0].kind,'voice')
 assert.equal((await cache.get(b))?.generation,1);assert.equal(starts,1)
 assert.equal((await sharedServices.stop(id,22,async()=>true)).ok,true)
 assert.equal(stops,1);assert.equal(manager.snapshot().reserved.memoryBytes,held)
 exit();await tick();assert.equal(manager.snapshot().reserved.memoryBytes,0)
 const cancelled=cache.get(b);const rejected=assert.rejects(cancelled,/cancelled/)
 b.emit('render-process-gone');await rejected;assert.equal(starts,1)
 const init=cache.get(b),initRejected=assert.rejects(init,/cancelled/)
 sample();await tick();assert.equal(starts,2)
 b.emit('destroyed');assert.equal(stops,2,'last owner departure stops initialization')
 let settled=false;void init.then(()=>settled=true,()=>settled=true)
 await tick();assert.equal(settled,false);assert.ok(manager.snapshot().reserved.memoryBytes>0)
 ready();await tick();assert.equal(settled,false,'late ready cannot release before exit')
 exit();await initRejected;await tick();assert.equal(manager.snapshot().reserved.memoryBytes,0)
 manager.dispose()
})
