import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseModelList, toOption } from './codexModels.ts'

test('toOption：displayName 当标签，缺了退回 id', () => {
  assert.deepEqual(toOption({ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' }), { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' })
  assert.deepEqual(toOption({ id: 'x' }), { id: 'x', label: 'x' })
  assert.equal(toOption({ displayName: '没有 id' }), null)
  assert.equal(toOption(null), null)
})

test('parseModelList：真实形状（app-server model/list 的实测返回）', () => {
  const real = {
    data: [
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', defaultReasoningEffort: 'low' },
      { id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra' },
      { id: 'gpt-5.5', displayName: 'GPT-5.5' }
    ]
  }
  assert.deepEqual(parseModelList(real).map((m) => m.id), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'])
})

test('parseModelList：重复 id 去重；坏数据不抛', () => {
  assert.deepEqual(parseModelList({ data: [{ id: 'a' }, { id: 'a' }, null, 'x', { }] }).map((m) => m.id), ['a'])
  assert.deepEqual(parseModelList(undefined), [])
  assert.deepEqual(parseModelList({ data: '不是数组' }), [])
})
