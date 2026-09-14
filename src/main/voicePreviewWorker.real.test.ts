import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {Worker} from 'node:worker_threads'
import {EventEmitter} from 'node:events'
import {createRuntimeManager} from './runtime/manager.ts'
import {installSessionStartup} from './runtime/sessionStartup.ts'
import {openManagedPreview} from './runtime/voicePreviewAdmission.ts'
import {ownedSessions} from './runtime/ownedSessions.ts'
import {voicePreviewWorkerCode} from './voicePreviewWorker.ts'
import {createVoicePreviewSession} from './voicePreviewSession.ts'
const dir=path.resolve('resources/models/sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13')
const wav=path.join(dir,'test_wavs/DEV_T0000000000.wav')
test('real streaming model decodes fixture in a worker, drains once and exits without blocking main heartbeat',{skip:!fs.existsSync(wav),timeout:60000},async()=>{
 const bytes=fs.readFileSync(wav);let offset=12,data:Buffer|undefined
 while(offset+8<=bytes.length){const size=bytes.readUInt32LE(offset+4),tag=bytes.toString('ascii',offset,offset+4);if(tag==='fmt '){assert.equal(bytes.readUInt16LE(offset+8),1);assert.equal(bytes.readUInt16LE(offset+10),1);assert.equal(bytes.readUInt32LE(offset+12),16000);assert.equal(bytes.readUInt16LE(offset+22),16)}if(tag==='data'){data=bytes.subarray(offset+8,offset+8+size);break}offset+=8+size+(size%2)}
 assert.ok(data)
 const audio=Float32Array.from({length:data.length/2},(_,i)=>data!.readInt16LE(i*2)/32768)
 let now=0,worker:Worker|undefined
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 const owner=Object.assign(new EventEmitter(),{id:37,isDestroyed:()=>false})
 let beats=0,received!:()=>void;const errors:string[]=[]
 const waiting=openManagedPreview(owner,new AbortController().signal,()=>{
  worker=new Worker(voicePreviewWorkerCode,{eval:true,execArgv:[],workerData:{dir,sherpaPath:createRequire(import.meta.url).resolve('sherpa-onnx')}})
  return createVoicePreviewSession(worker,()=>received?.(),e=>errors.push(e))
 },e=>errors.push(e))
 assert.equal(worker,undefined,'no worker before real resource admission')
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
 const session=await waiting
 assert.equal(manager.snapshot().running,0);assert.ok(manager.snapshot().reserved.memoryBytes>0)
 assert.equal(ownedSessions.list(owner.id).length,1)
 const timer=setInterval(()=>beats++,10)
 try{
  await session.ready
  for(let i=0;i<audio.length;i+=1024){const partial=new Promise<void>(r=>received=r);assert.equal(session.push(audio.slice(i,i+1024),'fixture'),true);await partial}
  const text=await session.takeText();assert.ok(text.length>0,'real audio must yield text')
  assert.equal(await session.takeText(),'','drained text cannot replay in next sentence')
  assert.ok(beats>0);assert.deepEqual(errors,[])
 }finally{session.stop();await session.completed;await new Promise(r=>setImmediate(r));clearInterval(timer);assert.equal(manager.snapshot().reserved.memoryBytes,0);assert.equal(ownedSessions.list(owner.id).length,0);manager.dispose()}
})
