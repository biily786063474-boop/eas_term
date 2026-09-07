import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatPluginState } from './chatPlugin.ts'
test('插件清单只报告选择与存在性，不编造连接状态', () => {
  assert.equal(chatPluginState('p', { displayName: '报告' }).status, 'selected')
  assert.equal(chatPluginState('p').status, 'missing')
})
