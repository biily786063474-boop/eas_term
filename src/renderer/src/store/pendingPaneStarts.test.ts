import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPendingPaneStarts} from './pendingPaneStarts.ts'
test('source close cancels all its requests once without touching another pane',async()=>{
 const p=createPendingPaneStarts();let a!:(e:Error)=>void,b!:(e:Error)=>void,cancelled=0
 const first=p.run('a',()=>new Promise((_,r)=>a=r),()=>{cancelled++;a(Error('cancelled'))})
 const second=p.run('b',()=>new Promise((_,r)=>b=r),()=>b(Error('cancelled')))
 p.cancel('a');p.cancel('a');assert.equal(await first,null);assert.equal(cancelled,1)
 b(Error('real failure'));await assert.rejects(second,/real failure/)
})
test('late success remains available for caller identity check and exact cleanup',async()=>{
 const p=createPendingPaneStarts();let resolve!:(v:string)=>void
 const result=p.run('a',()=>new Promise<string>(r=>resolve=r),()=>{})
 p.cancel('a');resolve('actual-process');assert.equal(await result,'actual-process')
})
