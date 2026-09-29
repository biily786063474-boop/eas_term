import test from 'node:test'
import assert from 'node:assert/strict'
import { withChipTarget, withoutChipTarget, type ChipTargets } from './chipTargets.ts'

const f1 = (): void => {}
const f2 = (): void => {}

test('登记 / 注销：按 leafId 存，注销自己的那个就删掉', () => {
  let m: ChipTargets = {}
  m = withChipTarget(m, 'L1', f1)
  assert.equal(m.L1, f1)
  m = withoutChipTarget(m, 'L1', f1)
  assert.equal('L1' in m, false)
})

test('后挂载者不被先卸载者误删（空态输入框 → 对话态输入框交接时的顺序）', () => {
  let m: ChipTargets = {}
  m = withChipTarget(m, 'L1', f1) // 空态输入框挂载
  m = withChipTarget(m, 'L1', f2) // 对话态输入框挂载（React 可能先挂新的再卸旧的）
  const before = m
  m = withoutChipTarget(m, 'L1', f1) // 空态那个卸载
  assert.equal(m.L1, f2)
  assert.equal(m, before, '没变就返回原对象，不触发无谓的 store 更新')
})

test('不可变：不改传进来的对象；别的 leaf 不受影响', () => {
  const m0: ChipTargets = { L2: f2 }
  const m1 = withChipTarget(m0, 'L1', f1)
  assert.deepEqual(Object.keys(m0), ['L2'])
  const m2 = withoutChipTarget(m1, 'L1', f1)
  assert.equal(m2.L2, f2)
  assert.deepEqual(Object.keys(m1).sort(), ['L1', 'L2'])
})
