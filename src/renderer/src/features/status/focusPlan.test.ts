import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFocus } from './focusPlan.ts'

// 用户报的那个问题：终端模式下点完成提示被拽到画板
test('分屏模式下一律不切模式，哪怕这个终端在画布上也有节点', () => {
  assert.deepEqual(planFocus('split', true), { switchTo: null, target: 'split' })
  assert.deepEqual(planFocus('split', false), { switchTo: null, target: 'split' })
})

test('画布模式下终端在画布上 → 不切，就地聚焦', () => {
  assert.deepEqual(planFocus('canvas', true), { switchTo: null, target: 'canvas' })
})

// 不能一律不切：那会变成「点了通知什么都没发生」
test('画布模式但这个终端只在分屏里 → 必须切到分屏', () => {
  assert.deepEqual(planFocus('canvas', false), { switchTo: 'split', target: 'split' })
})

// 看板的卡片是项目摘要，上面不放终端，留在原地等于没反应
test('看板模式一定要切走，两种情况各自去该去的地方', () => {
  assert.deepEqual(planFocus('board', true), { switchTo: 'canvas', target: 'canvas' })
  assert.deepEqual(planFocus('board', false), { switchTo: 'split', target: 'split' })
})

test('落点与是否切模式是两件事，never 出现「切到画布却按分屏落点」', () => {
  for (const m of ['split', 'canvas', 'board'] as const) {
    for (const on of [true, false]) {
      const p = planFocus(m, on)
      if (p.switchTo) assert.equal(p.switchTo, p.target, `${m}/${on}`)
    }
  }
})
