import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,runManagedTask,cancelSessionStartsForWindow} from './sessionStartup.ts'
import {createManagedAsr} from './managedAsr.ts'
import {trackAsrWorker} from './asrWorkerLifecycle.ts'
import {sharedServices} from './sharedServices.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
import {createWorkerRequests} from './workerRequests.ts'
const tick=()=>new Promise(r=>setImmediate(r))
test('actual ASR wiring admits residency before decode and retains idle budget until actual exit',async()=>{
 let now=0
 const manager=createRuntimeManager({now:()=>now,maxRunning:1});installSessionStartup(manager)
 const sample=()=>manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:16*1024**3,critical:false})
 const source=fs.readFileSync(new URL('../stt.ts',import.meta.url),'utf8')
 const block=source.slice(source.indexOf('let worker: Worker'),source.indexOf('// ---------- 首次使用下载模型'))
 const js=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const workers:any[]=[]
 class FakeWorker extends EventEmitter{messages:any[]=[];stops=0;constructor(){super();workers.push(this);queueMicrotask(()=>this.emit('message',{type:'ready'}))}unref(){}postMessage(m:any){this.messages.push(m)}terminate(){this.stops++;return Promise.resolve(0)}}
 const deps={Worker:FakeWorker,createWorkerRequests,readyDir:()=>'/test',MODELS:{sense:{}},require:{resolve:()=>'/test/sherpa'},voiceAsrWorkerCode:'',console:{error(){}},runManagedTask,cancelSessionStartsForWindow,createManagedAsr,trackAsrWorker}
 const run=new Function(...Object.keys(deps),js+';return {transcribeAsync,size(){return pending.size}}')(...Object.values(deps))
 const owner=Object.assign(new EventEmitter(),{id:1,isDestroyed:()=>false})
 const a=run.transcribeAsync(new Float32Array(10),1,owner)
 assert.equal(workers.length,0);sample();await tick()
 assert.equal(workers.length,1);assert.equal(workers[0].messages.length,0,'no decode inside model startup slot')
 assert.equal(sharedServices.list(1).length,1,'resident model must be visible before decoding')
 sample();assert.equal(await a,null);assert.equal(run.size(),1)
 const held=manager.snapshot().reserved.memoryBytes
 const b=run.transcribeAsync(new Float32Array(10),1000,owner);await tick();sample();await tick()
 assert.equal(workers[0].messages.length,1,'timed-out actual work still holds decode slot')
 workers[0].emit('message',{type:'result',id:workers[0].messages[0].id,text:'late'})
 await tick();sample();await tick()
 workers[0].emit('message',{type:'result',id:workers[0].messages[1].id,text:'ok'})
 assert.equal(await b,'ok');await tick();assert.equal(run.size(),0)
 assert.ok(manager.snapshot().reserved.memoryBytes>0,'idle resident model must retain budget')
 assert.ok(manager.snapshot().reserved.memoryBytes<held)
 const failed=run.transcribeAsync(new Float32Array(10),1000,owner);await tick();sample();await tick()
 workers[0].emit('message',{type:'result',id:workers[0].messages.at(-1).id,text:'',error:'decode failed'})
 assert.equal(await failed,null,'worker failures must not become valid silence');await tick()
 owner.emit('did-navigate');assert.ok(workers[0].stops>0)
 assert.ok(manager.snapshot().reserved.memoryBytes>0)
 workers[0].emit('exit',0);await tick();assert.equal(manager.snapshot().reserved.memoryBytes,0)
 // A delayed error from the retired generation must not stop a replacement.
 const next=run.transcribeAsync(new Float32Array(10),1000,owner);await tick();sample();await tick()
 assert.equal(workers.length,2);workers[0].emit('error',Error('retired'));assert.equal(workers[1].stops,0)
 sample();await tick();workers[1].emit('message',{type:'result',id:workers[1].messages[0].id,text:'new'})
 assert.equal(await next,'new');owner.emit('destroyed');workers[1].emit('exit',0);await tick();manager.dispose()
})
