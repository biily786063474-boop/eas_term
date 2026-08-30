// 带上限的值缓存。**测的是「行为不变」和「不会涨到没边」** ——
// 这是性能改动，引进一个内存泄漏就等于把问题从一处搬到另一处
//（而这次排查的起因之一正是「内存持续累加」）。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createValueCache } from './valueCache.ts'

test('命中时不再调 make', () => {
  const c = createValueCache<string>(10)
  let calls = 0
  const make = (): string => (calls++, 'x')
  assert.equal(c.get('f', 'a', make), 'x')
  assert.equal(c.get('f', 'a', make), 'x')
  assert.equal(calls, 1, '第二次应该走缓存')
})

test('**内层键不同就重算** —— 键按值比，不按引用', () => {
  const c = createValueCache<string>(10)
  assert.equal(c.get('f', 'a', () => 'A'), 'A')
  assert.equal(c.get('f', 'b', () => 'B'), 'B')
})

test('**外层键参与判定** —— 同一段文本在不同文件里结果可以不同', () => {
  // markdown 里这就是 filePath：相对路径的图片要按它解析，串了就指错文件
  const c = createValueCache<string>(10)
  assert.equal(c.get('/aaa', 'same', () => '来自 aaa'), '来自 aaa')
  assert.equal(c.get('/bbb', 'same', () => '来自 bbb'), '来自 bbb')
})

// ── 上限 ──────────────────────────────────────────────────────────
test('**超过上限会淘汰，条数不会一直涨**', () => {
  const c = createValueCache<number>(20)
  for (let i = 0; i < 500; i++) c.get(`file${i}`, 'k', () => i)
  assert.ok(c.size() <= 20 + 1, `条数涨到了 ${c.size()}，上限是 20`)
})

test('淘汰之后行为仍然正确：被挤掉的重算一次，结果一致', () => {
  const c = createValueCache<string>(5)
  const first = c.get('f0', 'k', () => '第 0 个')
  for (let i = 1; i < 50; i++) c.get(`f${i}`, 'k', () => `第 ${i} 个`)
  assert.equal(c.get('f0', 'k', () => '第 0 个'), first)
})

test('**同一组里塞爆也不会死循环**（只剩这一组时清它自己）', () => {
  // 第一版这里会卡住：要淘汰的「最旧那组」正是当前这组，删了又立刻重建
  const c = createValueCache<number>(10)
  for (let i = 0; i < 100; i++) c.get('唯一的文件', `第${i}行`, () => i)
  assert.ok(c.size() <= 11, `条数 ${c.size()}`)
  assert.equal(c.get('唯一的文件', '第99行', () => -1), 99, '最后写进去的那条要还在')
})

test('值为 0 / 空串也算命中，不会被当成「没有」', () => {
  const c = createValueCache<number>(10)
  let calls = 0
  c.get('f', 'k', () => (calls++, 0))
  c.get('f', 'k', () => (calls++, 0))
  assert.equal(calls, 1, '0 是合法的值')
})
