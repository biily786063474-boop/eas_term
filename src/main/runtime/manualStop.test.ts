import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createManualStopLatch} from './manualStop.ts'
test('manual stop survives consumer remount; only matching explicit resume clears it',()=>{
 const l=createManualStopLatch();assert.equal(l.stamp('p'),null)
 const first=l.stop('p');assert.equal(l.stamp('p'),first)
 assert.equal(l.resume('p',first+1),false);assert.equal(l.stamp('p'),first)
 assert.equal(l.resume('p',first),true);assert.equal(l.stamp('p'),null)
})
test('new stop invalidates pending resume confirmation; other plugins unaffected',()=>{
 const l=createManualStopLatch(),old=l.stop('p');l.stop('p')
 assert.equal(l.resume('p',old),false);assert.equal(l.stamp('q'),null)
})
test('persisted stop loads on new lifetime; write failure does not clear a stop',()=>{
 let disk:string[]=[];const save=(keys:string[])=>{disk=keys}
 const a=createManualStopLatch({load:()=>disk,save});a.stop('p')
 const b=createManualStopLatch({load:()=>disk,save:()=>{throw Error('disk failed')}})
 const stamp=b.stamp('p')!;assert.notEqual(stamp,null)
 assert.throws(()=>b.resume('p',stamp),/disk failed/);assert.equal(b.stamp('p'),stamp)
})
