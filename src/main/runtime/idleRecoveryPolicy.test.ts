import test from 'node:test'
import assert from 'node:assert/strict'
import { createIdleRecoveryPolicy } from './idleRecoveryPolicy.ts'
const minute=60_000
const idle=(at:number)=>({at,background:true,knownIdle:true,enabled:true,generation:0})
test('requires continuous one-hour observations, triggers once until activity',()=>{
 const p=createIdleRecoveryPolicy()
 for(let m=0;m<60;m++)assert.equal(p.observe(idle(m*minute)),false)
 assert.equal(p.observe(idle(60*minute)),true)
 assert.equal(p.observe(idle(61*minute)),false)
 p.observe({...idle(62*minute),knownIdle:false})
 for(let m=63;m<123;m++)assert.equal(p.observe(idle(m*minute)),false)
 assert.equal(p.observe(idle(123*minute)),true)
})
test('foreground, queued/unknown work, disabled and suspend gaps restart the clock',()=>{
 for(const change of [{background:false},{knownIdle:false},{enabled:false}]){
  const p=createIdleRecoveryPolicy()
  for(let m=0;m<60;m++)p.observe(idle(m*minute))
  assert.equal(p.observe({...idle(60*minute),...change}),false)
  assert.equal(p.observe(idle(61*minute)),false)
 }
 const p=createIdleRecoveryPolicy();p.observe(idle(0))
 assert.equal(p.observe(idle(3600000)),false,'wake after a long sampling gap is not proven idle')
 assert.equal(p.observe(idle(Number.NaN)),false)
 assert.equal(p.observe(idle(-1)),false)
})
test('activity generation catches work starting and ending between polls',()=>{
 const p=createIdleRecoveryPolicy()
 for(let m=0;m<60;m++)p.observe({...idle(m*minute),generation:0})
 assert.equal(p.observe({...idle(60*minute),generation:2}),false)
 assert.equal(p.observe({...idle(61*minute),generation:2}),false)
})
