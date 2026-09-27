import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRecoveryRegistry} from './recoveryRegistry.ts'

test('unknown required modules and duplicate registrations fail closed',async()=>{
 const r=createRecoveryRegistry();assert.equal(await r.prepare(['canvas']),null)
 r.register('canvas',{flush:async()=>true,ready:()=>true})
 assert.throws(()=>r.register('canvas',{flush:async()=>true,ready:()=>true}))
 assert.notEqual(await r.prepare(['canvas']),null)
})
test('every registered participant must save and acknowledge readiness',async()=>{
 for(const mode of ['dirty','failed','throws']){
  const r=createRecoveryRegistry();r.register('canvas',{ready:()=>mode!=='dirty',flush:async()=>{if(mode==='throws')throw Error('disk');return mode!=='failed'}})
  assert.equal(await r.prepare(['canvas']),null)
 }
})
test('activity or participant changes while saving invalidate checkpoint',async()=>{
 for(const change of ['edit','unmount','mount']){
  const r=createRecoveryRegistry();let resolve!:(v:boolean)=>void
  const remove=r.register('canvas',{ready:()=>true,flush:()=>new Promise<boolean>(yes=>{resolve=yes})})
  const pending=r.prepare(['canvas']);await Promise.resolve()
  if(change==='edit')r.changed();else if(change==='unmount')remove();else r.register('draft',{ready:()=>true,flush:async()=>true})
  resolve(true);assert.equal(await pending,null)
 }
})
test('checkpoint belongs to registry and is invalidated by edits or readiness changes',async()=>{
 const r=createRecoveryRegistry();let ready=true
 r.register('canvas',{ready:()=>ready,flush:async()=>true})
 const token=await r.prepare(['canvas']);assert.ok(token);assert.equal(r.current(token),true)
 assert.equal(createRecoveryRegistry().current(token),false)
 ready=false;assert.equal(r.current(token),false);ready=true;r.changed();assert.equal(r.current(token),false)
})
test('timeout and overlapping prepare fail closed; late completion cannot validate',async()=>{
 const r=createRecoveryRegistry();let resolve!:(v:boolean)=>void
 r.register('canvas',{ready:()=>true,flush:()=>new Promise<boolean>(yes=>{resolve=yes})})
 const pending=r.prepare(['canvas'],5);assert.equal(await r.prepare(['canvas']),null)
 assert.equal(await pending,null);resolve(true)
})
