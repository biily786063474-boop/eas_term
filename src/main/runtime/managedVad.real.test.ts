import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {Worker} from 'node:worker_threads'
import {EventEmitter} from 'node:events'
import ts from 'typescript'
import {voiceVadWorkerCode} from '../voiceVadWorker.ts'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,startManagedSession,cancelSessionStart,queuedSessionStarts} from './sessionStartup.ts'
import {createOwnedSessions} from './ownedSessions.ts'
const model=path.resolve('resources/models/sherpa-onnx-silero-vad/silero_vad.onnx')
test('actual VAD worker is admitted before creation and resident budget ends on worker exit',{skip:!fs.existsSync(model),timeout:30000},async()=>{
 const compile=(file:string)=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const raw=new Function('Worker','voiceVadWorkerCode','require',compile('../voiceVad.ts')+';return openVoiceVad')(Worker,voiceVadWorkerCode,createRequire(import.meta.url))
 let now=0,starts=0
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 const owned=createOwnedSessions(()=>now)
 const open=new Function('startManagedSession','cancelSessionStart','ownedSessions','openVoiceVad',compile('./managedVad.ts')+';return openManagedVad')(startManagedSession,cancelSessionStart,owned,(...args:any[])=>{starts++;return raw(...args)})
 const owner=Object.assign(new EventEmitter(),{id:11,isDestroyed:()=>false}),errors:string[]=[]
 let session:any
 try {
  const cancelled=open(owner,model,()=>{},(s:string)=>errors.push(s));const rejected=assert.rejects(cancelled,/cancelled/)
  cancelSessionStart(queuedSessionStarts(11)[0].id,11);await rejected;assert.equal(starts,0)
  const ready=open(owner,model,()=>{},(s:string)=>errors.push(s));assert.equal(starts,0)
  manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
  session=await ready;assert.equal(starts,1);assert.equal(manager.snapshot().running,0);assert.ok(manager.snapshot().reserved.memoryBytes>0)
  assert.equal(session.push(new Float32Array(2048),'fixture'),true);await session.drain()
  assert.equal(errors.length,0);assert.equal(owned.list(11).length,1)
  await owned.stop(owned.list(11)[0].id,11,async()=>true)
  await session.completed;await new Promise(r=>setImmediate(r))
  assert.equal(manager.snapshot().reserved.memoryBytes,0);assert.equal(owned.list(11).length,0);assert.equal(errors.length,1)
 } finally {session?.stop();if(session)await session.completed;manager.dispose()}
})
