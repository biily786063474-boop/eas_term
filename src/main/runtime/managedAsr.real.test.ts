import {test} from 'node:test'
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {Worker} from 'node:worker_threads'
import {EventEmitter} from 'node:events'
import {voiceAsrWorkerCode} from '../voiceAsrWorker.ts'
import {trackAsrWorker} from './asrWorkerLifecycle.ts'
import {createManagedAsr} from './managedAsr.ts'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,queuedSessionStarts,cancelSessionStart} from './sessionStartup.ts'
import {sharedServices} from './sharedServices.ts'
const dir=path.resolve('resources/models/sherpa-onnx-sense-voice')
test('real ASR model initializes only after admission and confirmed stop releases its resident lease',{skip:!existsSync(path.join(dir,'model.int8.onnx')),timeout:45000},async()=>{
 let now=0,starts=0
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 const handles:ReturnType<typeof trackAsrWorker<Worker>>[]=[]
 const cache=createManagedAsr(()=>{
  starts++
  const h=trackAsrWorker(new Worker(voiceAsrWorkerCode,{eval:true,execArgv:[],workerData:{dir,sherpaPath:createRequire(import.meta.url).resolve('sherpa-onnx')}}))
  handles.push(h);return h
 })
 const owner=Object.assign(new EventEmitter(),{id:31,isDestroyed:()=>false})
 try{
  const canceled=cache.get(owner),rejection=assert.rejects(canceled,/cancelled/)
  assert.equal(starts,0);cancelSessionStart(queuedSessionStarts(31)[0].id,31);await rejection;assert.equal(starts,0)
  const loading=cache.get(owner)
  manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
  const worker=await loading;assert.ok(worker);assert.equal(starts,1)
  assert.equal(manager.snapshot().running,0);assert.ok(manager.snapshot().reserved.memoryBytes>0)
  const service=sharedServices.list(31)[0];assert.equal(service.kind,'voice')
  assert.equal((await sharedServices.stop(service.id,31,async()=>true)).ok,true)
  await handles[0].completed;await new Promise(r=>setImmediate(r))
  assert.equal(manager.snapshot().reserved.memoryBytes,0);assert.equal(sharedServices.list(31).length,0)
 }finally{for(const h of handles)h.stop();await Promise.all(handles.map(h=>h.completed));manager.dispose()}
})
