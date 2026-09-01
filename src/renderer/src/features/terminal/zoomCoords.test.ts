import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleOf, unscaleClient, isUnscaled } from './zoomCoords.ts'

test('从 rect 与 offsetWidth 反推缩放比', () => {
  assert.equal(scaleOf(527, 405), 527 / 405)
  assert.equal(scaleOf(400, 400), 1)
})

test('**元素还没布局好时当作没缩放** —— 别拿 0 去做除数', () => {
  assert.equal(scaleOf(100, 0), 1)
  assert.equal(scaleOf(0, 0), 1)
  assert.equal(scaleOf(NaN, 400), 1)
})

test('量到荒谬的值也退回 1（宁可不校正，也不要把坐标扔到天外）', () => {
  assert.equal(scaleOf(-50, 400), 1)
  assert.equal(scaleOf(400000, 400), 1)
})

test('校正：把屏幕坐标还原成未缩放坐标系里的位置', () => {
  // 元素左边缘在屏幕 100px，缩放 1.3，鼠标点在屏幕 230px
  // 元素内偏移 130 屏幕像素 = 100 逻辑像素 → 还原后应是 100 + 100 = 200
  assert.equal(unscaleClient(230, 100, 1.3), 200)
})

test('缩放为 1 时原样返回（不引入浮点误差）', () => {
  assert.equal(unscaleClient(230, 100, 1), 230)
})

test('缩小的情况同样成立', () => {
  // 缩放 0.5：屏幕内偏移 50 → 逻辑偏移 100
  assert.equal(unscaleClient(150, 100, 0.5), 200)
})

test('**边缘点不动** —— 左边缘校正后还是左边缘', () => {
  assert.equal(unscaleClient(100, 100, 1.3), 100)
})

test('近似 1 就算没缩放', () => {
  assert.equal(isUnscaled(1), true)
  assert.equal(isUnscaled(1.0005), true)
  assert.equal(isUnscaled(1.3), false)
})
