import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSendKey, shouldPreventDefault, SEND_HINT } from './sendKey.ts'

test('Ctrl+Enter 和 Cmd+Enter 都发送', () => {
  assert.equal(isSendKey({ key: 'Enter', ctrlKey: true }), true)
  assert.equal(isSendKey({ key: 'Enter', metaKey: true }), true)
})

test('裸 Enter 不发送，留给换行', () => {
  assert.equal(isSendKey({ key: 'Enter' }), false)
  assert.equal(shouldPreventDefault({ key: 'Enter' }), false, '不挡默认行为，否则换不了行')
})

// 中文用户最常撞的一类 bug：打「你好」按回车确认候选词，消息被发出去了
test('输入法组合中一律不发送 —— 哪怕带着 Ctrl', () => {
  assert.equal(isSendKey({ key: 'Enter', isComposing: true }), false)
  assert.equal(isSendKey({ key: 'Enter', ctrlKey: true, isComposing: true }), false)
})

test('Shift+Enter 不发送（历史上的换行键，继续换行）', () => {
  assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false)
})

test('别的键一律不发送', () => {
  for (const k of ['a', 'Escape', 'Tab', 'ArrowUp', ' ']) {
    assert.equal(isSendKey({ key: k, ctrlKey: true }), false, k)
  }
})

// 发送时不挡的话，发完输入框里会留一个空行
test('发送时要挡默认行为', () => {
  assert.equal(shouldPreventDefault({ key: 'Enter', ctrlKey: true }), true)
})

test('提示语里同时提到两个键和换行', () => {
  assert.ok(SEND_HINT.includes('Enter'))
  assert.ok(SEND_HINT.includes('换行'))
})
