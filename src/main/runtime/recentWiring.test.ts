import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeManager} from './manager.ts'
import {installSessionStartup,runManagedTask,runAppTask,cancelSessionStart} from './sessionStartup.ts'
import {recentActivity} from './recentActivity.ts'
import {createOwnedSessions} from './ownedSessions.ts'

// 四种结局都要落到「最近结束」：完成 / 取消 / 排队超时 / 失败；自有服务真实退出也要落。
test('runManagedTask 的结局与自有服务退出落进最近结束',async()=>{
 let now=0
 const m=createRuntimeManager({now:()=>now,maxRunning:1,waitTimeoutMs:2000});installSessionStartup(m)
 const admit=()=>m.update({at:now,cpu:10,memoryUsedBytes:1024**3,totalMemoryBytes:16*1024**3,critical:false})
 const done=runManagedTask<string>({id:'t-done',windowId:41,name:'完成的',projectId:'p1',cost:{cpu:1,memoryBytes:1},start:async()=>({result:Promise.resolve('ok'),completed:Promise.resolve()})})
 admit();assert.equal(await done,'ok')
 await new Promise(r=>setImmediate(r))
 assert.deepEqual(recentActivity.list(41).map(x=>[x.id,x.outcome,x.projectId]),[['t-done','done','p1']])
 const failed=runManagedTask<string>({id:'t-fail',windowId:41,name:'失败的',projectId:null,cost:{cpu:1,memoryBytes:1},start:async()=>{throw Error('boom')}})
 now=100;admit();await assert.rejects(failed,/boom/);await new Promise(r=>setImmediate(r))
 assert.equal(recentActivity.list(41)[0].outcome,'failed')
 m.setMode('eco') // 让后面的排队：内存 1/16 不高，改用 metrics 失效
 m.invalidateMetrics()
 const cancelled=runManagedTask<string>({id:'t-cancel',windowId:41,name:'取消的',projectId:null,cost:{cpu:1,memoryBytes:1},start:async()=>({result:Promise.resolve('x'),completed:Promise.resolve()})})
 await new Promise(r=>setImmediate(r));assert.equal(cancelSessionStart('t-cancel',41),true);await assert.rejects(cancelled,/cancelled/);await new Promise(r=>setImmediate(r))
 assert.equal(recentActivity.list(41)[0].outcome,'cancelled')
 const timeout=runAppTask<string>({id:'t-timeout',name:'超时的',cost:{cpu:1,memoryBytes:1},start:async()=>({result:Promise.resolve('x'),completed:Promise.resolve()})})
 await new Promise(r=>setImmediate(r));now=6000;m.invalidateMetrics();await assert.rejects(timeout,/wait timeout/);await new Promise(r=>setImmediate(r))
 const t=recentActivity.list(41)[0];assert.equal(t.outcome,'timeout');assert.equal(t.scope,'app','应用级任务的记录也全窗口可见')
 const sessions=createOwnedSessions(()=>now)
 let exit!:()=>void
 sessions.add({id:'pty:9',name:'终端 9',windowId:42,projectId:'p2',kind:'terminal',completed:new Promise<void>(r=>{exit=r}),stop(){}})
 exit();await new Promise(r=>setImmediate(r))
 const seen42=recentActivity.list(42)
 assert.deepEqual(seen42[0]&&[seen42[0].id,seen42[0].kind,seen42[0].outcome],['pty:9','service','exited'])
 assert.ok(seen42.some(x=>x.id==='t-timeout'&&x.scope==='app'),'应用级记录对别的窗口也可见')
 assert.ok(!seen42.some(x=>x.id==='t-done'),'窗口 41 的记录不该出现在窗口 42')
 m.dispose()
})
