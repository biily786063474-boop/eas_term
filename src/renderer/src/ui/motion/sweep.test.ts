import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SWEEP } from './sweep.ts'


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

test('**两道高光正对角**（用户：对角去进行高光的设计）', () => {
  assert.equal(SWEEP.gapDeg, 180)
})
