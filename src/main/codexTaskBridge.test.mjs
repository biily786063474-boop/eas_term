import test from 'node:test'
import {createCodexTranslator} from './agentChat/codexEvents.ts'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough,Writable} from 'node:stream'
import {runCodexTaskBridge,parseTaskArgs} from '../../mcp/codex-task-bridge.mjs'
import {ROUTE_TIMEOUT} from '../../mcp/codex-task-recovery.mjs'
function fixture(goal='active') {
 const proc=new EventEmitter();proc.stdout=new PassThrough();let thread='thread',status=goal;const calls=[]
 const send=x=>proc.stdout.write(JSON.stringify(x)+'\n')
 proc.stdin=new Writable({write(chunk,_,cb){const m=JSON.parse(chunk);calls.push(m);queueMicrotask(()=>{
 if(m.id){let result={};if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:thread}};if(m.method==='thread/goal/get')result={goal:status?{status}:null};if(m.method==='turn/start')result={turn:{id:'a'}};send({id:m.id,result})} });cb()}})
 return {proc,calls,send,setGoal:g=>status=g,note:(method,params)=>send({method,params:{threadId:thread,...params}})}
}
const tick=()=>new Promise(r=>setTimeout(r,15))
test('native goal second turn survives first completion without synthetic continue',async()=>{
 const f=fixture(),events=[];let done=false
 const running=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',emit:e=>events.push(e),requestTimeoutMs:500}).then(()=>done=true)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('item/completed',{turnId:'a',item:{id:'m',type:'agentMessage',text:'step one',phase:'final_answer'}});f.note('turn/completed',{turn:{id:'a',status:'completed'}})
 await tick();assert.equal(done,false);assert.equal(events.some(e=>e.type==='turn.completed'),false)
 f.note('turn/started',{turn:{id:'b'}});f.note('item/completed',{turnId:'b',item:{id:'m',type:'agentMessage',text:'step two',phase:'final_answer'}});f.setGoal('complete');f.note('turn/completed',{turn:{id:'b',status:'completed'}})
 await running;assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(events.filter(e=>e.type==='turn.completed').length,1);assert.deepEqual(events.filter(e=>e.item?.type==='agent_message').map(e=>e.item.text),['step one','step two'])
})
test('ordinary response finishes and never creates a goal',async()=>{const f=fixture(null),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)});await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'completed'}});await p;assert.equal(events.at(-1).type,'turn.completed');assert.equal(f.calls.some(x=>x.method==='thread/goal/set'),false)})
test('native agent message deltas stream before authoritative completion without changing task lifecycle',async()=>{
 const f=fixture(null),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)})
 await tick()
 f.note('turn/started',{turn:{id:'a'}})
 f.note('item/agentMessage/delta',{turnId:'a',itemId:'m',delta:'你'})
 f.note('item/agentMessage/delta',{turnId:'a',itemId:'m',delta:'好'})
 f.note('item/completed',{turnId:'a',item:{id:'m',type:'agentMessage',text:'你好',phase:'final_answer'}})
 f.note('item/agentMessage/delta',{turnId:'a',itemId:'m',delta:'迟到'})
 f.note('turn/completed',{turn:{id:'a',status:'completed'}})
 await p
 assert.deepEqual(events.filter(e=>e.type==='item.delta').map(e=>e.item),[
  {id:'a:m',type:'agent_message',delta:'你'},
  {id:'a:m',type:'agent_message',delta:'好'}
 ])
 assert.equal(events.find(e=>e.type==='item.completed')?.item.text,'你好')
 const translator=createCodexTranslator()
 assert.deepEqual(events.flatMap(e=>translator.push(JSON.stringify(e))).filter(e=>e.k==='text.delta'||e.k==='text.done'),[
  {k:'text.delta',text:'你'},{k:'text.delta',text:'好'},{k:'text.done',text:'你好'}
 ])
 assert.equal(events.filter(e=>e.type==='turn.completed').length,1)
 assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1)
})
test('foreign or malformed deltas are ignored; same item id in another turn remains independent',async()=>{
 const f=fixture(),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)})
 await tick()
 f.send({method:'item/agentMessage/delta',params:{threadId:'foreign',turnId:'a',itemId:'m',delta:'外'}})
 for(const params of [
  {turnId:'a',itemId:'m',delta:''},
  {turnId:1,itemId:'m',delta:'坏'},
  {turnId:'a',itemId:1,delta:'坏'},
  {turnId:'a',itemId:'m',delta:1}
 ])f.note('item/agentMessage/delta',params)
 f.note('turn/started',{turn:{id:'a'}})
 f.note('item/agentMessage/delta',{turnId:'a',itemId:'m',delta:'一'})
 f.note('item/completed',{turnId:'a',item:{id:'m',type:'agentMessage',text:'一'}})
 f.note('turn/completed',{turn:{id:'a',status:'completed'}})
 await tick()
 f.note('item/agentMessage/delta',{turnId:'a',itemId:'m',delta:'旧'})
 f.note('turn/started',{turn:{id:'b'}})
 f.note('item/agentMessage/delta',{turnId:'b',itemId:'m',delta:'二'})
 f.note('item/completed',{turnId:'b',item:{id:'m',type:'agentMessage',text:'二'}})
 f.setGoal('complete');f.note('turn/completed',{turn:{id:'b',status:'completed'}})
 await p
 assert.deepEqual(events.filter(e=>e.type==='item.delta').map(e=>e.item.delta),['一','二'])
})
test('preserve model, sandbox, resume and role restrictions; reject unknown arguments',()=>{
 const p=parseTaskArgs(['exec','--sandbox','read-only','resume','id','--json','--skip-git-repo-check','-m','gpt-6-astra','--disable','shell_tool','--message'])
 assert.equal(p.prompt,'--message');assert.equal(p.resumeId,'id');assert.equal(p.sandbox,'read-only');assert.equal(p.model,'gpt-6-astra');assert.deepEqual(p.flags,['--disable','shell_tool']);assert.throws(()=>parseTaskArgs(['exec','--unknown','hi']))
})
for(const status of ['paused','blocked','usageLimited','budgetLimited','complete'])test('goal '+status+' ends without another user prompt',async()=>{const f=fixture(status),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)});await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'completed'}});await p;assert.equal(events.filter(x=>x.type==='turn.completed').length,1)})
test('user stop rejects active goal without claiming completion or restarting',async()=>{const f=fixture(),events=[],a=new AbortController();const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',signal:a.signal,emit:e=>events.push(e)});const check=assert.rejects(p,/cancelled/);await tick();a.abort();await check;assert.equal(events.some(e=>e.type==='turn.completed'),false);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1)})
test('foreign threads, duplicate completion and reused item ids are isolated',async()=>{const f=fixture(),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)});await tick();f.send({method:'turn/completed',params:{threadId:'other',turn:{id:'x',status:'failed'}}});f.note('item/completed',{turnId:'a',item:{type:'mcpToolCall',id:'1',server:'x',tool:'read',result:{content:[{type:'image',mimeType:'image/png',data:'fixture'}]},status:'completed'}});f.note('turn/completed',{turn:{id:'a',status:'completed'}});f.note('turn/completed',{turn:{id:'a',status:'completed'}});await tick();f.note('turn/started',{turn:{id:'b'}});f.note('item/completed',{turnId:'b',item:{type:'commandExecution',id:'1',command:'x',exitCode:1,status:'completed'}});f.setGoal('complete');f.note('turn/completed',{turn:{id:'b',status:'completed'}});await p;assert.equal(events.filter(x=>x.type==='turn.completed').length,1);assert.equal(events.find(x=>x.item?.id==='a:1').item.result.content[0].type,'image');assert.equal(events.find(x=>x.item?.id==='b:1').item.status,'failed')})
test('RPC timeout fails closed before any paid turn, no exec fallback',async()=>{const f=fixture(),events=[];f.proc.stdin=new Writable({write(c,e,cb){cb()}});await assert.rejects(runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e),requestTimeoutMs:10}),/timeout/);assert.equal(events.length,0)})
test('failed native turn rejects without terminal success',async()=>{const f=fixture(),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)});const check=assert.rejects(p,/failed/);await tick();f.note('turn/completed',{turn:{id:'a',status:'failed'}});await check;assert.equal(events.some(e=>e.type==='turn.completed'),false)})
test('declined file changes remain failures with native change kinds preserved',async()=>{const f=fixture(null),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)});await tick();f.note('item/completed',{turnId:'a',item:{type:'fileChange',id:'patch',status:'declined',changes:[{path:'/tmp/new',kind:{type:'add'},diff:'x'}]}});f.note('turn/completed',{turn:{id:'a',status:'completed'}});await p;const item=events.find(e=>e.item?.type==='file_change').item;assert.equal(item.status,'failed');assert.equal(item.changes[0].kind,'add');const translated=events.flatMap(e=>createCodexTranslator().push(JSON.stringify(e)));assert.equal(translated.find(e=>e.k==='exec.done').ok,false)})
test('transient post-turn goal query timeout retries read-only status without restarting a paid turn',async()=>{
 const f=fixture(null),events=[];let goalGets=0
 const original=f.proc.stdin
 f.proc.stdin=new Writable({write(chunk,_,cb){const m=JSON.parse(chunk);if(m.method==='thread/goal/get' && ++goalGets===2){f.calls.push(m);cb();return}original.write(chunk,cb)}})
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e),requestTimeoutMs:20})
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'completed'}})
 await p;assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(goalGets,3);assert.equal(events.filter(x=>x.type==='turn.completed').length,1)
})
test('persistent post-turn status loss fails closed after read-only retries',async()=>{
 const f=fixture(null),events=[];let goalGets=0,original=f.proc.stdin
 f.proc.stdin=new Writable({write(chunk,_,cb){const m=JSON.parse(chunk);if(m.method==='thread/goal/get' && ++goalGets>1){f.calls.push(m);cb();return}original.write(chunk,cb)}})
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e),requestTimeoutMs:10})
 const check=assert.rejects(p,/Codex RPC timeout: thread\/goal\/get/)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'completed'}})
 await check;assert.equal(goalGets,4);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(events.some(x=>x.type==='turn.completed'),false)
})
test('lost turn/start acknowledgment does not kill a turn that already emitted start',async()=>{
 const f=fixture(null),events=[];const original=f.proc.stdin
 f.proc.stdin=new Writable({write(chunk,_,cb){const m=JSON.parse(chunk);if(m.method==='turn/start'){f.calls.push(m);queueMicrotask(()=>f.note('turn/started',{turn:{id:'a'}}));cb();return}original.write(chunk,cb)}})
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e),requestTimeoutMs:15})
 await new Promise(r=>setTimeout(r,35));f.note('turn/completed',{turn:{id:'a',status:'completed'}})
 await p;assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(events.filter(x=>x.type==='turn.completed').length,1)
})
test('native failure before paid turn must not submit a turn',async()=>{
 const f=fixture(null),events=[];const original=f.proc.stdin
 f.proc.stdin=new Writable({write(chunk,_,cb){const m=JSON.parse(chunk);if(m.method==='thread/goal/get'){f.send({method:'error',params:{threadId:'thread',willRetry:false,error:{message:'fixture failure'}}})}original.write(chunk,cb)}})
 await assert.rejects(runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)}),/Codex native error/)
 assert.equal(f.calls.filter(x=>x.method==='turn/start').length,0)
})
test('delayed native turn event after lost acknowledgment is accepted without a second submission',async()=>{
 const f=fixture(null),events=[];const original=f.proc.stdin
 f.proc.stdin=new Writable({write(chunk,_,cb){const m=JSON.parse(chunk);if(m.method==='turn/start'){f.calls.push(m);setTimeout(()=>f.note('turn/started',{turn:{id:'a'}}),25);cb();return}original.write(chunk,cb)}})
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e),requestTimeoutMs:15})
 await new Promise(r=>setTimeout(r,38));f.note('turn/completed',{turn:{id:'a',status:'completed'}})
 await p;assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(events.filter(x=>x.type==='turn.completed').length,1)
})
test('missing acknowledgment and native events never resubmits an uncertain turn',async()=>{
 const f=fixture(null),events=[];const original=f.proc.stdin
 f.proc.stdin=new Writable({write(chunk,_,cb){const m=JSON.parse(chunk);if(m.method==='turn/start'){f.calls.push(m);cb();return}original.write(chunk,cb)}})
 await assert.rejects(runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e),requestTimeoutMs:10}),/timeout: turn\/start/)
 assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(events.some(x=>x.type==='turn.completed'),false)
})
test('closed native output channel fails promptly rather than leaving a permanently busy task',async()=>{
 const f=fixture(),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)})
 const check=assert.rejects(p,/Codex output closed/)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.proc.stdout.end();await check
 assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(events.some(x=>x.type==='turn.completed'),false)
})
test('native failure text never escapes into bridge error or logs',async()=>{
 const f=fixture(),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)})
 const check=assert.rejects(p,e=>e.message==='Codex turn failed')
 await tick();f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:'secret sk-do-not-log'}}});await check
})
test('native auth failure retains a safe login signal without exposing provider text',async()=>{
 const f=fixture(),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)})
 const check=assert.rejects(p,e=>e.message==='Codex authentication_error')
 await tick();f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:'401 Unauthorized at https://private.example/secret'}}});await check
})
test('optional MCP 401 warns but does not kill the native turn or prompt account login',async()=>{
 const f=fixture(null),events=[];const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'hi',sandbox:'read-only',emit:e=>events.push(e)})
 await tick();f.note('error',{willRetry:false,error:{message:'MCP client for docs failed to start: 401 Unauthorized'}})
 f.note('turn/completed',{turn:{id:'a',status:'completed'}});await p
 assert.equal(events.filter(x=>x.type==='turn.completed').length,1)
 assert.equal(events.some(x=>JSON.stringify(x).includes('Unauthorized')),false)
})

