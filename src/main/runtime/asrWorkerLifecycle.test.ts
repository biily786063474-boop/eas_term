import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {trackAsrWorker} from './asrWorkerLifecycle.ts'
const tick=()=>new Promise(r=>setImmediate(r))
test('ASR readiness is explicit, failed observation does not masquerade as worker exit',async()=>{
 class FakeWorker extends EventEmitter {stops=0;terminate(){this.stops++;return Promise.resolve(0)}}
 const worker=new FakeWorker(),handle=trackAsrWorker(worker)
 let initialized=false,completed=false
 void handle.ready.then(()=>initialized=true,()=>{})
 void handle.completed.then(()=>completed=true)
 await tick();assert.equal(initialized,false)
 worker.emit('message',{type:'ready'});await handle.ready;assert.equal(initialized,true)
 handle.stop();handle.stop();assert.equal(worker.stops,1)
 await tick();assert.equal(completed,false)
 worker.emit('exit',0);await handle.completed;assert.equal(completed,true)
 const failed=new FakeWorker(),bad=trackAsrWorker(failed)
 const rejection=assert.rejects(bad.ready,/initialization|初始化/)
 failed.emit('message',{type:'fatal',err:'initialization failed'});await rejection
 let exited=false;void bad.completed.then(()=>exited=true);await tick();assert.equal(exited,false)
 failed.emit('exit',1);await bad.completed
})
