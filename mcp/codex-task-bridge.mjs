// App-server lifetime belongs to the submitted task, not its first native turn.
// This bridge never creates goals or sends synthetic continuation prompts.
import readline from 'node:readline'
import {MAX_ROUTE_RETRIES,isRouteTimeout,mayRecoverRouteTimeout,routeTimeoutFailure} from './codex-task-recovery.mjs'
export function parseTaskArgs(args) {
 if(args[0]!=='exec'||args.length<2)throw Error('Expected managed exec arguments')
 const out={prompt:args.at(-1),flags:[],sandbox:'workspace-write'}
 for(let i=1;i<args.length-1;i++) {
  const a=args[i]
  if(a==='--json'||a==='--skip-git-repo-check')continue
  if(['--sandbox','-m','--model','resume','--disable','--enable'].includes(a)) {
   if(i+1>=args.length-1)throw Error('Missing managed argument')
   const v=args[++i]
   if(a==='--sandbox')out.sandbox=v
   else if(a==='resume')out.resumeId=v
   else if(a==='-m'||a==='--model')out.model=v
   else out.flags.push(a,v)
  } else throw Error('Unsupported managed task argument: '+a)
 }
 if(!['read-only','workspace-write','danger-full-access'].includes(out.sandbox))throw Error('Invalid sandbox')
 return out
}
function itemEvent(item,turnId) {
 const id=turnId+':'+item.id
 switch(item.type) {
  case 'agentMessage':return {id,type:'agent_message',text:item.text,phase:item.phase}
  case 'reasoning':return null
  case 'userMessage':case 'hookPrompt':return null
  case 'commandExecution':return {id,type:'command_execution',command:item.command,aggregated_output:item.aggregatedOutput,exit_code:item.exitCode,status:item.status==='completed'&&item.exitCode? 'failed':item.status}
  case 'fileChange':return {id,type:'file_change',changes:item.changes?.map(c=>({...c,kind:typeof c.kind==='object'?c.kind.type:c.kind})),status:item.status==='declined'?'failed':item.status}
  case 'mcpToolCall':return {id,type:'mcp_tool_call',server:item.server,tool:item.tool,arguments:item.arguments,result:item.result,error:item.error,status:item.status}
  case 'webSearch':return {id,type:'web_search',query:item.query,action:item.action,status:'completed'}
  default:return {...item,id,type:item.type.replace(/[A-Z]/g,x=>'_'+x.toLowerCase())}
 }
}
function nativeFailure(error,fallback) {
 const message=String(error?.message??'')
 // Preserve only a bounded, actionable category, never provider text that may
 // contain a prompt, endpoint, local path, or credential.
 if(/\b401\b[\s\S]{0,80}unauthoriz|unauthoriz[\s\S]{0,80}\b401\b|authentication[_\s-]?error|\bunauthenticated\b/i.test(message))return Error('Codex authentication_error')
 return Error(fallback)
}
function cancellableSleep(ms,signal) {
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('Codex task cancelled'));return}
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve()},ms)
  const onAbort=()=>{clearTimeout(timer);reject(Error('Codex task cancelled'))}
  signal?.addEventListener('abort',onAbort,{once:true})
 })
}
export async function runCodexTaskBridge({proc,cwd,prompt,resumeId,sandbox,model,emit,signal,requestTimeoutMs=30000,routeErrorWaitMs=5000,recoverySleep=cancellableSleep}) {
 let seq=0,threadId,settled=false,revision=0,started=false
 let usage={input_tokens:0,output_tokens:0,cached_input_tokens:0}
 const pending=new Map(),active=new Set(),finished=new Set(),seenItems=new Set(),early=[]
 let resolveDone,rejectDone
 let resolveTurnObserved,turnObserved,routeErrorTimer,attempts=0,currentAttempt
 const done=new Promise((r,j)=>{resolveDone=r;rejectDone=j});done.catch(()=>{})
 const resetTurnObserved=()=>{turnObserved=new Promise(r=>{resolveTurnObserved=r})}
 resetTurnObserved()
 const write=m=>{if(!proc.stdin.writable)throw Error('Codex input closed');proc.stdin.write(JSON.stringify(m)+'\n')}
 const fail=e=>{if(settled)return;settled=true;clearTimeout(routeErrorTimer);for(const p of pending.values()){clearTimeout(p.timer);p.reject(e)}pending.clear();rejectDone(e)}
 const rpc=(method,params,timeoutMs=requestTimeoutMs)=>new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Codex RPC timeout: '+method))},timeoutMs)
  pending.set(id,{resolve,reject,timer})
  try{write({id,method,params})}catch(e){clearTimeout(timer);pending.delete(id);reject(e)}
 })
 const finish=()=>{if(settled)return;settled=true;emit({type:'turn.completed',usage});resolveDone()}
 const stillRecoverable=(mark,state)=>!settled&&!signal?.aborted&&revision===mark&&currentAttempt===state&&active.size===0&&state?.uncertain!==true
 async function submitPaidTurn() {
  const state={id:undefined,acked:false,uncertain:false,activitySeen:false,usageAdvanced:false,submission:null}
  currentAttempt=state;resetTurnObserved()
  state.submission=(async()=>{
   try {
    const result=await rpc('turn/start',{threadId,input:[{type:'text',text:prompt}],...(model?{model}:{})})
    if(typeof result?.turn?.id!=='string'||!result.turn.id)throw Error('Codex invalid turn/start response')
    state.acked=true;state.id=result.turn.id
    if(!finished.has(state.id))active.add(state.id)
   } catch(e) {
    if(!String(e?.message).startsWith('Codex RPC timeout: turn/start'))throw e
    state.uncertain=true
    if(!active.size&&!finished.size){
     let timer
     try {await Promise.race([turnObserved,done,new Promise(r=>{timer=setTimeout(r,requestTimeoutMs)})])}
     finally {clearTimeout(timer)}
    }
    if(!active.size&&!finished.size)throw e
   }
  })()
  await state.submission
 }
 async function recoverFailedTurn(turn,state,mark) {
  try {
   // A native failure can arrive before the paid turn/start ACK. Its result
   // must be known before any retry: an uncertain ACK is never resubmitted.
   await state?.submission
   if(!stillRecoverable(mark,state)||state.id!==turn.id||state.acked!==true)throw routeTimeoutFailure(attempts)
   const status=await rpc('thread/goal/get',{threadId})
   if(!stillRecoverable(mark,state))throw routeTimeoutFailure(attempts)
   if(!mayRecoverRouteTimeout({terminal:turn,activitySeen:state.activitySeen,usageAdvanced:state.usageAdvanced,goalStatus:status?.goal,activeTurnCount:active.size,attempts,aborted:signal?.aborted===true}))throw routeTimeoutFailure(attempts)
   const next=attempts+1
   emit({type:'retry.status',attempt:next,max:MAX_ROUTE_RETRIES})
   await recoverySleep(next===1?5000:20000,signal)
   if(!stillRecoverable(mark,state))throw routeTimeoutFailure(attempts)
   let healthy=false
   for(let probe=0;probe<2;probe++){
    if(probe){await recoverySleep(20000,signal);if(!stillRecoverable(mark,state))throw routeTimeoutFailure(attempts)}
    try {
     const account=await rpc('account/read',{refreshToken:false},20000)
     healthy=account?.account?.type==='chatgpt'&&account.workspaceRouting!=null
    } catch {healthy=false}
    if(!stillRecoverable(mark,state))throw routeTimeoutFailure(attempts)
    if(healthy)break
   }
   if(!healthy)throw routeTimeoutFailure(attempts)
   const fork=await rpc('thread/fork',{threadId,beforeTurnId:turn.id,cwd,sandbox,approvalPolicy:'never',...(model?{model}:{})})
   if(!stillRecoverable(mark,state)||typeof fork?.thread?.id!=='string'||!fork.thread.id||fork.thread.id===threadId)throw routeTimeoutFailure(attempts)
   threadId=fork.thread.id
   active.clear();finished.clear();seenItems.clear()
   revision++;attempts=next
   emit({type:'thread.started',thread_id:threadId})
   if(settled||signal?.aborted)throw routeTimeoutFailure(attempts)
   await submitPaidTurn()
  }catch(e){fail(isRouteTimeout(turn?.error?.message)?routeTimeoutFailure(attempts):nativeFailure(turn?.error,'Codex turn failed'))}
 }
 async function checkGoal(mark) {
  let r
  // A goal read is idempotent. A short IPC stall must not kill an otherwise
  // healthy native task, but never retry turn/start (which may already be paid).
  for(let attempt=0;attempt<3;attempt++) {
   if(settled||mark!==revision||active.size)return
   try {r=await rpc('thread/goal/get',{threadId});break}
   catch(e) {
    if(attempt===2||!String(e?.message).startsWith('Codex RPC timeout: thread/goal/get'))throw e
   }
  }
  if(settled||mark!==revision||active.size)return
  if(r.goal?.status==='active')return
  if(r.goal && !['paused','blocked','usageLimited','budgetLimited','complete'].includes(r.goal.status))throw Error('Unknown native goal state')
  finish()
 }
 function notification(m) {
  if(settled)return
  const p=m.params??{}
  if(!threadId){early.push(m);if(early.length>1000)fail(Error('Codex notification overflow'));return}
  if(p.threadId!==threadId)return
  if(m.method==='turn/started') {if(!finished.has(p.turn.id)){active.add(p.turn.id);revision++;if(currentAttempt&&!currentAttempt.id)currentAttempt.id=p.turn.id;resolveTurnObserved()}return}
  if(m.method==='thread/tokenUsage/updated') {
   if(currentAttempt&&(!p.turnId||p.turnId===currentAttempt.id))currentAttempt.usageAdvanced=true
   const u=p.tokenUsage?.total;if(u)usage={input_tokens:u.inputTokens??0,output_tokens:u.outputTokens??0,cached_input_tokens:u.cachedInputTokens??0};return
  }
  if(m.method==='item/agentMessage/delta') {
   if(currentAttempt&&(!p.turnId||p.turnId===currentAttempt.id))currentAttempt.activitySeen=true
   if(typeof p.turnId!=='string'||!p.turnId||typeof p.itemId!=='string'||!p.itemId||typeof p.delta!=='string'||!p.delta)return
   if(finished.has(p.turnId)||seenItems.has('item/completed:'+p.turnId+':'+p.itemId))return
   emit({type:'item.delta',item:{id:p.turnId+':'+p.itemId,type:'agent_message',delta:p.delta}})
   return
  }
  if(m.method==='item/started'||m.method==='item/completed') {
   if(currentAttempt&&(!p.turnId||p.turnId===currentAttempt.id)&&p.item?.type!=='userMessage')currentAttempt.activitySeen=true
   const key=m.method+':'+p.turnId+':'+p.item.id;if(seenItems.has(key))return;seenItems.add(key)
   const item=itemEvent(p.item,p.turnId);if(item)emit({type:m.method==='item/started'?'item.started':'item.completed',item});return
  }
  if(m.method==='error'&&!p.willRetry) {
   const message=String(p.error?.message??'')
   if(/MCP client for .+ failed to start|handshaking with MCP server failed|MCP startup failed/i.test(message)) {
    emit({type:'error',message:'部分 MCP 工具连接失败，相关工具暂不可用。'});return
   }
   if(isRouteTimeout(message)&&started&&currentAttempt?.id&&active.has(currentAttempt.id)){
    clearTimeout(routeErrorTimer)
    routeErrorTimer=setTimeout(()=>fail(routeTimeoutFailure(attempts)),routeErrorWaitMs)
    return
   }
   fail(nativeFailure(p.error,'Codex native error'));return
  }
  if(m.method==='turn/completed') {
   if(p.turn?.id===currentAttempt?.id){clearTimeout(routeErrorTimer);routeErrorTimer=undefined}
   resolveTurnObserved()
   const t=p.turn;if(finished.has(t.id))return;finished.add(t.id);active.delete(t.id);revision++
   if(t.status!=='completed'){
    if(isRouteTimeout(t.error?.message)){void recoverFailedTurn(t,currentAttempt,revision);return}
    fail(nativeFailure(t.error,'Codex turn '+t.status));return
   }
   void checkGoal(revision).catch(fail);return
  }
  if((m.method==='thread/goal/updated'||m.method==='thread/goal/cleared')&&started&&finished.size&&!active.size)void checkGoal(++revision).catch(fail)
 }
 const lines=readline.createInterface({input:proc.stdout})
 lines.on('close',()=>fail(Error('Codex output closed')))
 lines.on('line',line=>{
  try {
   const m=JSON.parse(line)
   if(m.id!==undefined&&m.method) {write({id:m.id,error:{code:-32601,message:'Eas-Term does not support this interactive request in managed task mode'}});fail(Error('Codex requires unsupported interactive request: '+m.method));return}
   if(m.id!==undefined){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message||'Codex RPC failed')):p.resolve(m.result);return}
   notification(m)
  }catch(e){fail(e)}
 })
 const exited=()=>fail(Error('Codex app-server exited before task completion'))
 const aborted=()=>fail(Error('Codex task cancelled'))
 proc.on('exit',exited);proc.on('error',fail);proc.stdin.on('error',fail);proc.stdout.on('error',fail);signal?.addEventListener('abort',aborted,{once:true})
 try {
  if(signal?.aborted)throw Error('Codex task cancelled')
  await rpc('initialize',{clientInfo:{name:'eas-term',version:'1'},capabilities:{experimentalApi:true}});write({method:'initialized'})
  const r=await rpc(resumeId?'thread/resume':'thread/start',{...(resumeId?{threadId:resumeId}:{}),cwd,sandbox,approvalPolicy:'never',...(model?{model}:{})})
  threadId=r.thread.id;emit({type:'thread.started',thread_id:threadId});for(const m of early.splice(0))notification(m)
  // Check protocol support before starting a paid turn. Never silently fall back to exec.
  await rpc('thread/goal/get',{threadId})
  // A terminal native error may race the preflight response. Never submit a
  // paid turn after the bridge has already failed or been cancelled.
  if(settled){await done;return}
  started=true
  await submitPaidTurn()
  await done
 }finally {
  settled=true;clearTimeout(routeErrorTimer);lines.close();proc.off('exit',exited);proc.off('error',fail);proc.stdin.off('error',fail);proc.stdout.off('error',fail);signal?.removeEventListener('abort',aborted)
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Codex task closed'))}pending.clear()
 }
}
