import {test} from 'node:test'
import assert from 'node:assert/strict'
import {projectAttribution} from './projectAttribution.ts'
test('display attribution uses longest directory ancestor, never a string prefix or caller project id',()=>{
 const p=[{id:'root',path:'/work'},{id:'nested',path:'/work/app'}]
 assert.equal(projectAttribution('/work/app/src',p),'nested')
 assert.equal(projectAttribution('/work/application',p),'root')
 assert.equal(projectAttribution('/worker',p),null)
 assert.equal(projectAttribution('',p),null)
})
