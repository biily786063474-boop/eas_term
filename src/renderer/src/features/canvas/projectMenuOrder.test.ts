import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderProjectMenu } from './projectMenuOrder.ts'
const projects = ['idle', 'runA', 'approval', 'runB', 'done'].map(id => ({ id }))
const running = new Set(['runA', 'runB'])
test('running first in default, preserves insertion order inside groups', () => {
  assert.deepEqual(orderProjectMenu(projects, 'default', ['done', 'runB'], running).map(p => p.id), ['runA', 'runB', 'idle', 'approval', 'done'])
  assert.equal(projects[0].id, 'idle')
})
test('recent order applies independently inside both groups', () => {
  assert.deepEqual(orderProjectMenu(projects, 'recent', ['done', 'runB', 'idle'], running).map(p => p.id), ['runB', 'runA', 'done', 'idle', 'approval'])
})
test('stopped and newly running projects move groups without stored priority', () => {
  assert.deepEqual(orderProjectMenu(projects, 'recent', [], new Set(['idle'])).map(p => p.id), projects.map(p => p.id))
  assert.deepEqual(orderProjectMenu(projects, 'default', [], new Set()), projects)
})
test('non-running recent projects remain MRU ordered and ties remain stable', () => {
 const items = [{id:'old'}, {id:'new'}, {id:'unknown'}]
 assert.deepEqual(orderProjectMenu(items, 'recent', ['new','old'], new Set()).map(p=>p.id), ['new','old','unknown'])
 assert.deepEqual(orderProjectMenu(items, 'recent', ['old','new'], new Set()).map(p=>p.id), ['old','new','unknown'])
 assert.deepEqual(orderProjectMenu(items, 'recent', [], new Set()), items)
})
