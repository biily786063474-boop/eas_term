import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createStopGate} from './stopGate.ts'
test('one confirmation per service, released after success and rejection',async()=>{
 const gate=createStopGate();let release!:()=>void,calls=0
 const first=gate('host',async()=>{calls++;await new Promise<void>(r=>release=r);return {ok:true}})
 assert.deepEqual(await gate('host',async()=>{calls++;return {ok:true}}),{ok:false,reason:'该服务已有关闭确认，请先处理当前弹窗'})
 assert.equal(calls,1);release();assert.deepEqual(await first,{ok:true})
 await assert.rejects(gate('host',async()=>{throw Error('dialog failed')}))
 assert.deepEqual(await gate('host',async()=>({ok:true})),{ok:true})
})
test('independent services do not block each other',async()=>{
 const gate=createStopGate();let release!:()=>void
 const first=gate('a',async()=>{await new Promise<void>(r=>release=r);return {ok:true}})
 assert.deepEqual(await gate('b',async()=>({ok:true})),{ok:true});release();await first
})
