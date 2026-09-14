import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScheduler } from './scheduler.ts'
const flush = () => new Promise(r => setImmediate(r))
const job = (id: string, run: () => Promise<void> = async () => {}) => ({id, projectId:'p', run})
test('门关闭排队，tick开门执行，结束释放槽位', async () => {
 let open=false, count=0
 const s=createScheduler({allow:()=>open,now:()=>0,maxRunning:1,maxQueued:3})
 const a=s.submit(job('a',async()=>{count++}));assert.equal(count,0)
 open=true;s.tick();await a;assert.equal(count,1);assert.equal(s.snapshot().running,0)
})
test('并发有界，排队取消保证不执行', async () => {
 let done!:()=>void, count=0
 const s=createScheduler({allow:()=>true,now:()=>0,maxRunning:1,maxQueued:2})
 const a=s.submit(job('a',()=>new Promise(r=>{done=r})))
 const b=s.submit(job('b',async()=>{count++}));const rejected=assert.rejects(b,/cancelled/)
 assert.equal(s.cancel('b'),true);await rejected
 await flush();assert.equal(s.snapshot().running,1);done();await a;assert.equal(count,0)
})
test('重复ID和队列满明确拒绝', async () => {
 const s=createScheduler({allow:()=>false,now:()=>0,maxRunning:1,maxQueued:1})
 const a=s.submit(job('a'));const rejected=assert.rejects(a,/cancelled/)
 await assert.rejects(s.submit(job('a')),/duplicate/)
 await assert.rejects(s.submit(job('b')),/queue full/)
 s.cancel('a');await rejected
})
test('执行抛错释放额度，不重试', async () => {
 let count=0;const s=createScheduler({allow:()=>true,now:()=>0,maxRunning:1,maxQueued:3})
 await assert.rejects(s.submit(job('a',async()=>{count++;throw Error('failed')})),/failed/)
 await s.submit(job('b'));assert.equal(count,1);assert.equal(s.snapshot().running,0)
})
test('等待超时和dispose取消，不让迟到tick重启', async () => {
 let now=0;const s=createScheduler({allow:()=>false,now:()=>now,maxRunning:1,maxQueued:3,waitTimeoutMs:10})
 const a=s.submit(job('a'));const expired=assert.rejects(a,/wait timeout/);now=11;s.tick();await expired
 const b=s.submit(job('b'));const stopped=assert.rejects(b,/disposed/);s.dispose();await stopped;s.tick()
 await assert.rejects(s.submit(job('c')),/disposed/)
})
test('取消运行只发AbortSignal，未确认退出不释放槽位', async () => {
 let done!:()=>void, signal!:AbortSignal
 const s=createScheduler({allow:()=>true,now:()=>0,maxRunning:1,maxQueued:3})
 const a=s.submit({id:'a',projectId:'p',run:async sig=>{signal=sig;await new Promise<void>(r=>{done=r})}})
 await flush();assert.equal(s.cancel('a'),true);assert.equal(signal.aborted,true);assert.equal(s.snapshot().running,1)
 done();await a;assert.equal(s.snapshot().running,0)
})
test('跨项目轮转，避免同一项目队列独占', async () => {
 let open=false;const order:string[]=[]
 const s=createScheduler({allow:()=>open,now:()=>0,maxRunning:1,maxQueued:8})
 const tasks=[['a1','a'],['a2','a'],['b1','b']].map(([id,projectId])=>s.submit({id,projectId,run:async()=>{order.push(id)}}))
 open=true;s.tick();await Promise.all(tasks);assert.deepEqual(order,['a1','b1','a2'])
})
test('刚准入尚未执行就取消，回调不得执行', async () => {
 let calls=0;const s=createScheduler({allow:()=>true,now:()=>0,maxRunning:1,maxQueued:1})
 const a=s.submit(job('a',async()=>{calls++}));const cancelled=assert.rejects(a,/cancelled/)
 s.cancel('a');await cancelled;assert.equal(calls,0)
})
test('监测抛异常时保留排队且不泄漏', async () => {
 const s=createScheduler({allow:()=>{throw Error('unavailable')},now:()=>0,maxRunning:1,maxQueued:2})
 const a=s.submit(job('a'));const cancelled=assert.rejects(a,/cancelled/)
 assert.equal(s.snapshot().queued,1);assert.equal(s.snapshot().running,0);s.cancel('a');await cancelled
})
test('原子预算接入：多个并发槽也不能超售CPU预算', async()=>{
 const {createResourceLedger}=await import('./resourceLedger.ts');const ledger=createResourceLedger()
 let done!:()=>void, calls=0
 const s=createScheduler({allow:()=>true,now:()=>0,maxRunning:4,maxQueued:8,
 acquire:work=>ledger.acquire(work.id,{cpu:3,memoryBytes:1},{cpu:75,memoryUsedBytes:10,totalMemoryBytes:1000,threshold:80})})
 const a=s.submit(job('a',()=>new Promise(r=>{done=r})))
 const b=s.submit(job('b',async()=>{calls++}))
 await flush();assert.equal(s.snapshot().running,1);assert.equal(s.snapshot().queued,1)
 done();await a;await b;assert.equal(calls,1);assert.deepEqual(ledger.reserved(),{cpu:0,memoryBytes:0})
})
test('预算不足的大任务不阻塞后续可准入任务，所有尝试仍过账本',async()=>{
 let open=false;const tried:string[]=[],ran:string[]=[]
 const s=createScheduler({allow:()=>open,now:()=>0,maxRunning:1,maxQueued:4,acquire:work=>{tried.push(work.id);return work.id==='big'?null:{release(){}}}})
 const big=s.submit(job('big',async()=>{ran.push('big')}));const cancelled=assert.rejects(big,/cancelled/)
 const small=s.submit(job('small',async()=>{ran.push('small')}))
 open=true;s.tick();await flush()
 assert.deepEqual(ran,['small']);assert.equal(s.snapshot().queued,1)
 assert.ok(tried.includes('big'));assert.ok(tried.includes('small'))
 s.cancel('big');await cancelled;await small
})
test('全部预算不足时每轮有界尝试，不忙等不执行',async()=>{
 let tries=0,open=false
 const s=createScheduler({allow:()=>open,now:()=>0,maxRunning:4,maxQueued:4,acquire:()=>{tries++;return null}})
 const tasks=['a','b','c'].map(id=>s.submit(job(id)))
 const stopped=tasks.map(p=>assert.rejects(p,/disposed/))
 open=true;s.tick();assert.equal(tries,3);assert.equal(s.snapshot().running,0)
 s.dispose();await Promise.all(stopped)
})
test('任务明细只返回冻结元数据，取消未完成仍显示占用',async()=>{
 let now=0,done!:()=>void
 const s=createScheduler({allow:()=>true,now:()=>now,maxRunning:1,maxQueued:3})
 const a=s.submit(job('a',()=>new Promise(r=>done=r)));await flush()
 const b=s.submit(job('b'));const rejected=assert.rejects(b,/cancelled/)
 now=1500;s.cancel('a');const detail=s.details()
 assert.deepEqual(detail,[{id:'a',projectId:'p',state:'cancel-requested',ageMs:1500},{id:'b',projectId:'p',state:'queued',ageMs:1500}])
 assert.equal(Object.isFrozen(detail),true);assert.equal(Object.isFrozen(detail[0]),true)
 s.cancel('b');await rejected;done();await a;assert.deepEqual(s.details(),[])
})
test('同池父任务等待子任务时明确拒绝而非死锁，父任务随后释放槽位',async()=>{
 const s=createScheduler({allow:()=>true,now:()=>0,maxRunning:1,maxQueued:3})
 let childRan=false
 const parent=s.submit(job('parent',async()=>{
  await assert.rejects(s.submit(job('child',async()=>{childRan=true})),/nested admission unsupported/)
 }))
 await flush();assert.equal(s.snapshot().queued,0);assert.equal(s.snapshot().running,0)
 await parent;assert.equal(childRan,false)
 await s.submit(job('independent'));assert.equal(s.snapshot().running,0)
})
test('父任务已结束后的异步后续工作不被误判为占槽嵌套',async()=>{
 const s=createScheduler({allow:()=>true,now:()=>0,maxRunning:1,maxQueued:3})
 let resolve!:()=>void,reject!:(e:unknown)=>void
 const later=new Promise<void>((r,j)=>{resolve=r;reject=j})
 const checked=assert.doesNotReject(later)
 await s.submit(job('parent',async()=>{setImmediate(()=>{void s.submit(job('later')).then(resolve,reject)})}))
 await checked;assert.equal(s.snapshot().running,0)
})

