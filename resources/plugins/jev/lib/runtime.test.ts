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
test('intent survives process recreation but cannot call until trusted connection',async()=>{
 let saved
 const preferences={load:()=>saved,save:v=>{saved=structuredClone(v)}}
 const first=createRuntime({preferences,evaluate:async()=>({})});first.connect('fixture');first.enable();first.disconnect()
 const next=createRuntime({preferences,evaluate:async()=>({})})
 assert.equal(next.snapshot().enabledIntent,true)
 assert.equal(next.snapshot().enabled,false)
 await assert.rejects(next.ask('triage',{}),/disabled/)
 next.connect('fixture');assert.equal(next.snapshot().enabled,true)
 next.pause();const last=createRuntime({preferences});last.connect('fixture')
 assert.equal(last.snapshot().enabled,false)
 assert.equal(last.snapshot().enabledIntent,false)
})
test('failed enable save does not grant permission and failed pause save still revokes',()=>{
 let fail=false
 const r=createRuntime({preferences:{load:()=>undefined,save:()=>{if(fail)throw Error('disk full')}}})
 r.connect('fixture');fail=true;assert.throws(()=>r.enable(),/disk full/);assert.equal(r.snapshot().enabled,false)
 fail=false;r.enable();fail=true;assert.throws(()=>r.pause(),/disk full/);assert.equal(r.snapshot().enabled,false)
})
test('authentication failures stop current and future business calls while network errors retain saved intent',async()=>{
 for(const message of ['Jev authentication failed','Jev network request failed']){
  let saved
  const runtime=createRuntime({preferences:{load:()=>saved,save:v=>saved=v},evaluate:async()=>{throw Error(message)}})
  runtime.connect('fixture');runtime.enable();await assert.rejects(runtime.ask('custom',{}))
  assert.equal(runtime.snapshot().connectionIssue,message)
  assert.equal(runtime.snapshot().enabledIntent,message!=='Jev authentication failed')
 }
})
test('authorizing one recipe cannot widen another recipe project scope',()=>{
 let saved
 const r=createRuntime({preferences:{load:()=>saved,save:v=>saved=structuredClone(v)}})
 r.connect('fixture');r.authorizeProjects(['a'],'milestone');r.authorizeProjects(['b'],'project')
 assert.deepEqual(r.snapshot().automationScopes,{milestone:['a'],project:['b']})
 const restored=createRuntime({preferences:{load:()=>saved,save:()=>{}}})
 assert.deepEqual(restored.snapshot().automationScopes,{milestone:['a'],project:['b']})
})
