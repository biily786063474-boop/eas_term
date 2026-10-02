import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore
import { pickForSplit, splitParams, cellKey, platformOfKey } from './split.mjs'

const card = (platform: string, o: Record<string, unknown> = {}) => ({ platform, title: 't', body: 'b', tags: [], media: [], status: 'draft', p1: false, ...o })
test('有文案、没发、没标不发，最多 6 个，按卡片顺序', () => {
  const cards = [card('a'), card('b', { status: 'published' }), card('c', { status: 'skipped' }), card('d', { title: '', body: '' }), card('e'), card('f'), card('g'), card('h'), card('i'), card('j')]
  assert.deepEqual(pickForSplit(cards, 'all').map((c: any) => c.platform), ['a', 'e', 'f', 'g', 'h', 'i'])
})
test('首批三个筛选：只取 p1', () => {
  assert.deepEqual(pickForSplit([card('a'), card('b', { p1: true })], 'p1').map((c: any) => c.platform), ['b'])
})
test('只有标签或素材也算有内容', () => {
  assert.deepEqual(pickForSplit([card('a', { title: '', body: '', tags: ['x'] })], 'todo').map((c: any) => c.platform), ['a'])
})

test('格子 key 带批次：同一平台在两个批次里 key 不同，published 同样带批次，状态栏名字去掉前缀', () => {
  const a = { batchId: 'A-uuid', title: '甲', cards: [card('x', { url: 'https://x.com/compose', status: 'published' }), card('zhihu', { url: 'https://zhuanlan.zhihu.com/write' })] }
  const b = { batchId: 'B-uuid', title: '乙', cards: [card('x', { url: 'https://x.com/compose' })] }
  const pa = splitParams(a, a.cards), pb = splitParams(b, b.cards)
  assert.deepEqual(pa.cells.map((c: any) => c.key), ['A-uuid:x', 'A-uuid:zhihu'])
  assert.deepEqual(pb.cells.map((c: any) => c.key), ['B-uuid:x'])
  assert.notEqual(pa.cells[0].key, pb.cells[0].key)
  assert.deepEqual(pb.cells[0].companion, { panelId: 'cell', props: { batchId: 'B-uuid', platform: 'x' } })
  assert.deepEqual(pa.published, ['A-uuid:x'])
  assert.equal(pa.title, '发布分屏 · 甲')
  assert.equal(platformOfKey('B-uuid:youtube-shorts'), 'youtube-shorts')
  assert.equal(platformOfKey(cellKey('a:b', 'x')), 'x')
  assert.equal(platformOfKey('x'), 'x')
})
