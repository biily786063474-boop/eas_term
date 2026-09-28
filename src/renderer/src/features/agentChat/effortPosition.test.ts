import test from 'node:test'
import assert from 'node:assert/strict'
import { effortIndex } from './effortPosition.ts'
test('continuous position maps only to bounded catalog slots',()=>{
 assert.equal(effortIndex(24,4),1)
 assert.equal(effortIndex(50,4),2)
 assert.equal(effortIndex(-2,4),0)
 assert.equal(effortIndex(120,4),4)
 assert.equal(effortIndex(NaN,4),0)
 assert.equal(effortIndex(50,0),0)
})
