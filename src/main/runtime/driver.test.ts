import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeDriver} from './driver.ts'
import {createRuntimeManager} from './manager.ts'
const flush=()=>new Promise(r=>setImmediate(r))
function timers(){let id=0;const tasks=new Map<number,()=>void>();return {tasks,setTimer(fn:()=>void){tasks.set(++id,fn);return id},clearTimer(h:unknown){tasks.delete(h as number)},fire(){const first=tasks.entries().next().value!;tasks.delete(first[0]);first[1]()}}}
test('no timer before start; duplicate start does not duplicate loops; dispose rejects late reading',async()=>{
 const t=timers();let reads=0,updates=0,ticks=0,disposed=0,resolve!:(v:number)=>void
 const d=createRuntimeDriver({read:()=>{reads++;return new Promise<number>(r=>resolve=r)},update:()=>updates++,invalidate:()=>{},tick:()=>ticks++,dispose:()=>disposed++,...t})
 assert.equal(t.tasks.size,0);d.start();d.start();assert.equal(reads,1);assert.equal(t.tasks.size,1)
 t.fire();assert.equal(ticks,1);assert.equal(reads,1)
 d.dispose();d.dispose();resolve(1);await flush();assert.equal(updates,0);assert.equal(disposed,1);assert.equal(t.tasks.size,0)
 assert.throws(()=>d.start(),/disposed/)
})
test('maintenance expires queued work while sampling is stuck',async()=>{
 let now=0;const t=timers(),m=createRuntimeManager({now:()=>now,waitTimeoutMs:10})
 const d=createRuntimeDriver({read:()=>new Promise<never>(()=>{}),update:m.update,invalidate:()=>{},tick:m.tick,dispose:m.dispose,...t})
 d.start();const p=m.submit({id:'a',projectId:'p',cost:{cpu:1,memoryBytes:1},run:async()=>{throw Error('must not run')}})
 const rejected=assert.rejects(p,/wait timeout/);now=11;t.fire();await rejected;d.dispose();assert.equal(t.tasks.size,0)
})
test('rejected sample retries serially without blocking maintenance',async()=>{
 const t=timers();let reads=0,updates=0,ticks=0
 const d=createRuntimeDriver({read:async()=>{reads++;if(reads===1)throw Error('unavailable');return 1},update:()=>updates++,invalidate:()=>{},tick:()=>ticks++,dispose:()=>{},...t})
 d.start();await flush();assert.equal(t.tasks.size,2)
 t.fire();t.fire();await flush();assert.equal(reads,2);assert.equal(updates,1);assert.equal(ticks,1)
 d.dispose();assert.equal(t.tasks.size,0)
})
test('maintenance exception cannot escape timer and retains one retry',()=>{
 const t=timers();let disposed=0
 const d=createRuntimeDriver({read:()=>new Promise<never>(()=>{}),update:()=>{},invalidate:()=>{},tick:()=>{throw Error('unavailable')},dispose:()=>disposed++,...t})
 d.start();assert.doesNotThrow(()=>t.fire());assert.equal(t.tasks.size,1);d.dispose();assert.equal(disposed,1)
})
test('读取失败通知失效，停止后的迟到拒绝不再回调',async()=>{
 const t=timers();let errors=0,reject!:(e:unknown)=>void
 const d=createRuntimeDriver({read:()=>new Promise<never>((_,r)=>reject=r),update:()=>{},invalidate:()=>errors++,tick:()=>{},dispose:()=>{},...t})
 d.start();reject(Error('read failed'));await flush();assert.equal(errors,1)
 t.fire();t.fire();d.dispose();reject(Error('late failure'));await flush();assert.equal(errors,1)
})
