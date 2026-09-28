import test from 'node:test'
import assert from 'node:assert/strict'
import {approveJevDecision} from './jevDecisionConsent.ts'
test('approval binds immutable preview; cancellation and invalidated session never call',async()=>{
 const params={name:'jev_custom',arguments:{state:'original',questions:{ok:{type:'noul',instructions:'Valid?'}}}}
 const approved=await approveJevDecision(params,{valid:()=>true,confirm:async preview=>{assert.match(preview,/original/);params.arguments.state='changed';return true}})
 assert.equal(approved.arguments.state,'original')
 await assert.rejects(approveJevDecision(params,{valid:()=>true,confirm:async()=>false}),/取消/)
 let valid=true
 await assert.rejects(approveJevDecision(params,{valid:()=>valid,confirm:async()=>{valid=false;return true}}),/失效/)
})
test('unknown fields and oversized previews fail before asking permission',async()=>{
 let called=false;const deps={valid:()=>true,confirm:async()=>{called=true;return true}}
 await assert.rejects(approveJevDecision({name:'jev_custom',arguments:{state:'x'.repeat(20000),questions:{}}},deps))
 await assert.rejects(approveJevDecision({name:'jev_configure',arguments:{}},deps))
 assert.equal(called,false)
})
