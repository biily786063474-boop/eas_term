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
import {createVoicePreviewLink} from './voicePreviewSession.ts'
const dir=path.resolve('resources/models/sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13')
const wav=path.join(dir,'test_wavs/DEV_T0000000000.wav')
test('real streaming model: first lease loads the model, second lease on the same worker is ready in milliseconds, main heartbeat never blocks',{skip:!fs.existsSync(wav),timeout:90000},async()=>{
 const bytes=fs.readFileSync(wav);let offset=12,data:Buffer|undefined
 while(offset+8<=bytes.length){const size=bytes.readUInt32LE(offset+4),tag=bytes.toString('ascii',offset,offset+4);if(tag==='fmt '){assert.equal(bytes.readUInt16LE(offset+8),1);assert.equal(bytes.readUInt16LE(offset+10),1);assert.equal(bytes.readUInt32LE(offset+12),16000)}if(tag==='data'){data=bytes.subarray(offset+8,offset+8+size);break}offset+=8+size+(size%2)}
 assert.ok(data)
 const audio=Float32Array.from({length:data.length/2},(_,i)=>data!.readInt16LE(i*2)/32768)
 let now=0
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:true}) // 严重压力也不排队
 const owner=Object.assign(new EventEmitter(),{id:37,isDestroyed:()=>false})
 let beats=0,received:(()=>void)|undefined;const errors:string[]=[]
 const link=createVoicePreviewLink(new Worker(voicePreviewWorkerCode,{eval:true,execArgv:[],workerData:{dir,sherpaPath:createRequire(import.meta.url).resolve('sherpa-onnx')}}))
 const t0=performance.now()
 const session=await openManagedPreview(owner,new AbortController().signal,()=>link.open(()=>received?.(),(e:string)=>errors.push(e)),(e:string)=>errors.push(e))
 const coldMs=performance.now()-t0
 assert.equal(manager.snapshot().reserved.memoryBytes,0,'no admission budget for voice');assert.equal(ownedSessions.list(owner.id).length,1)
 const timer=setInterval(()=>beats++,10)
 try{
  for(let i=0;i<audio.length;i+=1024){const partial=new Promise<void>(r=>{received=r});assert.equal(session.push(audio.slice(i,i+1024),'fixture'),true);await partial}
  const text=await session.takeText();assert.ok(text.length>0,'real audio must yield text')
  assert.equal(await session.takeText(),'','drained text cannot replay in next sentence')
  assert.ok(beats>0);assert.equal(errors.length,0)
 }finally{session.stop();await session.completed;await new Promise(r=>setImmediate(r));clearInterval(timer);assert.equal(ownedSessions.list(owner.id).length,0)}
 // 第二次录音：同一条 link，模型已在内存里，就绪应是毫秒级（第一次是秒级）
 const t1=performance.now()
 const again=await openManagedPreview(owner,new AbortController().signal,()=>link.open(()=>received?.(),(e:string)=>errors.push(e)),(e:string)=>errors.push(e))
 const warmMs=performance.now()-t1
 assert.ok(warmMs<200,`warm lease should be instant, got ${warmMs.toFixed(0)}ms (cold was ${coldMs.toFixed(0)}ms)`)
 assert.ok(coldMs>warmMs*5,'cold load must be the expensive one')
 for(let i=0;i<Math.min(audio.length,8192);i+=1024){const partial=new Promise<void>(r=>{received=r});assert.equal(again.push(audio.slice(i,i+1024),'fixture'),true);await partial}
 again.stop();await again.completed
 link.terminate();await link.exited;manager.dispose()
})
