import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResourceLedger } from './resourceLedger.ts'
test('75%+3百分点只准入一个，释放幂等',()=>{
 const r=createResourceLedger();const view={cpu:75,memoryUsedBytes:200,totalMemoryBytes:1000,threshold:80}
 const a=r.acquire('a',{cpu:3,memoryBytes:10},view);assert.ok(a)
 assert.equal(r.acquire('b',{cpu:3,memoryBytes:10},view),null)
 a.release();a.release();assert.ok(r.acquire('b',{cpu:3,memoryBytes:10},view))
})
test('内存独立限额，未知指标/无效成本拒绝',()=>{
 const r=createResourceLedger();const view={cpu:10,memoryUsedBytes:790,totalMemoryBytes:1000,threshold:80}
 assert.equal(r.acquire('a',{cpu:1,memoryBytes:20},view),null)
 assert.equal(r.acquire('a',{cpu:-1,memoryBytes:1},view),null)
 assert.equal(r.acquire('a',{cpu:1,memoryBytes:1},{...view,cpu:null}),null)
})
test('重复任务不能覆盖已有预算',()=>{
 const r=createResourceLedger();const view={cpu:10,memoryUsedBytes:10,totalMemoryBytes:1000,threshold:80}
 assert.ok(r.acquire('a',{cpu:3,memoryBytes:10},view))
 assert.equal(r.acquire('a',{cpu:1,memoryBytes:1},view),null)
 assert.deepEqual(r.reserved(),{cpu:3,memoryBytes:10})
})
