import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
test('VAD stop is idempotent and completion waits for actual worker exit',async()=>{
 const source=fs.readFileSync(new URL('../voiceVad.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ','')
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let w:any
 class Fake extends EventEmitter{stops=0;constructor(){super();w=this;queueMicrotask(()=>this.emit('message',{ready:true}))}terminate(){this.stops++;return Promise.resolve(0)}}
 const open=new Function('Worker','voiceVadWorkerCode','require',js+';return openVoiceVad')(Fake,'',{resolve:()=>'/test'})
 const session=await open('/test',()=>{},()=>{})
 assert.ok(session.completed instanceof Promise);let done=false;void session.completed.then(()=>done=true)
 session.stop();session.stop();await Promise.resolve();assert.equal(w.stops,1);assert.equal(done,false)
 w.emit('exit',0);await session.completed;assert.equal(done,true)
})
test('VAD exit before readiness rejects without waiting for initialization timeout',async()=>{
 const source=fs.readFileSync(new URL('../voiceVad.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ','')
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const timers:(()=>void)[]=[]
 class Fake extends EventEmitter{constructor(){super();queueMicrotask(()=>this.emit('exit',1))}terminate(){return Promise.resolve(0)}}
 const open=new Function('Worker','voiceVadWorkerCode','require','setTimeout','clearTimeout',js+';return openVoiceVad')(Fake,'',{resolve:()=>'/test'},(fn:()=>void)=>{timers.push(fn);return 1},()=>{})
 let failed=false;const pending=open('/test',()=>{},()=>{}).catch(()=>{failed=true})
 await new Promise(r=>setImmediate(r))
 try{assert.equal(failed,true)}finally{timers.forEach(fn=>fn());await pending}
})
test('VAD initialization error retains its startup lifetime until worker actually exits',async()=>{
 const source=fs.readFileSync(new URL('../voiceVad.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ','')
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let worker:any
 class Fake extends EventEmitter{constructor(){super();worker=this;queueMicrotask(()=>this.emit('message',{error:'init failed'}))}terminate(){return Promise.resolve(0)}}
 const open=new Function('Worker','voiceVadWorkerCode','require',js+';return openVoiceVad')(Fake,'',{resolve:()=>'/test'})
 let settled=false;const result=open('/test',()=>{},()=>{}).catch(()=>{settled=true})
 await new Promise(r=>setImmediate(r))
 try {assert.equal(settled,false,'requesting termination must not release startup capacity')} finally {worker.emit('exit',1);await result}
 assert.equal(settled,true)
})
