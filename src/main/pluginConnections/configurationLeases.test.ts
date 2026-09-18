import {test} from 'node:test'
import assert from 'node:assert/strict'
import {CredentialLeases} from './credentialLease.ts'
import {ConfigurationLeases} from './configurationLeases.ts'
test('clearing one plugin revokes pending writes and runtime leases, but not other plugins or future authorization',()=>{
 const vault=new CredentialLeases(()=>true),scopes=new ConfigurationLeases()
 const pending=scopes.bind('one',vault.acquire()),runtime=scopes.bind('one',vault.acquire()),other=scopes.bind('two',vault.acquire())
 scopes.invalidate('one');assert.equal(runtime.signal.aborted,true);assert.throws(()=>pending.assertActive());other.assertActive()
 const next=scopes.bind('one',vault.acquire());next.assertActive();pending.dispose();runtime.dispose();next.assertActive()
 vault.invalidate();assert.equal(next.signal.aborted,true);assert.throws(()=>other.assertActive());next.dispose();other.dispose()
})
