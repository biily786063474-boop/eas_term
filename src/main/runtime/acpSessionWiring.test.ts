import {timelineGuidance, timelineRuntime} from '../timelineRuntime.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,startManagedSession,cancelSessionStart} from './sessionStartup.ts'
import {createOwnedSessions} from './ownedSessions.ts'
const source=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='makeAcpLive')!
const code=ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const flush=()=>new Promise(r=>setImmediate(r))
test('actual main ACP assembly uses admission, window-owned service, and actual close budget',async()=>{
 const manager=createRuntimeManager({now:()=>0});installSessionStartup(manager)
 const owned=createOwnedSessions(()=>0);let deps:any,started=0,killed=0,done!:()=>void
 const proc={completed:new Promise<void>(r=>done=r),kill(){killed++}}
 const live:any={rec:{id:'acp',cwd:'/fixture',cli:'omp'},wcId:7,wc:{isDestroyed:()=>false}}
 const make=runInNewContext(code+';makeAcpLive',{
  timelineGuidance, timelineRuntime, hostPaths:()=>({}),createAcpLive:(d:unknown)=>{deps=d;return{close:()=>proc.kill()}},app:{getVersion:()=> 'test'},
  startManagedSession,cancelSessionStart,ownedSessions:owned,runtimeStartupSequence:0,runtimeProcessGeneration:0,
  sessions:new Map([['acp',live]]),projectAttribution:()=> 'p',loadProjects:()=>[],readOmpSetup:()=>({}),
  writeManagedConfig(){},capabilityGuidanceEnabled:()=>false,openOmpProcess:()=>{started++;return{ok:true,proc}},
  mcpEnv:()=>({}),capabilitySessionEnv:()=>({}),sessionCapabilityGuidance:()=>'',executionPlanEnabled:()=>false,executionPlanGuidance:()=>'',bindRole:()=>({omp:{}})
 })
 live.acp=make(live,{})
 const aborted=new AbortController(),first=deps.openAsync('/fixture',aborted.signal)
 assert.equal(started,0);aborted.abort();await assert.rejects(first,/cancelled/);assert.equal(started,0)
 manager.update({at:0,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:false})
 const opened=await deps.openAsync('/fixture',new AbortController().signal)
 assert.equal(opened.ok,true);assert.equal(started,1);assert.equal(owned.list(7).length,1);assert.equal(owned.list(8).length,0)
 const id=owned.list(7)[0].id
 assert.equal((await owned.stop(id,8,async()=>true)).ok,false)
 assert.equal((await owned.stop(id,7,async()=>true)).ok,true);assert.equal(killed,1)
 assert.equal(manager.snapshot().reserved.memoryBytes,512*1024**2)
 done();await flush();assert.equal(owned.list(7).length,0);assert.equal(manager.snapshot().reserved.memoryBytes,0)
 manager.dispose()
})
