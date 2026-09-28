import test from 'node:test'
import assert from 'node:assert/strict'
import {createJevRecovery,configurationDigest} from './jevRecovery.ts'
test('only exact credential digest can restore; no secret in digest',()=>{
 assert.notEqual(configurationDigest('a'),configurationDigest('b'))
 assert.match(configurationDigest('a'),/^[a-f0-9]{64}$/)
})
test('single flight recovery cannot survive revocation while pending',async()=>{
 let finish!:()=>void,active=false,calls=0
 const manager=createJevRecovery({restore:async()=>{calls++;await new Promise<void>(r=>finish=r);active=true},stop:()=>{active=false}})
 const a=manager.recover(),b=manager.recover();assert.equal(calls,1)
 manager.revoke();finish();await Promise.all([a,b]);assert.equal(active,false)
 await manager.recover();assert.equal(calls,1)
})
