import {test} from 'node:test'
import assert from 'node:assert/strict'
import {projectServiceOwners} from './serviceProjection.ts'
test('共享面板归属去重，未知shim不伪造项目',()=>{
 assert.deepEqual(projectServiceOwners(['panel:a','panel:b','shim:c'],new Map([['panel:a','p'],['panel:b','p']])),{projectIds:['p'],unknownRefs:1})
})
test('没有已知项目的ref保持未知',()=>{
 assert.deepEqual(projectServiceOwners(['panel:a'],new Map()),{projectIds:[],unknownRefs:1})
})
test('停止范围要求所有ref都属于当前窗口，未知或其他窗口拒绝',async()=>{
 const {canStopHostRefs}=await import('./serviceProjection.ts')
 assert.equal(canStopHostRefs(['panel:a'],new Map([['panel:a',7]]),7),true)
 assert.equal(canStopHostRefs(['panel:a','shim:x'],new Map([['panel:a',7]]),7),false)
 assert.equal(canStopHostRefs(['panel:a'],new Map([['panel:a',8]]),7),false)
 assert.equal(canStopHostRefs([],new Map(),7),true)
})
