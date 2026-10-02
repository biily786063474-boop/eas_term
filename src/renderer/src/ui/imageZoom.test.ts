import test from 'node:test'
import assert from 'node:assert/strict'
import { clampPan, clampScale, fitScale, MAX_SCALE, wheelFactor, zoomAt } from './imageZoom.ts'

test('适应窗口：大图缩进可用区域，小图保持 1:1 不放大', () => {
  assert.equal(fitScale(2400, 1600, 1148, 670), (670 - 96) / 1600)
  assert.equal(fitScale(300, 200, 1148, 670), 1)
  assert.equal(fitScale(0, 0, 1148, 670), 1)
})

test('缩放上下限：最小为适应比例的一半，最大 8 倍', () => {
  assert.equal(clampScale(0.01, 0.4), 0.2)
  assert.equal(clampScale(50, 0.4), MAX_SCALE)
  assert.equal(clampScale(1, 0.4), 1)
})

test('以光标为中心缩放：光标下那一点缩放前后在屏幕上不动', () => {
  const v = { s: 0.5, x: 10, y: -20 }, px = 200, py = 120
  const u = [(px - v.x) / v.s, (py - v.y) / v.s]
  const w = zoomAt(v, 2, px, py)
  assert.equal(w.s, 2)
  assert.deepEqual([w.x + u[0] * w.s, w.y + u[1] * w.s], [px, py])
})

test('拖动范围：可以自由拖，但每个方向至少留 80px 在窗口里', () => {
  // 图 2400 宽、窗口 1000：中心最多偏 (2400+1000)/2-80 = 1620，此时图的左边缘在窗口右边往里 80px
  assert.deepEqual(clampPan({ s: 1, x: 5000, y: 5000 }, 2400, 400, 1000, 600), { s: 1, x: 1620, y: 420 })
  assert.deepEqual(clampPan({ s: 1, x: -5000, y: 0 }, 2400, 400, 1000, 600), { s: 1, x: -1620, y: 0 })
  // 范围内不动
  assert.deepEqual(clampPan({ s: 1, x: 300, y: -100 }, 2400, 400, 1000, 600), { s: 1, x: 300, y: -100 })
})

test('滚轮：向上放大、向下缩小，捏合更灵敏，单次幅度有上限', () => {
  assert.ok(wheelFactor(-100, false) > 1 && wheelFactor(100, false) < 1)
  assert.ok(wheelFactor(-10, true) > wheelFactor(-10, false))
  assert.equal(wheelFactor(-10000, false), wheelFactor(-300, false))
})
