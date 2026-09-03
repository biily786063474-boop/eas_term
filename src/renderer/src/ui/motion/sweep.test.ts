import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SWEEP, sweepAngle } from './sweep.ts'

const box = { left: 100, top: 100, width: 100, height: 100 } // 中心 (150,150)

test('用户给定的四个参数原样落在代码里', () => {
  assert.equal(SWEEP.radius, 18)
  assert.equal(SWEEP.blur, 0)
  assert.equal(SWEEP.intensity, 1)
  assert.equal(SWEEP.speed, 0.35)
})

// ── 角度：0° 在正上方、顺时针 ─────────────────────────────────────────────
//
// 这是 CSS conic-gradient 的语义，和 atan2 的「0 在正右、逆时针」差 90°。
// 混了的表现是「高光跟着鼠标转，但总差 90 度」，看着像随机跑 —— 所以逐个方向钉住。

test('鼠标在正上方 → 0°', () => {
  assert.equal(Math.round(sweepAngle(box, 150, 50)), 0)
})

test('鼠标在正右方 → 90°（顺时针）', () => {
  assert.equal(Math.round(sweepAngle(box, 250, 150)), 90)
})

test('鼠标在正下方 → 180°', () => {
  assert.equal(Math.round(sweepAngle(box, 150, 250)), 180)
})

test('鼠标在正左方 → 270°', () => {
  assert.equal(Math.round(sweepAngle(box, 50, 150)), 270)
})

test('**结果永远在 [0,360)** —— 负角度虽然 CSS 也认，但读日志时一堆负数没法对', () => {
  for (const [x, y] of [[50, 50], [250, 50], [50, 250], [250, 250], [150, 150]]) {
    const a = sweepAngle(box, x, y)
    assert.ok(a >= 0 && a < 360, `${x},${y} → ${a}`)
  }
})

test('元素在页面上被滚动/平移过也算得对（用的是 rect 不是页面坐标）', () => {
  const moved = { left: 900, top: 500, width: 100, height: 100 } // 中心 (950,550)
  assert.equal(Math.round(sweepAngle(moved, 950, 450)), 0)
})

test('**两道高光正对角**（用户：对角去进行高光的设计）', () => {
  assert.equal(SWEEP.gapDeg, 180)
})
