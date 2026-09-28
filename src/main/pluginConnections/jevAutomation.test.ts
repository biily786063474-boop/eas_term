import test from 'node:test'
import assert from 'node:assert/strict'
import {withJevAutomation} from './jevAutomation.ts'
test('event acquires without open panel and releases even when run fails',async()=>{
 const events:string[]=[]
 await assert.rejects(withJevAutomation({acquire:async()=>{events.push('acquire');return 'host'},release:()=>{events.push('release')},run:async h=>{assert.equal(h,'host');throw Error('offline')}}))
 assert.deepEqual(events,['acquire','release'])
})
