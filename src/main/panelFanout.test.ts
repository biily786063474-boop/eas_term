import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipients } from './panelFanout.ts'

const panels = [
  { session: 'a', pluginName: 'board' },
  { session: 'b', pluginName: 'board' },
  { session: 'c', pluginName: 'other' }
]

test('**调用者自己不收**（否则 refresh → tools/call → 广播 无限循环）', () => {
  assert.deepEqual(recipients(panels, 'board', 'a').map((p) => p.session), ['b'])
})

test('模型那边调的（没有调用者面板）→ 同插件所有面板都收', () => {
  assert.deepEqual(recipients(panels, 'board', null).map((p) => p.session), ['a', 'b'])
})

test('别的插件的面板永远不收', () => {
  assert.ok(recipients(panels, 'board', null).every((p) => p.pluginName === 'board'))
  assert.deepEqual(recipients(panels, 'nope', null), [])
})
