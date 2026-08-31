import assert from 'node:assert/strict'
import { test } from 'node:test'

import { edgeStep, EDGE_ZONE, MAX_STEP } from './edgeScroll.ts'

// 一个 0..1000 的容器
const S = 0
const E = 1000

test('中间不滚', () => {
  assert.equal(edgeStep(500, S, E), 0)
  assert.equal(edgeStep(EDGE_ZONE + 1, S, E), 0)
  assert.equal(edgeStep(E - EDGE_ZONE - 1, S, E), 0)
})

test('越靠边越快，贴边到满速', () => {
  // 取带内偏中间的位置，别取最外沿 —— 那儿算出来是 0（不滚），比不出快慢
  const near = edgeStep(EDGE_ZONE - 20, S, E)
  const edge = edgeStep(S, S, E)
  assert.ok(near < 0 && edge < 0, '左边缘要往回滚')
  assert.ok(Math.abs(edge) > Math.abs(near), '越靠边越快')
  assert.equal(edge, -MAX_STEP, '贴边就是满速')
  assert.equal(edgeStep(E, S, E), MAX_STEP, '右边缘满速往前')
})

test('**拖出容器外也要滚** —— 手拖出界是常见动作，停下来像卡住了', () => {
  assert.equal(edgeStep(-200, S, E), -MAX_STEP)
  assert.equal(edgeStep(E + 200, S, E), MAX_STEP)
})

test('容器太窄就不滚 —— 整条都在感应带里的话没有「边缘」可言', () => {
  // 宽度 = zone*2，正好不够
  assert.equal(edgeStep(10, 0, EDGE_ZONE * 2), 0)
  assert.equal(edgeStep(0, 0, 50), 0)
  // 再宽一点就该滚了
  assert.notEqual(edgeStep(0, 0, EDGE_ZONE * 2 + 2), 0)
})

test('两边的速度对称', () => {
  // 比绝对值：`-edgeStep(...)` 在结果是 0 时会产生 -0，
  // 而 assert.equal 用的是 Object.is，-0 !== 0
  for (const d of [0, 10, 30, 55]) {
    assert.equal(
      Math.abs(edgeStep(S + d, S, E)),
      Math.abs(edgeStep(E - d, S, E)),
      `离边 ${d}px 时两边应该一样快`
    )
  }
})

test('返回整数，而且**不会是 -0** —— `-0 < 0` 是 false，会让调用方判反', () => {
  for (let p = -20; p < 80; p += 7) {
    const v = edgeStep(p, S, E)
    // 用 Number.isInteger 而不是 `% 1` —— 负数取模会给出 -0，判据本身就带坑
    assert.ok(Number.isInteger(v), `pos=${p} 返回了小数 ${v}`)
    assert.ok(!Object.is(v, -0), `pos=${p} 返回了 -0`)
  }
})
