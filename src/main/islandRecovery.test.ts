import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as recovery from './islandRecovery.ts'
test('native crash schedules reconciliation without another renderer event',t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 let calls=0
 const retry=recovery.createIslandRecovery(()=>calls++)
 retry.schedule();retry.schedule()
 t.mock.timers.tick(2999);assert.equal(calls,0)
 t.mock.timers.tick(1);assert.equal(calls,1)
 t.mock.timers.tick(3000);assert.equal(calls,1)
})
test('teardown cancels pending recovery; a later explicit lifecycle may schedule again',t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 let calls=0;const retry=recovery.createIslandRecovery(()=>calls++)
 retry.schedule();retry.cancel();t.mock.timers.tick(3000);assert.equal(calls,0)
 retry.schedule();t.mock.timers.tick(3000);assert.equal(calls,1)
})
test('宿主从没 ready：第二次起不来就退回 Electron 岛，不再白等五轮',()=>{
 let c={failures:0,unready:0}
 let r=recovery.recordNativeFailure(c,0,1000);assert.equal(r.fallback,false);c=r.count
 r=recovery.recordNativeFailure(c,0,12000);assert.equal(r.fallback,true)
})
test('ready 之后崩：连续 5 次才退回；稳定跑过 30s 清零；ready 过的实例清掉起不来计数',()=>{
 let c={failures:0,unready:0},r
 r=recovery.recordNativeFailure(c,0,0);c=r.count // 起不来一次
 for(let i=1;i<=3;i++){r=recovery.recordNativeFailure(c,1000*i,1000*i+500);assert.equal(r.fallback,false,'第 '+(i+1)+' 次');c=r.count}
 assert.equal(c.unready,0)
 r=recovery.recordNativeFailure(c,9000,9500);assert.equal(r.fallback,true)
 // 健康运行 30s 后的一次崩溃从头数
 r=recovery.recordNativeFailure({failures:4,unready:1},1000,1000+30_001);assert.deepEqual(r.count,{failures:1,unready:0});assert.equal(r.fallback,false)
})
