import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,runAppTask,queuedSessionStarts,cancelSessionStart,cancelSessionStartsForWindow} from './sessionStartup.ts'

// 应用自己发起的后台任务（CLI 更新下载/校验）没有窗口归属：任何窗口都看得见它在排队，
// 但没有哪个窗口有权取消它；窗口关闭也不能带走它。预算与完成语义沿用 runManagedTask。
test('应用级任务：全窗口可见、窗口不可取消、真实完成才释放预算',async()=>{
 let now=0,done!:()=>void
 const m=createRuntimeManager({now:()=>now,maxRunning:1});installSessionStartup(m)
 const p=runAppTask<string>({id:'cli-update:codex',name:'CLI 更新 codex',cost:{cpu:5,memoryBytes:256},start:async()=>{
  const completed=new Promise<void>(r=>{done=r});return {result:Promise.resolve('staged'),completed}
 }})
 const seen7=queuedSessionStarts(7),seen8=queuedSessionStarts(8)
 assert.equal(seen7.length,1);assert.equal(seen7[0].scope,'app');assert.equal(seen7[0].state,'queued');assert.equal(seen8.length,1)
 assert.equal(cancelSessionStart('cli-update:codex',7),false)
 cancelSessionStartsForWindow(7);cancelSessionStartsForWindow(8)
 m.update({at:0,cpu:10,memoryUsedBytes:100,totalMemoryBytes:1000,critical:false})
 assert.equal(await p,'staged')
 assert.equal(m.snapshot().reserved.memoryBytes,256,'调用方结果先回来，预算仍要等真实完成')
 done();await new Promise(r=>setImmediate(r))
 assert.equal(m.snapshot().reserved.memoryBytes,0);assert.equal(queuedSessionStarts(7).length,0)
 m.dispose()
})
