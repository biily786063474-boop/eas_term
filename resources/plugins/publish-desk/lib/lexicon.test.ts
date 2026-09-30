import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, check, normalize, validateEntry } from './lexicon.mjs'

const basis = { title: '测试依据', url: 'https://example.com/rule' }
const entry = (over: Record<string, unknown>) => ({ id: 't', kind: 'absolute', level: 'high', confidence: 'law', platforms: 'all', hint: '提示', basis, ...over })

test('缺依据的词条拒绝加载，不是跳过', () => {
  assert.throws(() => validateEntry(entry({ terms: ['最佳'], basis: { title: '没链接' } })), /依据链接/)
  assert.throws(() => validateEntry(entry({ terms: ['最佳'], basis: undefined })), /缺依据/)
  assert.throws(() => validateEntry(entry({ terms: ['最佳'], hint: undefined })), /hint/)
  assert.throws(() => validateEntry(entry({ terms: ['最佳'], confidence: 'observed' })), /observed/)
  assert.throws(() => validateEntry(entry({ terms: ['x'], platforms: ['weibo'] })), /platforms/)
  assert.throws(() => validateEntry(entry({ pattern: '(' })), /正则/)
  assert.throws(() => validateEntry(entry({ terms: ['x'], extra: 1 })), /未知字段/)
  // 用户词条：要日期和平台，不要链接
  assert.doesNotThrow(() => validateEntry(entry({ kind: 'user', confidence: 'observed', terms: ['限流词'], basis: { title: '笔记被限流', date: '2026-09-30', platform: 'xiaohongshu' } })))
  assert.throws(() => validateEntry(entry({ kind: 'user', confidence: 'observed', terms: ['限流词'], basis: { title: '笔记被限流' } })), /日期/)
})

test('归一化：全角、大小写、零宽字符，且能映射回原文位置', () => {
  const n = normalize('ＶＸ​号')
  assert.equal(n.text, 'vx号')
  assert.deepEqual([n.from[0], n.to[2]], [0, 4])
})

test('命中给出原文里的词和位置', () => {
  const c = compile([entry({ terms: ['最佳'] })])
  const [h] = check('这是市面上最佳的工具', c)
  assert.equal(h.word, '最佳')
  assert.equal('这是市面上最佳的工具'.slice(h.start, h.end), '最佳')
  assert.equal(h.basis.url, basis.url)
})

test('loose 词条认得拆字与全角变体，原文位置照样准', () => {
  const c = compile([entry({ id: 'wx', kind: 'traffic', loose: true, terms: ['微信', 'vx'] })])
  const text = '想要的加 微 信，或者 Ｖ·Ｘ 找我'
  const words = check(text, c).map((h) => h.word)
  assert.deepEqual(words, ['微 信', 'Ｖ·Ｘ'])
})

test('字母词不命中更长单词的一部分', () => {
  const c = compile([entry({ id: 'wx', kind: 'traffic', terms: ['wx', 'vx'] })])
  assert.equal(check('devx toolkit and wxyz', c).length, 0)
  assert.equal(check('加 wx: abc', c).length, 1)
})

test('语境例外：覆盖命中的例外词让命中作废（执法指南列的时空顺序等）', () => {
  const c = compile([entry({ id: 'first', terms: ['第一'], except: ['第一(次|步|天|个|章|期|集|批|条|名)', '第一时间'] })])
  assert.equal(check('第一次做独立开发，第一步先画原型', c).length, 0)
  assert.equal(check('行业第一的终端', c).length, 1)
})

test('按平台过滤；不给平台时全部参与', () => {
  const c = compile([entry({ id: 'xhs', kind: 'link', platforms: ['xiaohongshu'], pattern: 'https?://\\S+' })])
  assert.equal(check('看 https://eas.biily.top', c, { platform: 'x' }).length, 0)
  assert.equal(check('看 https://eas.biily.top', c, { platform: 'xiaohongshu' }).length, 1)
  assert.equal(check('看 https://eas.biily.top', c).length, 1)
})
