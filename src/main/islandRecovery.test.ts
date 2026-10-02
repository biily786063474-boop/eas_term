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
