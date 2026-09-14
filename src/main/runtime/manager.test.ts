import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeManager } from './manager.ts'
const flush=()=>new Promise(r=>setImmediate(r))
const sample=(at=0,cpu=75)=>({at,cpu,memoryUsedBytes:100,totalMemoryBytes:1000,critical:false})
test('统一管理器连接采样策略预算执行，不超过估计余量',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now});m.update(sample());let done!:()=>void,ran=0
 const a=m.submit({id:'a',projectId:'p',cost:{cpu:3,memoryBytes:1},run:()=>new Promise(r=>{done=r})})
 const b=m.submit({id:'b',projectId:'p',cost:{cpu:3,memoryBytes:1},run:async()=>{ran++}})
 await flush();assert.equal(m.snapshot().running,1);assert.equal(m.snapshot().queued,1)
 done();await a;now=1000;m.update(sample(now));await b;assert.equal(ran,1);assert.equal(m.snapshot().reserved.cpu,0)
})
test('节能模式即生效，未知/过期样本不能派发',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now});m.update(sample(0,60));m.setMode('eco')
 let ran=0;const p=m.submit({id:'a',projectId:'p',cost:{cpu:1,memoryBytes:1},run:async()=>{ran++}})
 await flush();assert.equal(ran,0);now=6000;m.setMode('normal');assert.equal(ran,0)
 m.update(sample(6000,20));await p;assert.equal(ran,1)
})
test('运行取消未退出时保留预算，退出后才释放',async()=>{
 const m=createRuntimeManager({now:()=>0});m.update(sample(0,10));let done!:()=>void
 const p=m.submit({id:'a',projectId:'p',cost:{cpu:3,memoryBytes:1},run:()=>new Promise(r=>{done=r})})
 await flush();m.cancel('a');assert.equal(m.snapshot().reserved.cpu,3);done();await p;assert.equal(m.snapshot().reserved.cpu,0)
})
test('过期维护tick不依赖新采样；dispose清队列',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now,waitTimeoutMs:10})
 const p=m.submit({id:'a',projectId:'p',cost:{cpu:3,memoryBytes:1},run:async()=>{}})
 const rejected=assert.rejects(p,/wait timeout/);now=11;m.tick();await rejected;m.dispose()
 await assert.rejects(m.submit({id:'b',projectId:'p',cost:{cpu:3,memoryBytes:1},run:async()=>{}}),/disposed/)
})
test('无效成本立即拒绝，采样倒序不覆盖新快照',async()=>{
 const m=createRuntimeManager({now:()=>1000});m.update(sample(1000,90));m.update(sample(0,10))
 await assert.rejects(m.submit({id:'x',projectId:'p',cost:{cpu:-1,memoryBytes:1},run:async()=>{}}),/invalid cost/)
 const p=m.submit({id:'a',projectId:'p',cost:{cpu:1,memoryBytes:1},run:async()=>{}})
 const rejected=assert.rejects(p,/cancelled/);assert.equal(m.snapshot().queued,1);m.cancel('a');await rejected
})
test('真实预算账本允许小任务越过不匹配的大任务，余量恢复后大任务执行一次',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now});m.update(sample(0,75))
 const order:string[]=[]
 const big=m.submit({id:'big',projectId:'a',cost:{cpu:6,memoryBytes:1},run:async()=>{order.push('big')}})
 const small=m.submit({id:'small',projectId:'b',cost:{cpu:2,memoryBytes:1},run:async()=>{order.push('small')}})
 await small;assert.deepEqual(order,['small']);assert.equal(m.snapshot().queued,1)
 assert.deepEqual(m.snapshot().reserved,{cpu:0,memoryBytes:0})
 now=1000;m.update(sample(now,60));await big
 assert.deepEqual(order,['small','big']);assert.equal(m.snapshot().queued,0);m.dispose()
})
test('同一采样周期最多启动一项，完成不触发瞬间放满队列',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now});m.update(sample(0,10));const order:string[]=[]
 const a=m.submit({id:'a',projectId:'p',cost:{cpu:1,memoryBytes:1},run:async()=>{order.push('a')}})
 const b=m.submit({id:'b',projectId:'q',cost:{cpu:1,memoryBytes:1},run:async()=>{order.push('b')}})
 await a;await flush();assert.deepEqual(order,['a']);assert.equal(m.snapshot().queued,1)
 m.tick();m.setMode('normal');m.update(sample(0,10));await flush();assert.deepEqual(order,['a'])
 now=1000;m.update(sample(now,10));await b;assert.deepEqual(order,['a','b'])
})
test('采样失败立即暂停准入，不等旧快照过期；新样本才恢复',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now});m.update(sample(0,10));m.invalidateMetrics()
 let ran=false;const p=m.submit({id:'a',projectId:'p',cost:{cpu:1,memoryBytes:1},run:async()=>{ran=true}})
 await flush();assert.equal(ran,false);assert.equal(m.snapshot().policyDecision.reason,'metrics-unavailable')
 m.update(sample(0,10));m.setMode('normal');m.tick();await flush();assert.equal(ran,false)
 now=1000;m.update(sample(now,10));await p;assert.equal(ran,true)
})
test('未来时间戳不污染采样顺序且立即关闸，随后正常采样可恢复',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now});m.update(sample(0,10));m.update(sample(100000,10))
 assert.equal(m.snapshot().sample?.at,0)
 assert.equal(m.snapshot().policyDecision.reason,'metrics-unavailable')
 let ran=false;const p=m.submit({id:'a',projectId:'p',cost:{cpu:1,memoryBytes:1},run:async()=>{ran=true}})
 await flush();assert.equal(ran,false)
 now=1000;m.update(sample(now,10));await p;assert.equal(ran,true)
})

