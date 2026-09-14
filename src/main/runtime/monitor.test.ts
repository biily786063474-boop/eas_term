import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeMonitor} from './monitor.ts'
test('真实读取适配同一次缓存，第二帧计算CPU且不冒充限流',async()=>{
 let now=0,count=0
 const m=createRuntimeMonitor(async()=>{count++;return {at:now,logicalCpus:1,totalMemoryBytes:1000,memoryUsedBytes:300,memoryMethod:'estimate',cpuTicks:[{user:count*50,idle:count*50,sys:0,nice:0,irq:0}]}},()=>now)
 assert.equal((await m.read()).cpuPercent,null);await m.read();assert.equal(count,1)
 now=3000;const result=await m.read();assert.equal(result.cpuPercent,50);assert.equal(result.enforcement,'disabled')
})
