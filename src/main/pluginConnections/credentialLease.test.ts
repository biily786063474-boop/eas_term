import {test} from 'node:test'
import assert from 'node:assert/strict'
import {CredentialLeases} from './credentialLease.ts'
test('lock and re-unlock cannot revive an earlier credential lease',()=>{
 let unlocked=true
 const leases=new CredentialLeases(()=>unlocked)
 const old=leases.acquire();old.assertActive()
 unlocked=false;leases.invalidate()
 assert.equal(old.signal.aborted,true)
 unlocked=true
 assert.throws(()=>old.assertActive())
 const current=leases.acquire();current.assertActive();current.dispose()
 assert.throws(()=>current.assertActive())
})
test('expiry is checked synchronously even before timer notification',()=>{
 let unlocked=true
 const leases=new CredentialLeases(()=>unlocked),lease=leases.acquire()
 unlocked=false
 assert.throws(()=>lease.assertActive());assert.equal(lease.signal.aborted,true)
 assert.throws(()=>leases.acquire())
})
