import {test} from 'node:test'
import assert from 'node:assert/strict'
import {resolveStopNotice} from './runtimeStopNotice.ts'
test('等待停止的实例仍存在时不能宣称关闭，消失后更新提示',()=>{
 const notice={id:'instance:1',message:'已请求关闭，等待进程退出'}
 assert.equal(resolveStopNotice(notice,undefined),notice)
 assert.equal(resolveStopNotice(notice,[{id:'instance:1'}]),notice)
 assert.deepEqual(resolveStopNotice(notice,[]),{id:null,message:'服务已关闭'})
 assert.deepEqual(resolveStopNotice(notice,[{id:'instance:2'}]),{id:null,message:'服务已关闭'})
})
test('取消或失败消息不被轮询覆盖',()=>{
 const notice={id:null,message:'已取消'}
 assert.equal(resolveStopNotice(notice,[]),notice)
})
