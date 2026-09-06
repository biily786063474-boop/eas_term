import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropIntoFrame, type FrameBox } from './dropTarget.ts'

const SIZE = { w: 300, h: 220 }
const A: FrameBox = { id: 'a', x: 0, y: 0, w: 1000, h: 800 }
const B: FrameBox = { id: 'b', x: 2000, y: 0, w: 600, h: 500 }
/** 套在 A 里面的子 Frame */
const CHILD: FrameBox = { id: 'child', x: 100, y: 100, w: 400, h: 300 }

test('一个 Frame 都没有：返回 null，调用方自己兜底', () => {
  assert.equal(dropIntoFrame([], 10, 10, SIZE), null)
})

test('落点在 Frame 内：就是它', () => {
  assert.equal(dropIntoFrame([A, B], 500, 400, SIZE)?.frameId, 'a')
})

test('落点同时命中父子 Frame：取面积最小的子 Frame', () => {
  assert.equal(dropIntoFrame([A, CHILD], 200, 200, SIZE)?.frameId, 'child')
})

test('落在空白处：取最近的 Frame，不是第一个', () => {
  // x=1900 离 B(左边 2000) 100，离 A(右边 1000) 900
  assert.equal(dropIntoFrame([A, B], 1900, 100, SIZE)?.frameId, 'b')
})

test('落在空白处：坐标夹回 Frame 内框，不会把节点甩到外面', () => {
  const r = dropIntoFrame([A], 5000, 5000, SIZE)
  assert.ok(r)
  assert.ok(r.x >= 0 && r.x + SIZE.w <= A.w, `x=${r.x} 应留在 Frame 内`)
  assert.ok(r.y >= 0 && r.y + SIZE.h <= A.h, `y=${r.y} 应留在 Frame 内`)
})

test('Frame 比节点还小：夹到左上内边距，不产生负坐标', () => {
  const tiny: FrameBox = { id: 't', x: 0, y: 0, w: 120, h: 100 }
  const r = dropIntoFrame([tiny], 60, 50, SIZE)
  assert.ok(r && r.x > 0 && r.y > 0)
})

test('落点在 Frame 左上角外：不产生负坐标', () => {
  const r = dropIntoFrame([A], -500, -500, SIZE)
  assert.ok(r && r.x > 0 && r.y > 0)
})
