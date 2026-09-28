import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {runInNewContext} from 'node:vm'
import {EventEmitter} from 'node:events'
import {createClaudeTranslator} from '../agentChat/claudeEvents.ts'
const queueSource=fs.readFileSync(new URL('../../renderer/src/features/agentChat/messageQueue.ts',import.meta.url),'utf8')
const queueCode=ts.transpileModule(queueSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace('export function createMessageQueue','function createMessageQueue')
const createMessageQueue=runInNewContext(queueCode+';createMessageQueue',{queueMicrotask})

import {createCliTurnQueue} from './cliTurnQueue.ts'
import {absorbSelfInitiatedDone} from '../agentChat/sessionState.ts'
const source=ts.createSourceFile('session.ts',fs.readFileSync(new URL('../agentChat/session.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const names=['handleEvent','wireProc','feed','finishCliDispatch','interruptManagedTurn','deliverMessage']
const code=ts.transpileModule(source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
function fixture(cli='claude',listener:(e:any)=>void=()=>{},options:{stop?:()=>void;timer?:(fn:()=>void)=>any}={}){
 const noop=()=>{},events:any[]=[]
 const queue=createCliTurnQueue({now:()=>0,setTimer:noop,clearTimer:noop})
 const proc=Object.assign(new EventEmitter(),{stdout:Object.assign(new EventEmitter(),{setEncoding:noop}),stderr:Object.assign(new EventEmitter(),{setEncoding:noop})})
 const live:any={rec:{id:'s',cli,cwd:'/fixture',alive:true,busy:true},wcId:1,proc,stdoutBuf:'',translator:createClaudeTranslator(),dispatchKey:'s:1',dispatchProc:proc}
 const api=runInNewContext(code+'\n({wireProc,handleEvent,interruptManagedTurn,deliverMessage})',{
  Date,setTimeout:options.timer??setTimeout,clearTimeout,queueMicrotask:noop,endSilence:noop,executionPlanEnabled:()=>false,planSend:()=>({action:'restart',opts:{}}),restartAndDeliver:()=>({ok:true}),cliTurnQueue:queue,sessions:new Map([['s',live]]),runtimeProcessGeneration:0,
  ownedSessions:{add:noop},resetUsageCost:noop,projectAttribution:()=>null,loadProjects:()=>[],createStderrDiagnostics:()=>({push:()=>false}),
  unauthedInLine:()=>null,isSilenced:()=>false,activePlanTurn:()=>null,planRecovery:()=>null,retirePlanTurn:noop,
  captureUsage:noop,observePluginTurn:noop,BG_TOOLS:new Set(),getAdapter:()=>({}),scheduleApiRefresh:noop,refreshBoard:noop,projectRootOf:(s:string)=>s,
  tally:(p:any)=>p,ZERO_TALLY:{},emitEvent:(_:any,e:any)=>{events.push(e);listener(e)},signalPlanStop:noop,
  absorbSelfInitiatedDone,logSession:noop,
  cancelPluginTurn:noop,cancelRuntimeStartup:noop,markUsageInterrupted:noop,interruptUsage:noop,revokeCapabilitySession:noop,forgetPty:noop,stopAgentProcess:options.stop??noop
 })
 queue.enqueue({key:'s:1',sessionId:'s',projectId:'p',start:noop,cancelRunning:noop})
 api.wireProc(live,proc)
 const result=(is_error:boolean,extra:Record<string,unknown>={})=>proc.stdout.emit('data',JSON.stringify({type:'result',subtype:is_error?'error_during_execution':'success',is_error,result:'fixture',usage:{input_tokens:1,output_tokens:2},...extra})+'\n')
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
 assert.equal(f.live.rec.busy,true)
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

const flush=()=>new Promise<void>(r=>setImmediate(r))
for(const cli of ['codex','claude'])test(cli+' 调整方向等旧进程真实close，不能先误报busy暂停队列',async()=>{
 let q:any
 const f=fixture(cli,e=>{if(q&&(e.k==='turn.start'||e.k==='turn.done'))q.event(e.k)})
 const sends:any[]=[]
 q=createMessageQueue({busy:()=>f.live.rec.busy,send:async (item:{text:string})=>{const r=f.api.deliverMessage(f.live,item.text);sends.push({text:item.text,...r});return r.ok},interrupt:()=>f.api.interruptManagedTurn('s'),changed(){}})
 await q.submit({text:'方向一'},'redirect');await flush()
 assert.equal(sends.length,0,'请求停止不是停止确认')
 assert.equal(q.snapshot().interrupting,true)
 f.api.interruptManagedTurn('s') // 重复停止不能提前产生done
 await flush();assert.equal(sends.length,0)
 await q.submit({text:'方向二'},'redirect');await flush()
 assert.equal(sends.length,0)
 f.proc.emit('close');await flush()
 assert.equal(sends.length,1);assert.equal(sends[0].ok,true)
 assert.equal(sends[0].text,'方向二');assert.equal(q.snapshot().paused,false)
 assert.equal(f.events.filter(e=>e.k==='turn.done').length,1)
 q.dispose();f.queue.dispose()
})

for(const failure of ['throw','timeout'])test('停止'+failure+'不能提前释放租约或丢方向；迟到close后手动重试',async()=>{
 let q:any,timer:()=>void=()=>{}
 const f=fixture('codex',e=>{if(q&&(e.k==='turn.start'||e.k==='turn.done'||e.k==='error'&&e.fatal))q.event(e.k==='error'?'fatal':e.k)},failure==='throw'?{stop:()=>{throw Error('stop denied')}}:{timer:fn=>{timer=fn;return {unref(){}}}})
 const sent:string[]=[]
 q=createMessageQueue({busy:()=>f.live.rec.busy,send:async(item:{text:string})=>{sent.push(item.text);return f.api.deliverMessage(f.live,item.text).ok},interrupt:()=>f.api.interruptManagedTurn('s'),changed(){}})
 await q.submit({text:'新方向'},'redirect');await flush();if(failure==='timeout')timer();await flush()
 assert.equal(sent.length,0);assert.equal(q.snapshot().paused,true)
 assert.equal(q.snapshot().items[0].text,'新方向');assert.equal(f.queue.snapshot().length,1)
 f.proc.emit('close');await flush();assert.equal(sent.length,0)
 q.retry();await flush();assert.deepEqual(sent,['新方向']);assert.equal(q.snapshot().paused,false)
 q.dispose();f.queue.dispose()
})

// 2026-09-28：恢复带未完成后台任务的会话，CLI 先为后台通知跑一轮空回复（origin=task-notification）。
// 用户那一轮还在等回答时，它不能释放派发、不能收 busy、不能推 turn.done 给界面。
test('task-notification result during a user turn keeps dispatch and busy until the real result', () => {
 const f=fixture()
 f.result(false,{result:'',origin:{kind:'task-notification'}})
 assert.equal(f.live.rec.busy,true)
 assert.equal(f.live.dispatchKey,'s:1')
 assert.equal(f.queue.snapshot().length,1)
 assert.equal(f.events.filter((e:any)=>e.k==='turn.done').length,0)
 f.result(false)
 assert.equal(f.live.rec.busy,false)
 assert.equal(f.live.dispatchKey,undefined)
 assert.equal(f.events.filter((e:any)=>e.k==='turn.done').length,1)
})
