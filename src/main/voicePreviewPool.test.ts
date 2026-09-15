import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createVoicePreviewPool} from './voicePreviewPool.ts'
import type {PreviewLink} from './voicePreviewSession.ts'
type Fake=PreviewLink&{terminated:number}
const tick=()=>new Promise(r=>setImmediate(r))
function fakeLink():Fake{let exit!:()=>void;const l={alive:true,terminated:0,ready:Promise.resolve(),exited:new Promise<void>(r=>exit=r),open:()=>({} as never),terminate(){l.terminated++;l.alive=false;exit()}};return l}
function timers(){const list:{fn:()=>void;ms:number;id:number}[]=[];let n=0;return {list,setTimer:(fn:()=>void,ms:number)=>{const id=++n;list.push({fn,ms,id});return id},clearTimer:(h:unknown)=>{const i=list.findIndex(t=>t.id===h);if(i>=0)list.splice(i,1)},fire(){const t=list.shift();t?.fn()}}}

test('第一次 acquire 建 link，之后复用同一条；release 后闲置到时才 terminate', () => {
 let created=0;const t=timers();const pool=createVoicePreviewPool({create:()=>{created++;return fakeLink()},idleMs:600_000,setTimer:t.setTimer,clearTimer:t.clearTimer})
 const a=pool.acquire() as Fake;const b=pool.acquire();assert.equal(a,b);assert.equal(created,1);assert.equal(pool.warm(),true)
 pool.release();assert.equal(t.list.length,1);assert.equal(t.list[0].ms,600_000);assert.equal(a.terminated,0,'释放只是开始计时')
 pool.acquire();assert.equal(t.list.length,0,'再次使用取消闲置计时');assert.equal(created,1)
 pool.release();t.fire();assert.equal(a.terminated,1);assert.equal(pool.warm(),false)
 const c=pool.acquire();assert.notEqual(c,a as PreviewLink);assert.equal(created,2)
})

test('link 自己死了（worker 崩溃）之后 acquire 会建新的，不会把死 link 发出去', async () => {
 let created=0;const t=timers();const pool=createVoicePreviewPool({create:()=>{created++;return fakeLink()},idleMs:1000,setTimer:t.setTimer,clearTimer:t.clearTimer})
 const a=pool.acquire();a.terminate();await tick()
 const b=pool.acquire();assert.notEqual(a,b);assert.equal(created,2)
})

test('drop 立刻结束常驻 worker（退出、内存压力）', () => {
 const t=timers();const pool=createVoicePreviewPool({create:()=>fakeLink(),idleMs:1000,setTimer:t.setTimer,clearTimer:t.clearTimer})
 const a=pool.acquire() as Fake;pool.release();pool.drop();assert.equal(a.terminated,1);assert.equal(t.list.length,0);assert.equal(pool.warm(),false)
 pool.drop() // 幂等
})
