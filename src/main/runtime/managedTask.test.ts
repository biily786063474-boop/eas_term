import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,runManagedTask,cancelSessionStart,queuedSessionStarts} from './sessionStartup.ts'
test('managed worker task queues and holds capacity after caller result until actual completion',async()=>{
 let now=0
 const m=createRuntimeManager({now:()=>now,maxRunning:1});installSessionStartup(m)
 let starts=0,finish!:()=>void
 const start=async()=>{starts++;return {result:Promise.resolve('caller-result'),completed:new Promise<void>(r=>finish=r)}}
 const cancelled=runManagedTask({id:'cancel',windowId:1,name:'解码',projectId:null,cost:{cpu:5,memoryBytes:100},start})
 assert.equal(starts,0);assert.equal(cancelSessionStart('cancel',2),false);cancelSessionStart('cancel',1);await assert.rejects(cancelled,/cancelled/)
 const value=runManagedTask({id:'active',windowId:1,name:'解码',projectId:null,cost:{cpu:5,memoryBytes:100},start})
 m.update({at:0,cpu:1,memoryUsedBytes:1,totalMemoryBytes:10000,critical:false});assert.equal(await value,'caller-result')
 assert.equal(m.snapshot().running,1);assert.equal(m.snapshot().reserved.memoryBytes,100);assert.equal(queuedSessionStarts(1).length,1)
 finish();await new Promise(r=>setImmediate(r));assert.equal(m.snapshot().running,0);assert.equal(m.snapshot().reserved.memoryBytes,0);assert.equal(queuedSessionStarts(1).length,0);
 let signal!:AbortSignal, complete!:()=>void, result!:(v:string)=>void
 const active=runManagedTask({id:'cancel-running',windowId:1,name:'decode',projectId:null,cost:{cpu:5,memoryBytes:100},start:async s=>{signal=s;return {result:new Promise<string>(r=>result=r),completed:new Promise<void>(r=>complete=r)}}})
 now=1;m.update({at:now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:10000,critical:false})
 const rejected=assert.rejects(active,/cancelled/)
 await new Promise(r=>setImmediate(r));assert.equal(cancelSessionStart('cancel-running',1),true);assert.equal(signal.aborted,true)
 assert.equal(m.snapshot().reserved.memoryBytes,100);assert.equal(m.snapshot().running,1)
 result('late result must not win cancellation');await rejected;assert.equal(m.snapshot().reserved.memoryBytes,100)
 complete();await new Promise(r=>setImmediate(r));assert.equal(m.snapshot().reserved.memoryBytes,0);assert.equal(queuedSessionStarts(1).length,0)
 m.dispose()
})
