import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import * as preview from './voicePreviewAdmission.ts'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,queuedSessionStarts} from './sessionStartup.ts'
import {ownedSessions} from './ownedSessions.ts'
const turn=()=>new Promise(r=>setImmediate(r))
const mine=(id:number)=>ownedSessions.list(id).filter(x=>x.id.startsWith('voice-preview:'))
test('preview lease: cancel while loading stops it; manual stop from another window is refused; manual + caller stop is idempotent',async()=>{
 const open=(preview as any).openManagedPreview
 assert.equal(typeof open,'function')
 let now=0,starts=0,stops=0,resolveReady!:()=>void,rejectReady!:(e:Error)=>void
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:true}) // 严重压力也不排队
 const owner=Object.assign(new EventEmitter(),{id:91,isDestroyed:()=>false}),errors:string[]=[]
 const create=()=>{starts++;let done!:()=>void;return {ready:new Promise<void>((r,j)=>{resolveReady=r;rejectReady=j}),completed:new Promise<void>(r=>{done=r}),stop(){stops++;rejectReady(Error('stopped'));done()},push:()=>true,takeText:async()=>''}}
 // 模型加载中取消：lease 立刻停，抛 cancelled；不占预算、不进队列
 const signal=new AbortController(),loading=open(owner,signal.signal,create,(e:string)=>errors.push(e))
 const failed=assert.rejects(loading,/cancelled|stopped/)
 await turn();assert.equal(starts,1);assert.equal(queuedSessionStarts(owner.id).length,0);assert.equal(manager.snapshot().reserved.memoryBytes,0)
 signal.abort();await turn();assert.equal(stops,1,'cancel must stop the lease before worker ready');await failed
 assert.equal(owner.listenerCount('destroyed'),0);assert.equal(mine(owner.id).length,0)
 // 正常：就绪后登记为 voice 服务；别的窗口关不掉；本窗口关掉会通知录音层；调用方再 stop 幂等
 const normal=open(owner,new AbortController().signal,create,(e:string)=>errors.push(e))
 await turn();resolveReady();const session=await normal
 assert.equal(manager.snapshot().running,0);assert.equal(manager.snapshot().reserved.memoryBytes,0)
 const item=mine(owner.id)[0];assert.equal(item.kind,'voice')
 assert.equal((await ownedSessions.stop(item.id,92,async()=>true)).ok,false)
 assert.equal((await ownedSessions.stop(item.id,owner.id,async()=>true)).ok,true)
 assert.equal(errors.length,1,'manual service stop must notify recording UI')
 session.stop();assert.equal(stops,2,'manual plus caller stop must be idempotent')
 await session.completed;await turn();assert.equal(mine(owner.id).length,0)
 manager.dispose()
})
