import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createToolActivity} from './toolActivity.ts'
test('caller timeout retains activity until real completion; cancellation is owner scoped',async()=>{
 let finish!:()=>void,cancels=0
 const activity=createToolActivity(()=>100)
 const result=activity.track({id:'a',name:'tool',projectId:'p',windowId:7},()=>({result:Promise.reject(Error('timeout')),completed:new Promise<void>(r=>{finish=r}),cancel(){cancels++}}))
 await assert.rejects(result,/timeout/)
 assert.equal(activity.list(7).length,1);assert.equal(activity.list(8).length,0)
 assert.equal(activity.cancel('a',8),false);assert.equal(cancels,0)
 assert.equal(activity.cancel('a',7),true);assert.equal(activity.cancel('a',7),true);assert.equal(cancels,1)
 assert.equal(activity.list(7)[0].state,'cancel-requested')
 finish();await new Promise(r=>setImmediate(r));assert.equal(activity.list(7).length,0)
})
test('unknown window cannot grant cancellation; synchronous dispatch failure leaves no ghost',async()=>{
 const activity=createToolActivity(()=>100)
 await assert.rejects(activity.track({id:'a',name:'tool',projectId:null,windowId:null},()=>{throw Error('not started')}),/not started/)
 assert.equal(activity.list(7).length,0)
})

test('插件调用在严重压力下立即执行，不占等待队列',async()=>{
 const {createRuntimeManager}=await import('./manager.ts')
 const manager=createRuntimeManager({now:()=>100})
 manager.update({at:100,cpu:99,memoryUsedBytes:990,totalMemoryBytes:1000,critical:true})
 const activity=createToolActivity(()=>100);activity.setAdmission(manager,()=>({cpu:10,memoryBytes:100}))
 let calls=0,finish!:()=>void
 const p=activity.track({id:'q',name:'tool',projectId:'p',windowId:7},()=>{calls++;return {result:Promise.resolve('ok'),completed:new Promise<void>(r=>finish=r),cancel(){}}})
 await new Promise(r=>setImmediate(r))
 assert.equal(calls,1);assert.equal(manager.snapshot().queued,0)
 assert.equal(activity.list(7)[0].state,'running');assert.equal(await p,'ok')
 finish();await new Promise(r=>setImmediate(r));manager.dispose()
})
test('fresh capacity dispatches once and result timeout does not release queue occupancy',async()=>{
 const {createRuntimeManager}=await import('./manager.ts')
 let now=100,finish!:()=>void
 const manager=createRuntimeManager({now:()=>now})
 const activity=createToolActivity(()=>now);activity.setAdmission(manager,()=>({cpu:10,memoryBytes:100}))
 const p=activity.track({id:'q',name:'tool',projectId:'p',windowId:7},()=>({result:Promise.resolve('ok'),completed:new Promise<void>(r=>finish=r),cancel(){}}))
 manager.update({at:now,cpu:10,memoryUsedBytes:100,totalMemoryBytes:1000,critical:false})
 assert.equal(await p,'ok');assert.equal(manager.snapshot().running,1)
 finish();await new Promise(r=>setImmediate(r));assert.equal(manager.snapshot().running,0);manager.dispose()
})

test('closing one source cancels only its running calls and keeps them until actual completion',async()=>{
 const activity=createToolActivity(()=>100)
 const cancelled:string[]=[],finishes:Array<()=>void>=[]
 const start=(id:string)=>()=>({result:Promise.resolve('ok'),completed:new Promise<void>(r=>finishes.push(r)),cancel(){cancelled.push(id)}})
 await activity.track({id:'a',name:'tool',projectId:'p',windowId:7,sourceKey:'panel:a'},start('a'))
 await activity.track({id:'b',name:'tool',projectId:'p',windowId:7,sourceKey:'panel:b'},start('b'))
 activity.closeSource('panel:a');activity.closeSource('panel:a')
 assert.deepEqual(cancelled,['a']);assert.deepEqual(activity.list(7).map(x=>x.state),['cancel-requested','running'])
 finishes.forEach(f=>f());await new Promise(r=>setImmediate(r));assert.equal(activity.list(7).length,0)
})

// 2026-09-14：插件工具调用结束也要进「最近结束」（完成 / 取消 / 失败），按窗口投影。
test('tool call end is recorded into recent activity with its outcome',async()=>{
 const {recentActivity}=await import('./recentActivity.ts')
 const activity=createToolActivity(()=>100)
 let finish!:()=>void
 const done=activity.track({id:'r-done',name:'画布工具',projectId:'p',windowId:71},()=>({result:Promise.resolve('ok'),completed:new Promise<void>(r=>{finish=r}),cancel(){}}))
 assert.equal(await done,'ok');finish();await new Promise(r=>setImmediate(r))
 assert.deepEqual(recentActivity.list(71).map(x=>[x.id,x.kind,x.outcome,x.projectId]),[['r-done','task','done','p']])
 let finish2!:()=>void
 const cancelled=activity.track({id:'r-cancel',name:'画布工具',projectId:null,windowId:71},()=>({result:Promise.reject(Error('timeout')),completed:new Promise<void>(r=>{finish2=r}),cancel(){}}))
 await assert.rejects(cancelled);activity.cancel('r-cancel',71);finish2();await new Promise(r=>setImmediate(r))
 assert.equal(recentActivity.list(71)[0].outcome,'cancelled')
 assert.equal(recentActivity.list(72).length,0,'别的窗口看不到')
})
