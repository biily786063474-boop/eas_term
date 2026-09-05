import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridPlace } from './tidyGrid.ts'

const box = (id: string, w = 100, h = 80): { id: string; w: number; h: number } => ({ id, w, h })
const opts = { gap: 20, startX: 16, startY: 34 }

/** 从摆放结果推有几列：不同的 x 值的个数 */
function colsOf(m: Map<string, { x: number; y: number }>): number {
  return new Set([...m.values()].map((p) => p.x)).size
}
function rowsOf(m: Map<string, { x: number; y: number }>): number {
  return new Set([...m.values()].map((p) => p.y)).size
}

test('9 个等宽模块 → 3×3 宫格，不是一列', () => {
  const m = gridPlace(Array.from({ length: 9 }, (_, i) => box(`n${i}`)), opts)
  assert.equal(colsOf(m), 3, `应当 3 列，实际 ${colsOf(m)}`)
  assert.equal(rowsOf(m), 3)
})

// 这条是用户报的那个：老逻辑会排成一整列
test('**4 个模块绝不排成一整列** —— 至少 2 列', () => {
  const m = gridPlace([box('a'), box('b'), box('c'), box('d')], opts)
  assert.ok(colsOf(m) >= 2, `4 个模块应当至少 2 列，实际 ${colsOf(m)} 列`)
})

test('第一行从起点开始，行内横向排开', () => {
  const m = gridPlace([box('a'), box('b')], opts)
  const a = m.get('a')!
  const b = m.get('b')!
  assert.equal(a.x, 16)
  assert.equal(a.y, 34)
  assert.equal(b.y, 34, '同一行 y 相同')
  assert.equal(b.x, 16 + 100 + 20, 'b 排在 a 右边一个间隔')
})

test('一个模块 → 就一个位置，摆在起点', () => {
  const m = gridPlace([box('solo', 300, 200)], opts)
  assert.deepEqual(m.get('solo'), { x: 16, y: 34 })
  assert.equal(colsOf(m), 1)
})

test('宽窄不一：行宽按最宽的几个算，宽模块放得下不溢出', () => {
  // 一个很宽 + 三个窄。3 个模块 → 目标 √3≈2 列
  const m = gridPlace([box('wide', 300, 80), box('a', 80), box('b', 80), box('c', 80)], opts)
  // wide 那张不会和别的挤在一行放不下（每张的 x 都 >= startX 且不越界）
  for (const p of m.values()) assert.ok(p.x >= 16)
  assert.ok(colsOf(m) >= 2, '不该退化成一列')
})

test('空输入 → 空结果，不抛', () => {
  assert.equal(gridPlace([], opts).size, 0)
})

test('maxCols 指定时听它的（但夹在 [1, n]）', () => {
  const nodes = Array.from({ length: 6 }, (_, i) => box(`n${i}`))
  assert.equal(colsOf(gridPlace(nodes, { ...opts, maxCols: 2 })), 2)
  assert.equal(colsOf(gridPlace(nodes, { ...opts, maxCols: 99 })), 6, '上限超过个数就一行排完')
})

test('每行高度取行内最高 —— 下一行不会压上一行的高模块', () => {
  // 两个矮 + 一个高，2 列：第一行 [矮,高]，第二行 [矮]。第二行 y 要越过第一行的高
  const m = gridPlace([box('s1', 100, 60), box('tall', 100, 200), box('s2', 100, 60)], { ...opts, maxCols: 2 })
  const s2 = m.get('s2')!
  assert.ok(s2.y >= 34 + 200 + 20, `第二行要在高模块之下，实际 y=${s2.y}`)
})
