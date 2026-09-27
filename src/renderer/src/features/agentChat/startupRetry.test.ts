import test from 'node:test'
import assert from 'node:assert/strict'
import { canSubmitStartup } from './startupPhase.ts'
test('failed startup is manually retryable; setup/loading are not',()=>{
 for(const k of ['ready','failed']) assert.equal(canSubmitStartup(k),true)
 for(const k of ['detecting','none','setup','starting']) assert.equal(canSubmitStartup(k),false)
})
