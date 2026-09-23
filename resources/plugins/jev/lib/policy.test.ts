import test from 'node:test'
import assert from 'node:assert/strict'
import { createPolicy } from './policy.mjs'
test('default selections are inert until connection and consent',()=>{
 const p=createPolicy()
 assert.equal(Object.values(p.snapshot().selected).filter(Boolean).length,5)
 assert.throws(()=>p.begin('triage'),/disabled/)
 assert.throws(()=>p.enable(),/connection/)
 p.setConnected(true)
 assert.throws(()=>p.begin('triage'),/disabled/)
 p.enable(); assert.equal(p.valid(p.begin('triage')),true)
})
test('bulk selection does not authorize service',()=>{
 const p=createPolicy();p.selectAll(true)
 assert.equal(Object.values(p.snapshot().selected).filter(Boolean).length,7)
 assert.throws(()=>p.begin('milestone'),/disabled/)
})
test('revocation invalidates in-flight results even after re-enable',()=>{
 const p=createPolicy();p.setConnected(true);p.enable();const ticket=p.begin('docs')
 p.pause();p.enable();assert.equal(p.valid(ticket),false)
 const second=p.begin('docs');p.select('docs',false);assert.equal(p.valid(second),false)
})
test('disconnect revokes service, selection snapshots cannot mutate state',()=>{
 const p=createPolicy();p.setConnected(true);p.enable()
 const ticket=p.begin('eval');p.setConnected(false);assert.equal(p.valid(ticket),false)
 assert.throws(()=>p.enable(),/connection/)
 p.snapshot().selected.milestone=true;assert.equal(p.snapshot().selected.milestone,false)
 assert.throws(()=>p.select('unknown',true),/Unknown/)
})