function recoveryFixture({goal=null,health=true,fork=true}={}) {
 const proc=new EventEmitter(),calls=[];proc.stdout=new PassThrough()
 let current='thread',turn=0
 const send=x=>proc.stdout.write(JSON.stringify(x)+'\n')
 proc.stdin=new Writable({write(chunk,_,cb){
  const m=JSON.parse(chunk);calls.push(m)
  queueMicrotask(()=>{
   if(!m.id)return
   let result={}
   if(m.method==='thread/start')result={thread:{id:'thread'}}
   if(m.method==='thread/goal/get')result={goal:goal?{status:goal}:null}
   if(m.method==='account/read')result=health?{account:{type:'chatgpt'},requiresOpenaiAuth:true,workspaceRouting:{backendOrigin:'https://fixture.invalid'}}:{account:{type:'chatgpt'},requiresOpenaiAuth:true,workspaceRouting:null}
   if(m.method==='thread/fork')result=fork?{thread:{id:'thread-'+(++turn)}}:undefined
   if(m.method==='turn/start')result={turn:{id:['a','b','c'][calls.filter(x=>x.method==='turn/start').length-1]}}
   send(result===undefined?{id:m.id,error:{code:-32602,message:'unsupported'}}:{id:m.id,result})
  });cb()
 }})
 return {proc,calls,send,note:(method,params={})=>send({method,params:{threadId:current,...params}}),setThread:id=>{current=id},setGoal:g=>{goal=g}}
}

