import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewlineKey, isSendKey, shouldPreventDefault, SEND_HINT } from './sendKey.ts'

// 2026-10-02 用户要的：回车发送，Ctrl / Shift + 回车换行
test('裸 Enter 发送，并挡掉默认行为（不然发完留一个空行）', () => {
  assert.equal(isSendKey({ key: 'Enter' }), true)
  assert.equal(shouldPreventDefault({ key: 'Enter' }), true)
  assert.equal(isNewlineKey({ key: 'Enter' }), false)
})

test('⌘+Enter 仍然发送（用过旧规则的 mac 用户按它是想发）', () => {
  assert.equal(isSendKey({ key: 'Enter', metaKey: true }), true)
  assert.equal(isNewlineKey({ key: 'Enter', metaKey: true }), false)
})

test('Ctrl / Shift / Alt + Enter 是换行，不发送', () => {
  for (const mod of ['ctrlKey', 'shiftKey', 'altKey'] as const) {
    assert.equal(isSendKey({ key: 'Enter', [mod]: true }), false, mod)
    assert.equal(isNewlineKey({ key: 'Enter', [mod]: true }), true, mod)
    assert.equal(shouldPreventDefault({ key: 'Enter', [mod]: true }), false, mod)
  }
})

// 中文用户最常撞的一类 bug：打「你好」按回车确认候选词，消息被发出去了。回车直接发送之后这道闸更要紧
test('输入法组合中既不发送也不换行 —— isComposing 与 keyCode 229 两道闸', () => {
  for (const c of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.equal(isSendKey({ key: 'Enter', ...c }), false)
    assert.equal(isNewlineKey({ key: 'Enter', shiftKey: true, ...c }), false)
    assert.equal(isNewlineKey({ key: 'Enter', ctrlKey: true, ...c }), false)
  }
})

test('别的键一律不发送也不换行', () => {
  for (const k of ['a', 'Escape', 'Tab', 'ArrowUp', ' ']) {
    assert.equal(isSendKey({ key: k }), false, k)
    assert.equal(isNewlineKey({ key: k, shiftKey: true }), false, k)
  }
})

test('提示语里说清发送键和换行键', () => {
  assert.ok(SEND_HINT.startsWith('Enter 发送'))
  assert.ok(SEND_HINT.includes('Shift') && SEND_HINT.includes('Ctrl') && SEND_HINT.includes('换行'))
})
