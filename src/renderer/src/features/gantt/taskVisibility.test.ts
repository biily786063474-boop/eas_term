import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleTasks, taskDisplayEnd } from './taskVisibility.ts'
test('aborted history is hidden by default without mutating records', () => {
 const tasks = [{startAt:1,endAt:null,aborted:true},{startAt:2,endAt:null},{startAt:3,endAt:5}]
 assert.deepEqual(visibleTasks(tasks),tasks.slice(1))
 assert.deepEqual(visibleTasks(tasks,true),tasks)
 assert.equal(tasks.length,3)
})
test('unknown aborted end never stretches to now; live tasks still do', () => {
 assert.equal(taskDisplayEnd({startAt:1,endAt:null,aborted:true},100),1)
 assert.equal(taskDisplayEnd({startAt:1,endAt:null},100),100)
 assert.equal(taskDisplayEnd({startAt:1,endAt:5,aborted:true},100),5)
})
