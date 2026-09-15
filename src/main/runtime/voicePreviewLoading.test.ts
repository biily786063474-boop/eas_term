import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
import {createVoicePreviewLink} from '../voicePreviewSession.ts'
import {createVoicePreviewPool} from '../voicePreviewPool.ts'
const tick=()=>new Promise(r=>setImmediate(r))
test('actual preview factory: model only inside an isolated worker; worker is reused across leases; a crashed worker is replaced', async () => {
 const source=readFileSync(new URL('../stt.ts',import.meta.url),'utf8')
 const block=source.slice(source.indexOf('// 流式识别 worker 常驻池'),source.indexOf('// ---------- 离线识别器')).replace('export function','function')
 const workers:any[]=[]
 class OwnedWorker extends EventEmitter {stops=0;options:any;constructor(_code:string,options:any){super();this.options=options;workers.push(this)}unref(){}postMessage(){}terminate(){this.stops++;return Promise.resolve(0)}}
 const require={resolve:()=>'/sherpa/index.js'}
 const timers:{fn:()=>void}[]=[]
 const deps={Worker:OwnedWorker,createVoicePreviewLink,createVoicePreviewPool,readyDir:()=>'/model',MODELS:{stream:{}},require,voicePreviewWorkerCode:'isolated model code',setTimeout:(fn:()=>void)=>{const t={fn,unref(){}};timers.push(t);return t},clearTimeout:(t:any)=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1)}}
 const api=new Function(...Object.keys(deps),ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return {createPreviewWorker,dropVoicePreviewWorker}')(...Object.values(deps))
 // 第一次：建 worker，模型加载失败 → lease.ready 拒绝；worker 被 terminate
 const first=api.createPreviewWorker(()=>{},()=>{}),rejected=assert.rejects(first.ready,/load failed/)
 assert.equal(workers.length,1);assert.deepEqual(workers[0].options,{eval:true,execArgv:[],workerData:{dir:'/model',sherpaPath:'/sherpa/index.js'}})
 workers[0].emit('message',{type:'fatal',error:'load failed'});await rejected;await first.completed
 assert.equal(workers[0].stops,1);workers[0].emit('exit',1);await tick()
 // 第二次：上一条死了，重建；这次就绪
 const second=api.createPreviewWorker(()=>{},()=>{});assert.equal(workers.length,2)
 workers[1].emit('message',{type:'ready'});await second.ready
 second.stop();await second.completed;await tick()
 assert.equal(workers[1].stops,0,'lease 结束不杀 worker');assert.equal(timers.length,1,'开始闲置计时')
 // 第三次：复用同一条 worker，立即就绪，不再 new Worker
 const third=api.createPreviewWorker(()=>{},()=>{});assert.equal(workers.length,2);assert.equal(timers.length,0,'再次使用取消闲置计时')
 let ready=false;void third.ready.then(()=>ready=true);await tick();assert.equal(ready,true)
 third.stop();await third.completed;await tick()
 // 闲置到时 → 释放
 timers[0].fn();assert.equal(workers[1].stops,1)
 workers[1].emit('exit',0);await tick()
 const fourth=api.createPreviewWorker(()=>{},()=>{});assert.equal(workers.length,3);fourth.stop()
 api.dropVoicePreviewWorker();assert.equal(workers[2].stops,1)
})
