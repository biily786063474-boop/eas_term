import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from './runtime.mjs'
test('runtime revokes pending response and aborts transport',async()=>{
 let resolve,signal
 const r=createRuntime({evaluate:(_request,options)=>{signal=options.signal;return new Promise(done=>resolve=done)}})
 r.connect('fixture');r.enable()
 const call=r.ask('triage',{})
 r.pause();assert.equal(signal.aborted,true);resolve({answers:{}})
 await assert.rejects(call,/revoked/)
})
test('parallel limit prevents additional network call; disabled blocks',async()=>{
 let count=0,resolve
 const r=createRuntime({evaluate:()=>{count++;return new Promise(done=>resolve=done)},maxConcurrent:1})
 r.connect('fixture');r.enable()
 const first=r.ask('docs',{});await assert.rejects(r.ask('docs',{}),/limit/);assert.equal(count,1)
 resolve({});await first;r.disconnect();await assert.rejects(r.ask('docs',{}),/disabled/)
})
