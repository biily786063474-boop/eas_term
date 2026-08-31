// 主进程里的对话摘要。**测的是「有上限」和「不悄悄骗人」** ——
// 用户长期高强度使用这个软件，无上限的驻留结构就是泄漏。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createTranscriptStore, MAX_ENTRIES, MAX_TEXT } from './transcript.ts'

test('按顺序记，旧的在前', () => {
  const s = createTranscriptStore()
  s.push('a', 'user', '问题一', 1)
  s.push('a', 'assistant', '回答一', 2)
  assert.deepEqual(
    s.recent('a').map((e) => `${e.role}:${e.text}`),
    ['user:问题一', 'assistant:回答一']
  )
})

test('会话之间互不串', () => {
  const s = createTranscriptStore()
  s.push('a', 'user', '给 A 的', 1)
  s.push('b', 'user', '给 B 的', 1)
  assert.equal(s.recent('a').length, 1)
  assert.equal(s.recent('a')[0].text, '给 A 的')
  assert.equal(s.recent('b')[0].text, '给 B 的')
})

test('没记过的会话返回空数组，不是 undefined', () => {
  assert.deepEqual(createTranscriptStore().recent('没这个'), [])
})

// ── 不记什么 ──────────────────────────────────────────────────────
test('**空白不记** —— 空气泡在手机上尤其莫名其妙', () => {
  const s = createTranscriptStore()
  s.push('a', 'assistant', '', 1)
  s.push('a', 'assistant', '   \n  ', 2)
  assert.equal(s.size('a'), 0)
})

test('没有 sessionId 不记', () => {
  const s = createTranscriptStore()
  s.push('', 'user', '有内容', 1)
  assert.equal(s.recent('').length, 0)
})

// ── 两层上限 ──────────────────────────────────────────────────────
test('**条数有上限**，超了丢最旧的', () => {
  const s = createTranscriptStore(5)
  for (let i = 0; i < 50; i++) s.push('a', 'user', `第 ${i} 条`, i)
  assert.equal(s.size('a'), 5)
  assert.equal(s.recent('a')[0].text, '第 45 条', '留下的应该是最近 5 条')
  assert.equal(s.recent('a')[4].text, '第 49 条')
})

test('**单条长度有上限，而且截断要说出来**', () => {
  // 悄悄截会让用户以为 agent 就说了这么多
  const s = createTranscriptStore(10, 100)
  s.push('a', 'assistant', 'x'.repeat(500), 1)
  const t = s.recent('a')[0].text
  assert.ok(t.length < 500)
  assert.match(t, /还有 400 字/, '截断了必须明说')
})

test('刚好不超上限的不截', () => {
  const s = createTranscriptStore(10, 100)
  s.push('a', 'assistant', 'y'.repeat(100), 1)
  assert.equal(s.recent('a')[0].text, 'y'.repeat(100))
})

test('默认上限是给手机看的量级，不是无限', () => {
  assert.equal(MAX_ENTRIES, 40)
  assert.equal(MAX_TEXT, 4000)
})

// ── 清理 ──────────────────────────────────────────────────────────
test('**会话没了要能丢掉** —— 不清的话开一天攒的是所有关过的会话', () => {
  const s = createTranscriptStore()
  s.push('a', 'user', '内容', 1)
  s.drop('a')
  assert.equal(s.size('a'), 0)
  assert.deepEqual(s.recent('a'), [])
})

test('recent 可以只要最后几条', () => {
  const s = createTranscriptStore()
  for (let i = 0; i < 10; i++) s.push('a', 'user', String(i), i)
  assert.deepEqual(s.recent('a', 3).map((e) => e.text), ['7', '8', '9'])
})

// ── 正在说的那半句（2026-08-31）────────────────────────────────────
// 用户实测：手机上不是流式，一句话要等它整段说完才出现，长回答就是干等几十秒。
// 所以 text.delta 也要留一份 —— 但**是一个会被覆盖的单格，不是往列表里追加**。

test('**覆盖而不是追加** —— 一个会话最多一条半句', () => {
  const t = createTranscriptStore()
  t.notePartial('s1', '你')
  t.notePartial('s1', '你好')
  t.notePartial('s1', '你好世界')
  assert.equal(t.partial('s1'), '你好世界')
  // 半句不进历史 —— 进了的话说完时会和完整那条重复
  assert.equal(t.size('s1'), 0)
})

test('**说完就清** —— 不清的话手机上会同时看到完整的那条和残缺的半句', () => {
  const t = createTranscriptStore()
  t.notePartial('s1', '你好世')
  t.push('s1', 'assistant', '你好世界', 1)
  assert.equal(t.partial('s1'), '', 'push 之后半句必须没了')
  assert.equal(t.recent('s1')[0].text, '你好世界')
})

test('各会话的半句互不串台', () => {
  const t = createTranscriptStore()
  t.notePartial('a', 'AAA')
  t.notePartial('b', 'BBB')
  t.push('a', 'assistant', 'AAA 完', 1)
  assert.equal(t.partial('a'), '')
  assert.equal(t.partial('b'), 'BBB', '清 a 不该动 b')
})

test('半句也封顶 —— 一次贴几 MB 的日志不该整段驻留', () => {
  const t = createTranscriptStore(40, 10)
  t.notePartial('s1', 'x'.repeat(500))
  assert.equal(t.partial('s1').length, 10)
})

test('drop 连半句一起丢', () => {
  const t = createTranscriptStore()
  t.notePartial('s1', '半句')
  t.push('s1', 'user', '问题', 1)
  t.drop('s1')
  assert.equal(t.partial('s1'), '')
  assert.equal(t.size('s1'), 0)
})

test('没记过的会话返回空串，不是 undefined', () => {
  assert.equal(createTranscriptStore().partial('nope'), '')
})
