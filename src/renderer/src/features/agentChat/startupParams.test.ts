import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startupParams } from './startupParams.ts'

test('未选择时保留角色默认，不填造 CLI 默认模型', () => {
  assert.deepEqual(startupParams(undefined), {})
  assert.deepEqual(startupParams(undefined, 'role-model', 'high'), {model:'role-model',effort:'high'})
})
test('首轮显式选择优先，换模型不能继承旧角色强度', () => {
  assert.deepEqual(startupParams({model:'chosen',effort:''}, 'role-model', 'high'), {model:'chosen'})
  assert.deepEqual(startupParams({model:'chosen',effort:'low'}, 'role-model', 'high'), {model:'chosen',effort:'low'})
})
