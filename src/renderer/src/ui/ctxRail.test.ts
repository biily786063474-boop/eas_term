import { test } from 'node:test'
import assert from 'node:assert/strict'

import { railPath, railThumb } from './ctxRail.ts'

// ── 轨道几何 ──────────────────────────────────────────────────────────────

test('起点在顶边距右端 1/3 宽处，终点在右边 2/3 高处', () => {
  const d = railPath({ w: 300, h: 600, r: 20 })
  assert.match(d, /^M 200 0 /, '起点不对（应当是 w*2/3）')
  assert.match(d, / V 400$/, '终点不对（应当是 h*2/3）')
})

test('中间那段是右上角的圆弧，半径就是菜单的圆角', () => {
  const d = railPath({ w: 300, h: 600, r: 20 })
  assert.match(d, /H 280 A 20 20 0 0 1 300 20/)
})

test('**窄菜单里半径要夹住** —— 不夹的话圆弧吃掉整条边，画出来是鬼画符', () => {
  const d = railPath({ w: 30, h: 600, r: 20 })
  // 半径被夹到 w/2 = 15
  assert.match(d, /A 15 15 /)
  // 且「沿顶边走」那段不能是负长度：起点 ≤ 圆弧起点
  const m = d.match(/^M ([\d.]+) 0 H ([\d.]+)/)!
  assert.ok(+m[1] <= +m[2], `起点 ${m[1]} 越过了圆弧起点 ${m[2]}`)
})

test('矮菜单：终点不能高过圆弧的结束点', () => {
  const d = railPath({ w: 300, h: 30, r: 20 })
  const rr = Math.min(20, 300 / 2, 30 / 2) // 15
  const end = +d.match(/ V ([\d.]+)$/)![1]
  assert.ok(end >= rr, `终点 ${end} 落在圆弧里了（半径 ${rr}）`)
})

test('半径为 0 也要画得出来（直角菜单）', () => {
  const d = railPath({ w: 300, h: 600, r: 0 })
  assert.match(d, /A 0 0 /)
})

// ── 滑块 ──────────────────────────────────────────────────────────────────

test('内容装得下 → 满长滑块', () => {
  // 比「不画」好懂：用户看到「就这么多」，而不是「这儿本来该有个什么吗」
  assert.deepEqual(railThumb(0, 100, 200), { len: 1, at: 0 })
})

test('滚到顶 at=0，滚到底 at 正好把滑块顶到轨道末端', () => {
  const top = railThumb(0, 400, 100)
  const bottom = railThumb(300, 400, 100)
  assert.equal(top.at, 0)
  assert.ok(Math.abs(bottom.at + bottom.len - 1) < 1e-9, '滚到底时滑块没贴到轨道末端')
})

test('滑块长度 = 可视比例（同原生滚动条的直觉）', () => {
  assert.equal(railThumb(0, 400, 100).len, 0.25)
})

test('**内容极长时给个下限** —— 按比例算出来会是一根看不见的线头', () => {
  assert.equal(railThumb(0, 100000, 100).len, 0.12)
})

test('越界的 scrollTop 不会把滑块甩出轨道（惯性滚动会传负值）', () => {
  assert.equal(railThumb(-50, 400, 100).at, 0)
  assert.ok(railThumb(9999, 400, 100).at + railThumb(9999, 400, 100).len <= 1 + 1e-9)
})
