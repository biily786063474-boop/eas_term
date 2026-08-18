import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameIdOfSelKey, soleFrameIdOfSel } from './selKey.ts'

test('Frame 本身与 Frame 内节点都能定位到 Frame', () => {
  assert.equal(frameIdOfSelKey('f:F1'), 'F1')
  assert.equal(frameIdOfSelKey('n:F1:N2'), 'F1')
})

test('自由节点和图形不属于任何 Frame', () => {
  assert.equal(frameIdOfSelKey('p:N1'), null)
  assert.equal(frameIdOfSelKey('s:S1'), null)
  assert.equal(frameIdOfSelKey('怪东西'), null)
  assert.equal(frameIdOfSelKey(''), null)
})

test('nodeId 里带冒号也只切第一个', () => {
  assert.equal(frameIdOfSelKey('n:F1:a:b:c'), 'F1')
})

test('选 Frame 里的一个节点算在这个 Frame 里', () => {
  assert.equal(soleFrameIdOfSel(['n:F1:N2']), 'F1')
})

// 框选一个 Frame 里的三个终端，人眼看就是「在这个项目里」
test('同一个 Frame 内多选仍然算这个 Frame', () => {
  assert.equal(soleFrameIdOfSel(['n:F1:N1', 'n:F1:N2', 'f:F1']), 'F1')
})

test('跨 Frame 多选说不清算哪个项目', () => {
  assert.equal(soleFrameIdOfSel(['n:F1:N1', 'n:F2:N2']), null)
})

test('混进 Frame 外的东西就不算', () => {
  assert.equal(soleFrameIdOfSel(['n:F1:N1', 'p:free']), null)
  assert.equal(soleFrameIdOfSel(['s:S1']), null)
})

test('什么都没选返回 null', () => {
  assert.equal(soleFrameIdOfSel([]), null)
})
