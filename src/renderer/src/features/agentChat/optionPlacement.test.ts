import {test} from 'node:test'
import assert from 'node:assert/strict'
import {optionPlacement} from './optionPlacement.ts'
test('late assistant segments move options down but never across user turns',()=>{
 assert.deepEqual(optionPlacement([{role:'user'},{role:'assistant'},{role:'assistant'},{role:'user'},{role:'assistant'}]),[[],[],[1,2],[],[4]])
})
test('compaction separates historical reply groups',()=>{
 assert.deepEqual(optionPlacement([{role:'assistant'},{role:'assistant',compact:{}},{role:'assistant'}]),[[0],[],[2]])
})
