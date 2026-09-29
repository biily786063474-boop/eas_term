import test from 'node:test'
import assert from 'node:assert/strict'
import { registerInputFocus, focusInputOf } from './inputFocusTargets.ts'

test('按 leafId 登记输入聚焦；没登记 → false；注销后 → false', () => {
  assert.equal(focusInputOf('nope'), false)
  let n = 0
  const off = registerInputFocus('L1', () => { n++ })
  assert.equal(focusInputOf('L1'), true)
  assert.equal(n, 1)
  off()
  assert.equal(focusInputOf('L1'), false)
  assert.equal(n, 1)
})

test('后登记者不被先登记者的注销误删（空态输入框 → 对话态输入框交接，同 chipTargets）', () => {
  const hit: string[] = []
  const offA = registerInputFocus('L2', () => { hit.push('A') })
  const offB = registerInputFocus('L2', () => { hit.push('B') })
  offA()
  assert.equal(focusInputOf('L2'), true)
  assert.deepEqual(hit, ['B'])
  offB()
  assert.equal(focusInputOf('L2'), false)
})

test('聚焦函数抛错（组件已销毁）→ false，不往外抛', () => {
  const off = registerInputFocus('L3', () => { throw new Error('destroyed') })
  assert.equal(focusInputOf('L3'), false)
  off()
})
