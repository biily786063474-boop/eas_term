import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runtimeCounts} from './runtimeCounts.ts'
test('header counts services and waiting starts without double counting running tool calls',()=>{
 assert.deepEqual(runtimeCounts(null),{services:null,waiting:null})
 assert.deepEqual(runtimeCounts({services:[{state:'running'},{state:'stopping'}],tasks:[{state:'queued'},{state:'running'},{state:'cancel-requested'}]}),{services:2,waiting:1})
})
