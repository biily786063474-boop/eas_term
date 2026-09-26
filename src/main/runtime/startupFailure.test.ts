import {ResourceWaitTimeoutError} from './scheduler.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {startupFailure} from './startupFailure.ts'
test('cancellation is not a fatal launch error; queue expiration explains no execution and no replay',()=>{
 assert.deepEqual(startupFailure(Error('cancelled')),{fatal:false,message:'已取消等待，本次消息未启动，不会自动重试。'})
 assert.match(startupFailure(new ResourceWaitTimeoutError()).message,/等待资源超时/)
 assert.equal(startupFailure(Error('spawn ENOENT')).fatal,true)
})

for(const value of [Error('spawn timeout'),Error('network timeout'),'timeout',null]) {
 test('non-queue failure remains fatal: '+String(value),()=>{
  const actual=startupFailure(value)
  assert.equal(actual.fatal,true)
  assert.doesNotMatch(actual.message,/等待资源超时/)
 })
}