// 2026-09-14 审查修正：用户亲手发起的启动（终端、AI 对话、插件面板、录音）是控制面，
// 不能排在重任务后面等 60 秒。interactive 条目只受 allowInteractive 门（严重压力）约束，
// 不受 allow() 与 maxRunning 限制。
test('interactive 条目绕过 allow 与 maxRunning，只受 allowInteractive 门', async () => {
 let open=false, critical=false, ran:string[]=[]
 let done!:()=>void
 const s=createScheduler({allow:()=>open,allowInteractive:()=>!critical,now:()=>0,maxRunning:1,maxQueued:8})
 const bg=s.submit(job('bg',()=>new Promise(r=>{done=r})))
 open=true;s.tick();await flush();assert.equal(s.snapshot().running,1)
 open=false
 const i1=s.submit({...job('i1',async()=>{ran.push('i1')}),interactive:true})
 await i1;assert.deepEqual(ran,['i1'],'门关着、槽满着，交互条目也要立刻跑')
 critical=true
 const i2=s.submit({...job('i2',async()=>{ran.push('i2')}),interactive:true})
 await flush();assert.deepEqual(ran,['i1'],'严重压力下交互条目也等')
 critical=false;s.tick();await i2;assert.deepEqual(ran,['i1','i2'])
 done();await bg
})
