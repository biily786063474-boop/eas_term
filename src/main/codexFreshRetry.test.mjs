import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough,Writable} from 'node:stream'
import {runCodexTaskBridge} from '../../mcp/codex-task-bridge.mjs'
import {ROUTE_TIMEOUT} from '../../mcp/codex-task-recovery.mjs'

test('routing recovery uses a fresh process and resumes the same message without account extensions',async()=>{
 const calls=[],events=[];let generation=0
 const make=()=>{
  const proc=new EventEmitter();proc.stdout=new PassThrough();const g=generation++
  proc.stdin=new Writable({write(chunk,_,cb){
   const m=JSON.parse(chunk);calls.push({g,...m});cb()
   if(m.id===undefined)return
   queueMicrotask(()=>{
    let result={}
    if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'original',turns:[]}}
    if(m.method==='thread/goal/get')result={goal:null}
    if(m.method==='turn/start')result={turn:{id:'t'+g}}
    proc.stdout.write(JSON.stringify({id:m.id,result})+'\n')
    if(m.method==='turn/start')setImmediate(()=>proc.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'original',turn:{id:'t'+g,status:g?'completed':'failed',...(g?{}:{error:{message:ROUTE_TIMEOUT}})}}})+'\n'))
   })
  }})
  return proc
 }
 await runCodexTaskBridge({proc:make(),restart:async()=>make(),cwd:'/tmp',prompt:'original message',sandbox:'read-only',model:'fixture',recoverySleep:async()=>{},emit:e=>events.push(e)})
 assert.equal(generation,2)
 assert.equal(calls.some(x=>['account/read','thread/fork'].includes(x.method)),false)
 assert.equal(calls.find(x=>x.g===1&&x.method==='thread/resume').params.threadId,'original')
 assert.deepEqual(calls.filter(x=>x.method==='turn/start').map(x=>x.params),Array(2).fill({threadId:'original',input:[{type:'text',text:'original message'}],model:'fixture'}))
 assert.equal(events.filter(x=>x.type==='turn.completed').length,1)
})

async function scenario({startupFailure,goalOnResume=false,abortOnRestart=false,activeOnResume=false}={}) {
 const calls=[],events=[],abort=new AbortController();let generation=0
 const make=()=>{
  const proc=new EventEmitter();proc.stdout=new PassThrough();const g=generation++
  proc.stdin=new Writable({write(chunk,_,cb){
   const m=JSON.parse(chunk);calls.push({g,...m});cb()
   if(m.id===undefined)return
   if(g===1&&m.method==='initialize'&&startupFailure==='timeout')return
   queueMicrotask(()=>{
    let result={}
    if(g===1&&m.method==='initialize'&&startupFailure==='protocol'){proc.stdout.write(JSON.stringify({id:m.id,error:{message:'Codex RPC failed'}})+'\n');return}
    if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'same',turns:g&&activeOnResume?[{id:'other',status:'inProgress'}]:[]}}
    if(m.method==='thread/goal/get')result={goal:g&&goalOnResume?{status:'active'}:null}
    if(m.method==='turn/start')result={turn:{id:'t'+g}}
    proc.stdout.write(JSON.stringify({id:m.id,result})+'\n')
    if(m.method==='turn/start')setImmediate(()=>proc.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'same',turn:{id:'t'+g,status:g?'completed':'failed',...(g?{}:{error:{message:ROUTE_TIMEOUT}})}}})+'\n'))
   })
  }})
  return proc
 }
 let error
 try {await runCodexTaskBridge({proc:make(),restart:async()=>{if(abortOnRestart)abort.abort();return make()},signal:abort.signal,cwd:'/tmp',prompt:'keep original',sandbox:'read-only',requestTimeoutMs:12,recoverySleep:async()=>{},emit:e=>events.push(e)})}catch(e){error=e}
 return {calls,events,generation,error}
}
test('first recovery initialization timeout continues to second recovery without duplicate paid start',async()=>{
 const r=await scenario({startupFailure:'timeout'})
 assert.equal(r.error,undefined);assert.equal(r.generation,3)
 assert.deepEqual(r.events.filter(x=>x.type==='retry.status').map(x=>x.attempt),[1,2])
 assert.deepEqual(r.calls.filter(x=>x.method==='turn/start').map(x=>x.g),[0,2])
})
test('recovered protocol incompatibility is not blindly retried',async()=>{
 const r=await scenario({startupFailure:'protocol'})
 assert.match(r.error.message,/RPC failed/);assert.equal(r.generation,2)
 assert.equal(r.calls.filter(x=>x.method==='turn/start').length,1)
})
test('newly active goal after reconnect blocks resubmission',async()=>{
 const r=await scenario({goalOnResume:true})
 assert.match(r.error.message,/workspace-routing-timeout:1/)
 assert.equal(r.calls.filter(x=>x.method==='turn/start').length,1)
})
test('cancellation while replacing process prevents initialization or paid submission',async()=>{
 const r=await scenario({abortOnRestart:true})
 assert.match(r.error.message,/cancelled/)
 assert.equal(r.calls.filter(x=>x.method==='turn/start').length,1)
 assert.equal(r.calls.filter(x=>x.g>0).length,0)
})

test('resumed snapshot with an active turn blocks duplicate submission without started notification',async()=>{const r=await scenario({activeOnResume:true});assert.match(r.error?.message??'',/workspace-routing-timeout:1/);assert.equal(r.calls.filter(x=>x.method==='turn/start').length,1)})
