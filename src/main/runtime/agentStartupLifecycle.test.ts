import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {EventEmitter} from 'node:events'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,startManagedSession,cancelSessionStart} from './sessionStartup.ts'
import {startupFailure} from './startupFailure.ts'
const source=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const selected=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['restartAndDeliver','cancelRuntimeStartup'].includes(n.name?.text??''))
const code=ts.transpileModule(selected.map(n=>n.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const flush=()=>new Promise(r=>setImmediate(r))
test('actual agent startup wrapper waits, cancels without dispatch, rejects duplicate and retains budget to close',async()=>{
 let now=0,starts=0
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 const live:any={rec:{id:'session',cli:'claude',cwd:'/fixture',alive:false,busy:true},wcId:1,wc:{isDestroyed:()=>false}}
 const events:any[]=[]
 const api=runInNewContext(code+'\n({restartAndDeliver,cancelRuntimeStartup})',{runtimeStartupSequence:0,startManagedSession,cancelSessionStart,startupFailure,projectAttribution:()=>null,loadProjects:()=>[],sessions:new Map([['session',live]]),handleEvent:(_:unknown,e:unknown)=>events.push(e),restartAndDeliverNow:()=>{starts++;live.proc=new EventEmitter();return {ok:true}}})
 assert.equal(api.restartAndDeliver(live,{cwd:'/fixture'},'first').ok,true)
 assert.equal(api.restartAndDeliver(live,{cwd:'/fixture'},'duplicate').ok,false)
 assert.equal(starts,0)
 api.cancelRuntimeStartup(live);await flush();assert.equal(starts,0)
 manager.update({at:0,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
 api.restartAndDeliver(live,{cwd:'/fixture'},'new explicit message');await flush()
 assert.equal(starts,1);assert.equal(live.runtimeStartupId,undefined)
 assert.equal(manager.snapshot().running,0);assert.equal(manager.snapshot().reserved.memoryBytes,512*1024**2)
 live.proc.emit('close');await flush();assert.equal(manager.snapshot().reserved.memoryBytes,0)
 manager.dispose()
})

test('pending cancellation exposes exact unstarted message once',()=>{
 const live:any={rec:{id:'s'},wcId:1,runtimeStartupId:'queued',runtimePendingMessage:'original prompt'}
 const events:any[]=[]
 const api=runInNewContext(code+'\n({cancelRuntimeStartup})',{cancelSessionStart:()=>true,handleEvent:(_:unknown,e:unknown)=>events.push(e)})
 api.cancelRuntimeStartup(live);api.cancelRuntimeStartup(live)
 assert.equal(events.filter(e=>e.k==='message.unsent').length,1)
 assert.equal(events[0].text,'original prompt')
 assert.equal(live.runtimePendingMessage,undefined)
})

test('queue failure preserves original payload but dispatch failure does not claim unstarted',async()=>{
 for (const dispatch of [false,true]) {
  const live:any={rec:{id:'s',cli:'claude',retries:0},wcId:1,wc:{isDestroyed:()=>false}}
  const events:any[]=[]
  const api=runInNewContext(code+'\n({restartAndDeliver,cancelRuntimeStartup})',{
   runtimeStartupSequence:0,startManagedSession:async(opts:any)=>{if(dispatch)return opts.start(new AbortController().signal);throw Error('not admitted')},
   cancelSessionStart:()=>true,startupFailure,planRecovery:()=>null,projectAttribution:()=>null,loadProjects:()=>[],sessions:new Map([['s',live]]),
   handleEvent:(_:unknown,e:unknown)=>events.push(e),restartAndDeliverNow:()=>{throw Error('spawn timeout')}
  })
  api.restartAndDeliver(live,{cwd:'/fixture'},'original payload');await flush()
  assert.equal(events.filter(e=>e.k==='message.unsent').length,dispatch?0:1)
  if(!dispatch){assert.equal(events[0].text,'original payload');assert.equal(events[1].k,'turn.done')}
  else assert.match(events.at(-1).message,/spawn timeout/)
  assert.equal(live.runtimeStartupId,undefined)
  api.cancelRuntimeStartup(live)
  assert.equal(events.filter(e=>e.k==='message.unsent').length,dispatch?0:1)
 }
})
