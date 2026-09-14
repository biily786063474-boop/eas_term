import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
import {createVoicePreviewSession} from '../voicePreviewSession.ts'
test('actual preview factory allocates model only inside isolated worker and failed startup waits for exit',async()=>{
 const source=readFileSync(new URL('../stt.ts',import.meta.url),'utf8')
 const block=source.slice(source.indexOf('function createPreviewWorker'),source.indexOf('// ---------- 离线识别器'))
 const workers:any[]=[]
 class OwnedWorker extends EventEmitter {stops=0;options:any;constructor(_code:string,options:any){super();this.options=options;workers.push(this)}unref(){}postMessage(){}terminate(){this.stops++;return Promise.resolve(0)}}
 const require={resolve:()=>'/sherpa/index.js'}
 const deps={Worker:OwnedWorker,createVoicePreviewSession,readyDir:()=>'/model',MODELS:{stream:{}},require,voicePreviewWorkerCode:'isolated model code'}
 const create=new Function(...Object.keys(deps),ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return createPreviewWorker')(...Object.values(deps))
 const session=create(()=>{},()=>{}),rejected=assert.rejects(session.ready,/load failed/)
 assert.equal(workers.length,1);assert.deepEqual(workers[0].options,{eval:true,execArgv:[],workerData:{dir:'/model',sherpaPath:'/sherpa/index.js'}})
 workers[0].emit('message',{type:'fatal',error:'load failed'});await rejected
 let closed=false;void session.completed.then(()=>closed=true);await new Promise(r=>setImmediate(r))
 assert.equal(closed,false);assert.equal(workers[0].stops,1)
 workers[0].emit('exit',1);await session.completed
})
