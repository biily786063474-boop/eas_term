import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreTerm, searchTerms, type Searchable } from './search.ts'

const T = (o: Partial<Searchable> & { zh: string }): Searchable => ({
  en: '', keywords: [], category: 'interaction', ...o
})

const debounce = T({ zh: '防抖', en: 'Debounce', keywords: ['debounce', '去抖'],
  logic: '高频事件触发后延迟 N 毫秒再执行', prompt: '在上文提到的位置实现「防抖」。【实现方法】用闭包保存 timer' })
const throttle = T({ zh: '节流', en: 'Throttle', keywords: ['throttle'],
  logic: '固定每隔 N 毫秒最多执行一次。与防抖的区别：防抖是停手才执行' })

test('打名字，名字那条排第一 —— 不能被「正文里提了一句」的挤下去', () => {
  const r = searchTerms([throttle, debounce], '防抖')
  assert.equal(r[0].item.zh, '防抖', '正文命中的节流排到了前面')
  assert.equal(r[0].hit, 'zh')
  assert.equal(r[1].item.zh, '节流')
  assert.equal(r[1].hit, 'logic', '节流是因为正文里提到防抖才被搜出来')
})

test('英文名也能搜到', () => {
  assert.equal(searchTerms([debounce, throttle], 'thro')[0].item.zh, '节流')
})

test('关键词能搜到，且排在正文命中前面', () => {
  const r = searchTerms([throttle, debounce], '去抖')
  assert.equal(r[0].item.zh, '防抖')
  assert.equal(r[0].hit, 'keywords')
})

test('提示词片段能搜到 —— 这是这次新增的能力', () => {
  const r = searchTerms([throttle, debounce], '闭包')
  assert.equal(r.length, 1)
  assert.equal(r[0].item.zh, '防抖')
  assert.equal(r[0].hit, 'prompt')
})

test('分类名能搜到（要调用方给中文名，代号 interaction 用户不会打）', () => {
  const r = searchTerms([debounce], '交互', () => '交互行为')
  assert.equal(r.length, 1)
  assert.equal(r[0].hit, 'category')
  assert.equal(searchTerms([debounce], '交互').length, 0, '不给分类名就不该搜出来')
})

// 这条是 search.ts 存在的全部理由：长文本用子序列匹配等于搜索失效
test('**长文本只认整段子串，不做子序列** —— 否则打什么都匹配 381 条', () => {
  // 「高触毫」在 logic 里按顺序都出现（高频…触发…毫秒）但不连着 ——
  // 这正是子序列会匹上、整段子串匹不上的形状。**反例必须真的是子序列**，
  // 否则这条断言在变异测试里一声不吭（第一版挑的「高执毫」里"毫"在"执"前面，不成立）
  assert.equal(scoreTerm(debounce, '高触毫'), null, '子序列漏进长文本了，搜索会全匹配')
  // 而真正连着的那段要能搜到
  assert.ok(scoreTerm(debounce, '延迟 N 毫秒'), '整段子串反而搜不到')
})

test('短字段仍然做子序列 —— 打 dbc 要能匹到 Debounce', () => {
  assert.ok(scoreTerm(debounce, 'dbc'), '短名字上的模糊匹配丢了')
})

test('一条词在多个字段都命中时只出现一次，且算最好的那个分', () => {
  const r = searchTerms([debounce], '防抖')
  assert.equal(r.length, 1, '同一条词条被列了两次')
  assert.equal(r[0].hit, 'zh', '名字命中应该赢过 prompt 命中')
})

test('正文命中给一段带省略号的摘录，让用户知道为什么它被搜出来', () => {
  const r = searchTerms([debounce], '闭包')
  assert.ok(r[0].excerpt?.includes('闭包'))
  assert.ok(r[0].excerpt?.startsWith('…'), '掐了头就该有省略号')
})

test('空查询原样返回，顺序不动', () => {
  const r = searchTerms([throttle, debounce], '  ')
  assert.deepEqual(r.map((x) => x.item.zh), ['节流', '防抖'])
})

test('没有 prompt 的词条不会因为 undefined 崩掉', () => {
  const bare = T({ zh: '空壳' })
  assert.equal(scoreTerm(bare, '闭包'), null)
  assert.ok(scoreTerm(bare, '空壳'))
})

test('分数相同时保持传入顺序（稳定排序）', () => {
  const a = T({ zh: '同名' }), b = T({ zh: '同名' })
  const r = searchTerms([a, b], '同名')
  assert.equal(r[0].item, a)
})
