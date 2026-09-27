import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {EventEmitter} from 'node:events'
import {createRuntimeManager} from './manager.ts'
import * as startup from './sessionStartup.ts'
import {startupFailure} from './startupFailure.ts'
import {admitCliTurn,cliTurnQueue,onCliDispatchChange} from './cliDispatch.ts'
const source=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const names=['restartAndDeliver','cancelRuntimeStartup','dispatchCli','finishCliDispatch','cancelCliAdmission']
const code=ts.transpileModule(source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const flush=()=>new Promise(r=>setImmediate(r))
async function until(check:()=>boolean){const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,'condition deadline');await new Promise(r=>setTimeout(r,10))}}
test('critical pressure gained during dispatch wait requeues without sending; recovery or cancellation settles exactly once',async()=>{
 let now=0,starts=0
 const manager=createRuntimeManager({now:()=>now});startup.installSessionStartup(manager)
 const sample=(critical:boolean)=>manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical})
 cliTurnQueue.setLimit(1)
 const keepAlive=setInterval(()=>{},1000)
 try{for(const outcome of ['recover','cancel','destroy']){
  sample(false)
  const blocker=await admitCliTurn({sessionId:'block-'+outcome,projectId:'block',signal:new AbortController().signal,start(){},cancelRunning(){}})
  const events:any[]=[];let destroyed=false
  const live:any={rec:{id:outcome,cli:'claude',cwd:'/fixture',alive:false,busy:true},wcId:1,wc:{isDestroyed:()=>destroyed}}
  const sessions=new Map([[outcome,live]])
  const api=runInNewContext(code+'\n({restartAndDeliver,cancelRuntimeStartup,finishCliDispatch})',{
   ...startup,AbortController,Date,admitCliTurn,cliTurnQueue,onCliDispatchChange,runtimeStartupSequence:0,startupFailure,planRecovery:()=>null,
   projectAttribution:()=>null,loadProjects:()=>[],sessions,emitEvent:(_:any,e:any)=>events.push(e),handleEvent:(_:any,e:any)=>events.push(e),interruptManagedTurn(){},
   restartAndDeliverNow:()=>{starts++;live.proc=new EventEmitter();return {ok:true}}
  })
  const before=starts
  api.restartAndDeliver(live,{cwd:'/fixture'},'original '+outcome)
  await until(()=>cliTurnQueue.snapshot().some(e=>e.sessionId===outcome&&e.state==='queued'))
  sample(true);cliTurnQueue.finish(blocker)
  await until(()=>!live.dispatchAbort)
  await flush()
  assert.equal(starts,before,'must not spawn using a stale resource permit')
  assert.equal(manager.snapshot().queued,1)
  assert.equal(manager.snapshot().reserved.memoryBytes,0,'stale startup lease must be released')
  assert.equal(cliTurnQueue.snapshot().length,0,'resource wait must not retain global CLI capacity')
  assert.equal(events.filter(e=>e.k==='message.unsent'||e.k==='turn.done').length,0)
  now+=70_000;sample(true);manager.tick();await flush()
  assert.equal(manager.snapshot().queued,1,'resource wait has no default timeout')
  if(outcome==='recover'){
   sample(false);await until(()=>starts===before+1);await flush()
   assert.equal(live.runtimeStartupId,undefined)
   assert.equal(manager.snapshot().reserved.memoryBytes,512*1024**2)
   live.proc.emit('close');api.finishCliDispatch(live);await flush()
   assert.equal(manager.snapshot().reserved.memoryBytes,0)
  }else{
   if(outcome==='destroy'){destroyed=true;sessions.delete(outcome)}
   api.cancelRuntimeStartup(live);api.cancelRuntimeStartup(live);await flush()
   sample(false);await flush()
   assert.equal(starts,before)
   assert.equal(events.filter(e=>e.k==='message.unsent').length,1)
   assert.equal(events.find(e=>e.k==='message.unsent').text,'original '+outcome)
   assert.equal(manager.snapshot().queued,0)
  }
 }}finally{clearInterval(keepAlive);manager.dispose();cliTurnQueue.dispose()}
})
