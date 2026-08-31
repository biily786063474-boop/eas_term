import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fuzzyPick, fuzzyScore } from './fuzzy.ts'

test('空查询：全都留着，顺序不动', () => {
  const xs = ['c', 'a', 'b']
  assert.deepEqual(fuzzyPick(xs, '', (x) => x), xs)
  assert.deepEqual(fuzzyPick(xs, '   ', (x) => x), xs)
})

test('**首字母缩写要能匹到** —— 这是 includes 做不到的那一半', () => {
  // 输入 bg 想找 Bzone-Gateway，这是最自然的两个字母
  assert.notEqual(fuzzyScore('Bzone-Gateway', 'bg'), null)
  assert.equal('Bzone-Gateway'.toLowerCase().includes('bg'), false, '前提：includes 匹不到')
})

test('整段命中排在子序列命中前面', () => {
  const xs = ['Bzone-Gateway', 'blog']
  // 'blog' 里有连续的 "blog"，'Bzone-Gateway' 只是子序列
  assert.deepEqual(fuzzyPick(xs, 'blog', (x) => x), ['blog'])
})

test('开头命中排在中间命中前面', () => {
  const xs = ['my-terminal', 'terminal']
  assert.deepEqual(fuzzyPick(xs, 'term', (x) => x), ['terminal', 'my-terminal'])
})

test('词首加分：跨分隔符的缩写排前面', () => {
  const a = fuzzyScore('vibe coding/terminal', 'vct') // 三个词首
  const b = fuzzyScore('vaccinate', 'vct') // 挤在一个词里
  assert.ok(a !== null && b !== null)
  assert.ok((a as number) < (b as number), `词首组合 ${a} 应该比词内 ${b} 分低（更靠前）`)
})

test('顺序不对就是没匹上', () => {
  assert.equal(fuzzyScore('terminal', 'lat'), null, 'l 在 a 后面，顺序不符')
  assert.notEqual(fuzzyScore('terminal', 'tal'), null)
})

test('大小写不敏感', () => {
  assert.notEqual(fuzzyScore('Bzone-Gateway', 'BZONE'), null)
  assert.notEqual(fuzzyScore('bzone', 'BZ'), null)
})

test('中文按字匹配（不做拼音）', () => {
  assert.notEqual(fuzzyScore('桌面整理', '整理'), null)
  assert.notEqual(fuzzyScore('桌面整理', '桌整'), null, '跳字也算')
  assert.equal(fuzzyScore('桌面整理', 'zhuomian'), null, '不支持拼音，这是有意的')
})

test('**分数相同时保持调用方的顺序** —— 那个顺序本身有意义（状态分层/最近使用）', () => {
  const xs = ['aa', 'ab', 'ac']
  // 三个都是「开头匹 a」，分一样
  assert.deepEqual(fuzzyPick(xs, 'a', (x) => x), xs)
})

test('匹不上的被筛掉', () => {
  assert.deepEqual(fuzzyPick(['abc', 'xyz'], 'ab', (x) => x), ['abc'])
  assert.deepEqual(fuzzyPick(['abc', 'xyz'], 'q', (x) => x), [])
})
