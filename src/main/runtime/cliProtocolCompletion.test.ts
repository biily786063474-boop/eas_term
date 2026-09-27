import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {EventEmitter} from 'node:events'
import {createClaudeTranslator} from '../agentChat/claudeEvents.ts'
import {createCliTurnQueue} from './cliTurnQueue.ts'
const source=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const names=['handleEvent','wireProc','feed','finishCliDispatch','interruptManagedTurn']
const code=ts.transpileModule(source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
function fixture(){
 const noop=()=>{},events:any[]=[]
 const queue=createCliTurnQueue({now:()=>0,setTimer:noop,clearTimer:noop})
 const proc=Object.assign(new EventEmitter(),{stdout:Object.assign(new EventEmitter(),{setEncoding:noop}),stderr:Object.assign(new EventEmitter(),{setEncoding:noop})})
 const live:any={rec:{id:'s',cli:'claude',cwd:'/fixture',alive:true,busy:true},wcId:1,proc,stdoutBuf:'',translator:createClaudeTranslator(),dispatchKey:'s:1',dispatchProc:proc}
 const api=runInNewContext(code+'\n({wireProc,handleEvent,interruptManagedTurn})',{
  Date,queueMicrotask:noop,cliTurnQueue:queue,sessions:new Map([['s',live]]),runtimeProcessGeneration:0,
  ownedSessions:{add:noop},resetUsageCost:noop,projectAttribution:()=>null,loadProjects:()=>[],createStderrDiagnostics:()=>({push:()=>false}),
  unauthedInLine:()=>null,isSilenced:()=>false,activePlanTurn:()=>null,planRecovery:()=>null,retirePlanTurn:noop,
  captureUsage:noop,observePluginTurn:noop,BG_TOOLS:new Set(),getAdapter:()=>({}),scheduleApiRefresh:noop,refreshBoard:noop,projectRootOf:(s:string)=>s,
  tally:(p:any)=>p,ZERO_TALLY:{},emitEvent:(_:any,e:any)=>events.push(e),signalPlanStop:noop,
  cancelPluginTurn:noop,cancelRuntimeStartup:noop,markUsageInterrupted:noop,interruptUsage:noop,revokeCapabilitySession:noop,forgetPty:noop,stopAgentProcess:noop
 })
 queue.enqueue({key:'s:1',sessionId:'s',projectId:'p',start:noop,cancelRunning:noop})
 api.wireProc(live,proc)
 const result=(is_error:boolean)=>proc.stdout.emit('data',JSON.stringify({type:'result',subtype:is_error?'error_during_execution':'success',is_error,result:'fixture',usage:{input_tokens:1,output_tokens:2}})+'\n')
 return {api,live,proc,queue,result,events}
}
for(const error of [false,true])test(`real Claude result (is_error=${error}) releases dispatch while persistent process stays alive`,()=>{
 const f=fixture();f.result(error)
 assert.equal(f.live.rec.busy,false)
 assert.equal(f.live.rec.alive,true)
 assert.equal(f.live.proc,f.proc)
 assert.equal(f.live.dispatchKey,undefined)
 assert.equal(f.queue.snapshot().length,0)
 assert.equal(f.queue.enqueue({key:'s:2',sessionId:'s',projectId:'p',start(){},cancelRunning(){}}).ok,true)
 f.queue.dispose()
})
test('synthetic stop and retired late result retain dispatch until owned process close',()=>{
 const f=fixture();f.api.interruptManagedTurn('s')
 assert.equal(f.live.rec.busy,false)
 assert.equal(f.queue.snapshot().length,1)
 f.result(true);assert.equal(f.queue.snapshot().length,1)
 f.proc.emit('close');assert.equal(f.queue.snapshot().length,0)
})
test('UI-only and synthetic recovery completion cannot release a live dispatch',()=>{
 const f=fixture(),done={k:'turn.done',usage:{inputTokens:0,outputTokens:0}}
 f.api.handleEvent(f.live,done,true)
 assert.equal(f.queue.snapshot().length,1)
 f.live.planTurnSyntheticDone=true;f.api.handleEvent(f.live,{...done,interrupted:true})
 assert.equal(f.queue.snapshot().length,1)
 f.proc.emit('close');assert.equal(f.queue.snapshot().length,0)
})