test('terminal route timeout forks before failed turn and submits one recovered paid turn',async()=>{
 const f=recoveryFixture(),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:e=>events.push(e)})
 await tick();f.note('turn/started',{turn:{id:'a'}})
 f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await tick()
 assert.deepEqual(f.calls.filter(x=>x.method==='thread/fork').map(x=>({threadId:x.params.threadId,beforeTurnId:x.params.beforeTurnId,sandbox:x.params.sandbox})),[{threadId:'thread',beforeTurnId:'a',sandbox:'read-only'}])
 assert.deepEqual(f.calls.filter(x=>x.method==='turn/start').map(x=>x.params.threadId),['thread','thread-1'])
 assert.equal(events.filter(e=>e.type==='retry.status').length,1)
 assert.equal(events.filter(e=>e.type==='thread.started').at(-1).thread_id,'thread-1')
 f.setThread('thread-1');f.note('turn/started',{turn:{id:'b'}});f.note('turn/completed',{turn:{id:'b',status:'completed'}})
 await p;assert.equal(events.filter(e=>e.type==='turn.completed').length,1)
})

test('route timeout after native activity never forks or resubmits',async()=>{
 const f=recoveryFixture(),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:e=>events.push(e)})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}})
 f.note('item/agentMessage/delta',{turnId:'a',itemId:'m',delta:'partial'})
 f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection
 assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0)
 assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1)
})

