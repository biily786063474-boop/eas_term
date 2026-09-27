import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createChatReducer} from './reduce.ts'
test('queued status is busy and old generation cannot erase current wait',()=>{
 const r=createChatReducer();r.push({k:'dispatch.status',queued:true,position:3,generation:2});assert.equal(r.view().busy,true)
 r.push({k:'dispatch.status',queued:false,position:null,generation:1});assert.equal(r.view().dispatch?.queued,true)
 r.push({k:'dispatch.status',queued:false,position:null,generation:2});assert.equal(r.view().busy,false)
})
