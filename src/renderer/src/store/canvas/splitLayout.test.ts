import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSplit, splitLayout, SPLIT_CELL } from './splitLayout.ts'

const w = (key: string) => ({ key, url: `https://${key}.com`, companion: { panelId: 'cell', props: { platform: key } } })
const c = (key: string, openedAt: number) => ({ key, nodeId: 'n-' + key, openedAt })

test('有空位：新增；已在：复用', () => {
  const p = planSplit([c('x', 1)], [w('x'), w('reddit')], [], 6)
  assert.deepEqual(p.reuse, ['x'])
  assert.deepEqual(p.add.map((a) => a.key), ['reddit'])
  assert.equal(p.replace.length, 0)
})

test('满了：先换已发布里最早的', () => {
  const now = [c('a', 1), c('b', 2), c('c', 3), c('d', 4), c('e', 5), c('f', 6)]
  const p = planSplit(now, [w('g')], ['c', 'e'], 6)
  assert.deepEqual(p.replace.map((r) => [r.out.key, r.in.key]), [['c', 'g']])
})

test('满了且都没发：换最早打开的', () => {
  const now = [c('a', 5), c('b', 2), c('c', 3), c('d', 4), c('e', 1), c('f', 6)]
  const p = planSplit(now, [w('g')], [], 6)
  assert.deepEqual(p.replace.map((r) => r.out.key), ['e'])
})

test('一次要的比空位多：同一批里刚放进来的不会被同批替换掉', () => {
  const now = [c('a', 1), c('b', 2), c('c', 3), c('d', 4), c('e', 5)]
  const p = planSplit(now, [w('f'), w('g'), w('h')], [], 6)
  assert.deepEqual(p.add.map((a) => a.key), ['f'])
  assert.deepEqual(p.replace.map((r) => r.out.key), ['a', 'b'])
})

test('max 夹到 1..6；超过 6 个 want 只处理前 6 个', () => {
  const p = planSplit([], ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(w), [], 99)
  assert.equal(p.add.length, 6)
  assert.deepEqual(p.skipped, ['g'])
})

test('排版：1-3 一行，4 是 2x2，5-6 是 3x2', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => { const l = splitLayout(n); return [l.cols, l.rows] }), [[1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 2]])
  const l = splitLayout(5)
  assert.deepEqual(l.slots[3], { x: 0, y: SPLIT_CELL.h + SPLIT_CELL.gap })
  assert.equal(l.w, 3 * SPLIT_CELL.w + 2 * SPLIT_CELL.gap)
})
