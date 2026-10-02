import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore
import { pickForSplit } from './split.mjs'

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
