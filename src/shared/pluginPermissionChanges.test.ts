import test from 'node:test'
import assert from 'node:assert/strict'
import {permissionChanges} from './pluginPermissionChanges.ts'
test('reports newly requested and removed capabilities without order noise',()=>{
 assert.deepEqual(permissionChanges(['read','write'],['network','read']),{added:['network'],removed:['write']})
 assert.deepEqual(permissionChanges(['read','write'],['write','read','read']),{added:[],removed:[]})
})
test('target-origin changes are visible even when capability names are unchanged',()=>{
 assert.deepEqual(permissionChanges(['remote:https://old.example'],['remote:https://new.example']),{added:['remote:https://new.example'],removed:['remote:https://old.example']})
})