test('long-lived service keeps its budget but releases startup slot for nested tools',async()=>{
 let now=0,exit!:()=>void
 const m=createRuntimeManager({now:()=>now,maxRunning:1});m.update(sample(0,10))
 await m.submitService({id:'service',projectId:'p',cost:{cpu:3,memoryBytes:100},start:async()=>({completed:new Promise<void>(r=>exit=r)})})
 assert.equal(m.snapshot().running,0);assert.equal(m.snapshot().reserved.memoryBytes,100)
 let ran=false;const child=m.submit({id:'tool',projectId:'p',cost:{cpu:3,memoryBytes:100},run:async()=>{ran=true}})
 now=1000;m.update(sample(now,10));await child;assert.equal(ran,true)
 assert.equal(m.snapshot().reserved.memoryBytes,100)
 exit();await flush();assert.equal(m.snapshot().reserved.memoryBytes,0);m.dispose()
})
test('failed service completion observer cannot free live process budget',async()=>{
 const m=createRuntimeManager({now:()=>0});m.update(sample(0,10))
 await m.submitService({id:'service',projectId:'p',cost:{cpu:3,memoryBytes:100},start:async()=>({completed:Promise.reject(Error('observer failed'))})})
 await flush();assert.equal(m.snapshot().reserved.memoryBytes,100);m.dispose()
})

// 2026-09-14 审查修正（发版拦截级）：平台未校准时闸门必须**失效而不是关死**——
// 否则 Windows / Intel Mac / 旧 macOS 上终端、AI、插件全部排队 60 秒后失败。
test('闸门失效（未校准平台）：没有采样也直接放行，不记预算',async()=>{
 const m=createRuntimeManager({now:()=>0});m.setEnforcement(false)
 let ran=0;await m.submit({id:'a',projectId:'p',cost:{cpu:50,memoryBytes:1},run:async()=>{ran++}})
 assert.equal(ran,1);assert.equal(m.snapshot().enforcement,'disabled');assert.equal(m.snapshot().reserved.cpu,0)
 m.setEnforcement(true);assert.equal(m.snapshot().enforcement,'enabled')
 let ran2=0;const p=m.submit({id:'b',projectId:'p',cost:{cpu:1,memoryBytes:1},run:async()=>{ran2++}})
 await flush();assert.equal(ran2,0,'恢复闸门后又要等采样');m.update(sample(0,10));await p;assert.equal(ran2,1)
})
test('交互型服务：内存超阈值也放行并记预算；严重压力才等；启动后释放 CPU 预留只留内存',async()=>{
 let now=0;const m=createRuntimeManager({now:()=>now,maxRunning:1})
 m.update({at:0,cpu:10,memoryUsedBytes:900,totalMemoryBytes:1000,critical:false}) // 90% > 80%
 let exit!:()=>void
 const p=m.submitService({id:'pty',projectId:'p',cost:{cpu:12,memoryBytes:5},interactive:true,start:async()=>({completed:new Promise<void>(r=>{exit=r})})})
 await p
 assert.equal(m.snapshot().reserved.memoryBytes,5,'内存预留保留到退出');assert.equal(m.snapshot().reserved.cpu,0,'启动完成后 CPU 预留释放')
 now=1000;m.update({at:1000,cpu:10,memoryUsedBytes:900,totalMemoryBytes:1000,critical:true})
 let ran=0;const q=m.submitService({id:'pty2',projectId:'p',cost:{cpu:12,memoryBytes:5},interactive:true,start:async()=>{ran++;return {completed:Promise.resolve()}}})
 await flush();assert.equal(ran,0,'严重压力下交互型也等')
 now=2000;m.update({at:2000,cpu:10,memoryUsedBytes:900,totalMemoryBytes:1000,critical:false});await q;assert.equal(ran,1)
 exit();await flush();assert.equal(m.snapshot().reserved.memoryBytes,0)
})