for(const item of [{type:'reasoning',id:'r'},{type:'commandExecution',id:'c',command:'true'},{type:'fileChange',id:'f',changes:[]},{type:'mcpToolCall',id:'m',server:'fixture',tool:'x'},{type:'newUnknownThing',id:'u'}])test(`route timeout after ${item.type} fails closed`,async()=>{
 const f=recoveryFixture(),p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:()=>{}})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('item/started',{turnId:'a',item});f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection;assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0)
})

test('route timeout after usage notification does not duplicate paid work',async()=>{
 const f=recoveryFixture(),p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:()=>{}})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('thread/tokenUsage/updated',{turnId:'a',tokenUsage:{total:{inputTokens:4,outputTokens:0,cachedInputTokens:0}}});f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection;assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0)
})

for(const setup of [{name:'active goal',options:{goal:'active'}},{name:'unhealthy route',options:{health:false}},{name:'unsupported fork',options:{fork:false}}])test(`${setup.name} prevents a second paid turn`,async()=>{
 const f=recoveryFixture(setup.options),p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:()=>{}})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection;assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1)
})

test('two qualified failures allow exactly two forks and no fourth paid submission',async()=>{
 const f=recoveryFixture(),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:e=>events.push(e)})
 const rejection=assert.rejects(p,e=>e.message==='Codex workspace-routing-timeout:2')
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await tick();f.setThread('thread-1');f.note('turn/started',{turn:{id:'b'}});f.note('turn/completed',{turn:{id:'b',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await tick();f.setThread('thread-2');f.note('turn/started',{turn:{id:'c'}});f.note('turn/completed',{turn:{id:'c',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection;assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,2);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,3)
 assert.deepEqual(events.filter(x=>x.type==='retry.status').map(x=>x.attempt),[1,2])
})

test('stopping during backoff prevents fork or another paid turn',async()=>{
 const f=recoveryFixture(),abort=new AbortController(),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',signal:abort.signal,recoverySleep:async()=>{abort.abort()},emit:e=>events.push(e)})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection;assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1)
})

test('a failed turn with an unacknowledged paid start never forks',async()=>{
 const f=recoveryFixture(),original=f.proc.stdin
 f.proc.stdin=new Writable({write(chunk,_,cb){
  const m=JSON.parse(chunk)
  if(m.method==='turn/start'){f.calls.push(m);queueMicrotask(()=>f.note('turn/started',{turn:{id:'a'}}));cb();return}
  original.write(chunk,cb)
 }})
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',requestTimeoutMs:12,recoverySleep:async()=>{},emit:()=>{}})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection;assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0)
})

test('another active turn makes the failed turn ineligible for recovery',async()=>{
 const f=recoveryFixture(),p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:()=>{}})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/started',{turn:{id:'other'}})
 f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await rejection;assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0)
})

