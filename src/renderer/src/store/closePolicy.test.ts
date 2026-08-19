import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldStopSessionOnClose } from './closePolicy.ts'

test('用户自己开的 agent 节点：关掉就停（既有行为，不能退化）', () => {
  assert.equal(shouldStopSessionOnClose({ kind: 'agent', sessionId: 's1' }), true)
})

test('团队派生的：关节点只是收起视图，进程继续跑', () => {
  assert.equal(shouldStopSessionOnClose({ kind: 'agent', sessionId: 's1', owner: 'team' }), false)
})

test('没有 sessionId → 没东西可停（会话还没建立起来）', () => {
  assert.equal(shouldStopSessionOnClose({ kind: 'agent' }), false)
  assert.equal(shouldStopSessionOnClose({ kind: 'agent', owner: 'team' }), false)
})

test('不是 agent 的 pane 一律 false（终端走它自己那条路）', () => {
  assert.equal(shouldStopSessionOnClose({ kind: 'terminal', sessionId: 's1' }), false)
  assert.equal(shouldStopSessionOnClose({ kind: 'code' }), false)
})
