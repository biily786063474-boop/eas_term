import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEnabledState, isPluginEnabled, setPluginEnabled } from './pluginEnabledState.ts'

test('默认全开：不在 disabled 里就是开着', () => {
  const s = parseEnabledState(null)
  assert.equal(isPluginEnabled('eas:board', s), true)
  assert.equal(isPluginEnabled('claude:whatever', s), true)
})

test('关掉一个：进 disabled，isEnabled 变 false，别的不受影响', () => {
  let s = parseEnabledState({ disabled: [] })
  s = setPluginEnabled(s, 'claude:mem', false)
  assert.equal(isPluginEnabled('claude:mem', s), false)
  assert.equal(isPluginEnabled('eas:board', s), true)
  assert.deepEqual(s.disabled, ['claude:mem'])
})

test('再开回来：从 disabled 移除', () => {
  let s = { disabled: ['claude:mem', 'codex:gh'] }
  s = setPluginEnabled(s, 'claude:mem', true)
  assert.equal(isPluginEnabled('claude:mem', s), true)
  assert.deepEqual(s.disabled, ['codex:gh'])
})

test('重复关不产生重复项', () => {
  let s = { disabled: ['a'] }
  s = setPluginEnabled(s, 'a', false)
  assert.deepEqual(s.disabled, ['a'])
})

test('setPluginEnabled 不改入参', () => {
  const s = { disabled: ['a'] }
  const s2 = setPluginEnabled(s, 'b', false)
  assert.deepEqual(s.disabled, ['a']) // 原状态没变
  assert.deepEqual(new Set(s2.disabled), new Set(['a', 'b']))
})

test('parse 容错：坏输入退回默认全开', () => {
  assert.deepEqual(parseEnabledState('nope'), { disabled: [] })
  assert.deepEqual(parseEnabledState({ disabled: 'x' }), { disabled: [] })
  assert.deepEqual(parseEnabledState({ disabled: ['a', 1, '', 'a', 'b'] }), { disabled: ['a', 'b'] }) // 去非串、去空、去重
})