test('a native routing error notification alone cannot authorize a paid retry',async()=>{
 const f=recoveryFixture(),p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',routeErrorWaitMs:12,recoverySleep:async()=>{},emit:()=>{}})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}});const start=Date.now();f.note('error',{willRetry:false,error:{message:ROUTE_TIMEOUT}})
 await rejection;assert.ok(Date.now()-start<250);assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1)
})

test('forked thread counts only usage beyond a proven inherited baseline',async()=>{
 const f=recoveryFixture(),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:e=>events.push(e)})
 await tick();f.note('turn/started',{turn:{id:'a'}})
 f.note('thread/tokenUsage/updated',{turnId:'history',tokenUsage:{total:{inputTokens:1000,outputTokens:0,cachedInputTokens:0}}})
 f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await tick();f.setThread('thread-1');f.note('turn/started',{turn:{id:'b'}})
 f.note('thread/tokenUsage/updated',{turnId:'b',tokenUsage:{total:{inputTokens:1009,outputTokens:3,cachedInputTokens:2}}})
 f.note('turn/completed',{turn:{id:'b',status:'completed'}})
 await p;assert.deepEqual(events.find(e=>e.type==='turn.completed').usage,{input_tokens:9,output_tokens:3,cached_input_tokens:2})
 const ready=events.flatMap(e=>createCodexTranslator().push(JSON.stringify(e))).filter(e=>e.k==='session.ready')
 assert.equal(ready.at(-1)?.sessionId,'thread-1')
})

test('recovered turn with no inherited baseline does not claim its cumulative total as new usage',async()=>{
 const f=recoveryFixture(),events=[]
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',recoverySleep:async()=>{},emit:e=>events.push(e)})
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await tick();f.setThread('thread-1');f.note('turn/started',{turn:{id:'b'}})
 f.note('thread/tokenUsage/updated',{turnId:'b',tokenUsage:{total:{inputTokens:1012,outputTokens:0,cachedInputTokens:0}}})
 f.note('turn/completed',{turn:{id:'b',status:'completed'}})
 await p;assert.equal(events.find(e=>e.type==='turn.completed').usage,undefined)
})

test('late assistant activity during recovery backoff revokes fork eligibility',async()=>{
 const f=recoveryFixture(),events=[],abort=new AbortController()
 const p=runCodexTaskBridge({proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',signal:abort.signal,recoverySleep:async()=>{f.note('item/agentMessage/delta',{turnId:'a',itemId:'late',delta:'late'});await tick()},emit:e=>events.push(e)})
 const rejection=assert.rejects(p)
 await tick();f.note('turn/started',{turn:{id:'a'}});f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
 await new Promise(r=>setTimeout(r,45))
 try {assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,0)}finally{abort.abort();await rejection}
})
