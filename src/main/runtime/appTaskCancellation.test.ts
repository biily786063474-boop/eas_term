import {managedStage} from '../cliUpdates/managedStage.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,runAppTask} from './sessionStartup.ts'
test('app owner abort removes indefinite queued work; running lease waits for real completion',async()=>{
 let now=0,starts=0;const m=createRuntimeManager({now:()=>now});installSessionStartup(m)
 const controller=new AbortController()
 const promise=runAppTask({id:'app',name:'download',signal:controller.signal,cost:{cpu:1,memoryBytes:1},start:async()=>{starts++;return {result:Promise.resolve(),completed:Promise.resolve()}}})
 const settled=promise.catch(e=>e)
 controller.abort();await new Promise(r=>setImmediate(r))
 assert.equal(m.snapshot().queued,0);assert.match(String(await settled),/cancelled/);assert.equal(starts,0)
 const updater=new AbortController()
 const stage=managedStage('/fixture','codex','1.2.3',updater.signal,{stage:async()=>{starts++}})
 const stageResult=stage.catch(e=>e);updater.abort();await new Promise(r=>setImmediate(r))
 assert.equal(m.snapshot().queued,0);assert.match(String(await stageResult),/cancelled/);assert.equal(starts,0)
 const cancelled=new AbortController();cancelled.abort()
 await assert.rejects(runAppTask({id:'already',name:'download',signal:cancelled.signal,cost:{cpu:1,memoryBytes:1},start:async()=>{throw Error('must not start')}}),/cancelled/)
 let finish!:()=>void,received!:AbortSignal
 const running=new AbortController()
 m.update({at:now,cpu:10,memoryUsedBytes:100,totalMemoryBytes:1000,critical:false})
 const work=runAppTask({id:'running',name:'download',signal:running.signal,cost:{cpu:1,memoryBytes:1},start:async signal=>{received=signal;return {result:new Promise(()=>{}),completed:new Promise<void>(r=>finish=r)}}})
 const rejected=assert.rejects(work,/cancelled/)
 await new Promise(r=>setImmediate(r));running.abort();await rejected
 assert.equal(received.aborted,true);assert.equal(m.snapshot().running,1);assert.deepEqual(m.snapshot().reserved,{cpu:1,memoryBytes:1})
 finish();await new Promise(r=>setImmediate(r));assert.equal(m.snapshot().running,0);assert.deepEqual(m.snapshot().reserved,{cpu:0,memoryBytes:0});m.dispose()
})
