import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeController} from './controller.ts'
const flush=()=>new Promise(r=>setImmediate(r))
test('application controller owns one driver; unverified memory cannot enter admission',async()=>{
 let reads=0,now=1,id=0;const timers=new Map<number,()=>void>()
 const c=createRuntimeController({now:()=>now,read:async()=>{reads++;return {at:now,logicalCpus:1,totalMemoryBytes:1000,memoryUsedBytes:100,memoryMethod:'test',memoryAdmissionVerified:false,cpuTicks:[{user:now*10,nice:0,sys:0,idle:now*90,irq:0}]}},setTimer:fn=>{timers.set(++id,fn);return id},clearTimer:h=>{timers.delete(h as number)}})
 assert.equal(reads,0);c.start();c.start();await flush();assert.equal(reads,1)
 assert.equal(c.snapshot().policyDecision.allowed,false)
 now=3001;for(const [id,fn] of [...timers]){timers.delete(id);fn()};await flush()
 assert.equal(reads,2);assert.equal(c.snapshot().policyDecision.allowed,false)
 c.dispose();assert.equal(timers.size,0)
 assert.throws(()=>c.start(),/disposed/)
})
test('stale cached display is not presented as a fresh system measurement',async()=>{
 let now=1
 const c=createRuntimeController({now:()=>now,read:async()=>({at:1,logicalCpus:1,totalMemoryBytes:1000,memoryUsedBytes:100,memoryMethod:'test',memoryAdmissionVerified:false,cpuTicks:[]}),setTimer:()=>0,clearTimer:()=>{}})
 c.start();await flush();assert.equal(c.read().sampledAt,1)
 now=6002;assert.throws(()=>c.read(),/暂不可用/);c.dispose()
})
test('mode switch changes the actual manager threshold without enabling unverified admission',async()=>{
 const c=createRuntimeController({now:()=>1,mode:'eco',read:async()=>({at:1,logicalCpus:1,totalMemoryBytes:1000,memoryUsedBytes:100,memoryMethod:'test',memoryAdmissionVerified:false,cpuTicks:[]}),setTimer:()=>0,clearTimer:()=>{}})
 assert.equal(c.snapshot().threshold,50)
 c.setMode('normal');assert.equal(c.snapshot().threshold,80)
 assert.throws(()=>c.setMode('invalid' as any),/invalid/)
 assert.equal(c.snapshot().threshold,80);assert.equal(c.snapshot().policyDecision.allowed,false)
 c.dispose()
})

test('control snapshot remains available before sampling and after failure without exposing stale usage',async()=>{
 let now=1,fail=false,id=0;const timers=new Map<number,()=>void>()
 const c=createRuntimeController({now:()=>now,read:async()=>{if(fail)throw Error('reader failed');return {at:now,logicalCpus:2,totalMemoryBytes:1000,memoryUsedBytes:100,memoryMethod:'test',memoryAdmissionVerified:true,cpuTicks:[]}},setTimer:fn=>{timers.set(++id,fn);return id},clearTimer:h=>{timers.delete(h as number)}})
 assert.equal(c.readForControl().metricsAvailable,false)
 c.start();await flush();assert.equal(c.readForControl().metricsAvailable,true)
 now=6002;assert.equal(c.readForControl().cpuPercent,null);assert.equal(c.readForControl().memoryUsedBytes,null)
 fail=true;for(const [key,fn] of [...timers]){timers.delete(key);fn()};await flush()
 const s=c.readForControl();assert.equal(s.metricsAvailable,false);assert.equal(s.totalMemoryBytes,1000);assert.equal(s.mode,'normal')
 assert.equal(c.snapshot().policyDecision.allowed,false);c.dispose()
})

test('a fresh-looking cached sample is invalid immediately after reader failure',async()=>{
 let now=1,fail=false,id=0;const timers=new Map<number,()=>void>()
 const c=createRuntimeController({now:()=>now,read:async()=>{if(fail)throw Error('failed');return {at:now,logicalCpus:1,totalMemoryBytes:1000,memoryUsedBytes:100,memoryMethod:'test',memoryAdmissionVerified:true,cpuTicks:[]}},setTimer:fn=>{timers.set(++id,fn);return id},clearTimer:h=>{timers.delete(h as number)}})
 c.start();await flush();assert.equal(c.read().memoryUsedBytes,100)
 now=1001;fail=true;for(const [key,fn] of [...timers]){timers.delete(key);fn()};await flush()
 assert.throws(()=>c.read(),/暂不可用/)
 assert.equal(c.readForControl().metricsAvailable,false);c.dispose()
})

// 2026-09-14 审查修正：未校准平台 → 闸门失效（只监测），提交的启动照常运行；不把估算读数送进准入。
test('unverified platform disables enforcement instead of closing the gate',async()=>{
 const c=createRuntimeController({now:()=>1,read:async()=>({at:1,logicalCpus:1,totalMemoryBytes:1000,memoryUsedBytes:100,memoryMethod:'windows-free',memoryAdmissionVerified:false,cpuTicks:[]}),setTimer:()=>0,clearTimer(){}})
 c.start();await flush()
 assert.equal(c.readForControl().enforcement,'disabled')
 assert.equal(c.snapshot().policyDecision.allowed,false,'估算读数仍不进准入决策')
 let ran=0;await c.manager.submit({id:'t',projectId:'p',cost:{cpu:50,memoryBytes:1},run:async()=>{ran++}})
 assert.equal(ran,1,'闸门失效时任务直接跑');c.dispose()
})
