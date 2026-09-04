import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertPointInFrame } from './dropPoint.ts'

const RECT = { left: 100, top: 50 }

test('scale=1、无平移：落点相对 Frame，且水平居中', () => {
  const p = insertPointInFrame({ x: 400, y: 250 }, RECT, { x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 200)
  // 世界坐标 (300,200)；宽 200 → 左上角 x = 300-100 = 200
  assert.equal(p.px, 200)
  assert.equal(p.py, 200 - 14)
})

test('减去 Frame 的世界坐标', () => {
  const p = insertPointInFrame({ x: 400, y: 250 }, RECT, { x: 0, y: 0, scale: 1 }, { x: 120, y: 60 }, 0)
  assert.equal(p.px, 300 - 120)
  assert.equal(p.py, 200 - 60 - 14)
})

// 这条是这个文件存在的理由：**先减平移再除缩放**。
// 顺序写反在 scale=1 时两种写法结果相同，一缩放就越偏越远 —— 而人多半在缩放状态下用画布。
test('缩放下的换算：先减平移，再除缩放', () => {
  const vp = { x: 40, y: 20, scale: 0.5 }
  const p = insertPointInFrame({ x: 400, y: 250 }, RECT, vp, { x: 0, y: 0 }, 0)
  // (400-100-40)/0.5 = 520 ; (250-50-20)/0.5 = 360
  assert.equal(p.px, 520)
  assert.equal(p.py, 360 - 14)
  // 写反的话会是 (400-100)/0.5-40 = 560，明显不同
  assert.notEqual(p.px, (400 - 100) / vp.scale - vp.x)
})

test('放大时同一个光标点对应更小的世界位移', () => {
  const near = insertPointInFrame({ x: 300, y: 150 }, RECT, { x: 0, y: 0, scale: 2 }, { x: 0, y: 0 }, 0)
  const far = insertPointInFrame({ x: 300, y: 150 }, RECT, { x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0)
  assert.ok(near.px < far.px, '放大后同一屏幕点落在更靠近原点的世界坐标')
})

test('宽度只影响水平，不影响垂直', () => {
  const a = insertPointInFrame({ x: 400, y: 250 }, RECT, { x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0)
  const b = insertPointInFrame({ x: 400, y: 250 }, RECT, { x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 400)
  assert.equal(a.py, b.py)
  assert.equal(a.px - b.px, 200)
})
