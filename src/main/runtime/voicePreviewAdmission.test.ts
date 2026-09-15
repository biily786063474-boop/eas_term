import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,queuedSessionStarts} from './sessionStartup.ts'
import {ownedSessions} from './ownedSessions.ts'
import {openManagedPreview} from './voicePreviewAdmission.ts'
const tick=()=>new Promise(r=>setImmediate(r))
const mine=(id:number)=>ownedSessions.list(id).filter(x=>x.id.startsWith('voice-preview:'))

test('语音启动不进准入队列：严重压力下也立刻开 lease、不占预算；导航 / 取消 / 运行页关闭各自收口', async () => {
 let now=0,opens=0,stops=0
 const manager=createRuntimeManager({now:()=>now});installSessionStartup(manager)
 manager.update({at:++now,cpu:1,memoryUsedBytes:1,totalMemoryBytes:8*1024**3,critical:true}) // 2026-09-14：用户要语音永不排队
 const owner=Object.assign(new EventEmitter(),{id:4,isDestroyed:()=>false})
 const lease=(ready:Promise<void>=Promise.resolve())=>{let done!:()=>void;const completed=new Promise<void>(r=>done=r);opens++;return {ready,completed,stop(){stops++;done()},push:()=>true,takeText:async()=>''}}
 const s=await openManagedPreview(owner,new AbortController().signal,()=>lease(),()=>{})
 assert.equal(opens,1);assert.equal(queuedSessionStarts(4).length,0);assert.equal(manager.snapshot().reserved.memoryBytes,0)
 assert.equal(mine(4).length,1);assert.equal(mine(4)[0].kind,'voice')
 owner.emit('did-navigate');assert.equal(stops,1);await s.completed;await tick()
 assert.equal(mine(4).length,0,'lease 结束即从托管服务消失，不等 worker 退出');assert.equal(owner.listenerCount('did-navigate'),0)

 // 模型还没加载完就取消录音：lease 停掉、抛 cancelled、不留登记
 let resolveReady!:()=>void;const ac=new AbortController()
 const pending=openManagedPreview(owner,ac.signal,()=>lease(new Promise<void>(r=>resolveReady=r)),()=>{})
 const rejected=assert.rejects(pending,/cancelled/);ac.abort();resolveReady();await rejected
 assert.equal(stops,2);assert.equal(mine(4).length,0);assert.equal(owner.listenerCount('destroyed'),0)

 // 运行与资源页点「关闭」：走 ownedSessions.stop → 通知录音层
 const notices:string[]=[]
 const s2=await openManagedPreview(owner,new AbortController().signal,()=>lease(),m=>notices.push(m))
 assert.equal((await ownedSessions.stop(mine(4)[0].id,4,async()=>true)).ok,true)
 assert.deepEqual(notices,['流式识别服务已关闭，录音已停止']);await s2.completed;assert.equal(stops,3)
 manager.dispose()
})
