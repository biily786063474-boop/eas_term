import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntries, filterPage, tagCounts, composeInjection, savePreset, deletePreset, PAGE_SIZE, DEFAULT_PRESETS } from './core.mjs'

const raw = (n, over = {}) => ({
  slug: `a-${n}`, author: `u${n}`, author_url: '', category: n % 2 ? 'motion' : '3d',
  post_url: `https://x.com/u/status/${n}`, poster_url: `https://m.test/${n}.webp`,
  prompt: `p${n}`, prompt_partial: false, tech_tags: n % 3 ? ['canvas'] : ['canvas', 'gsap'],
  added: `2026-09-${String(10 + (n % 20)).padStart(2, '0')}`, ...over
})

test('normalizeEntries：丢坏条目、清非 http 链接、按 added 降序', () => {
  const out = normalizeEntries([raw(1), raw(2, { slug: '../evil' }), raw(3, { prompt: '  ' }), raw(4, { post_url: 'javascript:alert(1)' })])
  assert.deepEqual(out.map((e) => e.slug), ['a-4', 'a-1'])
  assert.equal(out[0].postUrl, '')
  assert.equal(out[1].postUrl, 'https://x.com/u/status/1')
  assert.deepEqual(Object.keys(out[1]).sort(), ['added', 'author', 'category', 'partial', 'postUrl', 'posterUrl', 'prompt', 'slug', 'tags'])
  assert.throws(() => normalizeEntries({}), /不是数组/)
})

test('filterPage：分类、标签、页码夹紧、空结果仍有 1 页', () => {
  const all = normalizeEntries(Array.from({ length: 80 }, (_, i) => raw(i)))
  const m = filterPage(all, { category: 'motion' })
  assert.equal(m.total, 40)
  assert.equal(m.pages, 2)
  assert.equal(m.items.length, PAGE_SIZE)
  assert.equal(filterPage(all, { category: 'motion', page: 99 }).page, 1)
  assert.equal(filterPage(all, { page: -3 }).page, 0)
  assert.equal(filterPage(all, { tag: 'gsap' }).total, 27)
  const none = filterPage(all, { tag: 'nope' })
  assert.deepEqual([none.total, none.pages, none.items.length], [0, 1, 0])
})

test('tagCounts 降序', () => {
  const all = normalizeEntries(Array.from({ length: 6 }, (_, i) => raw(i)))
  assert.deepEqual(tagCounts(all), [{ tag: 'canvas', count: 6 }, { tag: 'gsap', count: 2 }])
})

test('composeInjection：主题、技术栈、部分公开标记、预设', () => {
  const [e] = normalizeEntries([raw(1, { prompt_partial: true, tech_tags: ['canvas', 'gsap'] })])
  const c = composeInjection(e, ' Eas-Term 宣传片 ', { name: '规范', text: '不用霓虹' })
  assert.equal(c.label, '@u1 风格')
  assert.match(c.text, /技术栈（canvas \/ gsap）/)
  assert.match(c.text, /为「Eas-Term 宣传片」做一个单文件 HTML 动画/)
  assert.match(c.text, /原作：@u1（https:\/\/x\.com\/u\/status\/1）/)
  assert.match(c.text, /原提示词（仅部分公开）：\np1/)
  assert.match(c.text, /附加约束（规范）：\n不用霓虹/)
  assert.doesNotMatch(composeInjection(e, '主题', null).text, /附加约束/)
  assert.throws(() => composeInjection(e, '   '), /主题不能为空/)
  const [longAuthor] = normalizeEntries([raw(2, { author: 'x'.repeat(60) })])
  assert.ok(composeInjection(longAuthor, '主题').label.length <= 30)
})

test('预设：默认有宣传片规范；新建、更新、校验、删除', () => {
  assert.equal(DEFAULT_PRESETS[0].id, 'eas-promo')
  let list = savePreset([], { name: '克制', text: '少动' })
  assert.equal(list.length, 1)
  assert.match(list[0].id, /^p-[0-9a-z]+$/)
  list = savePreset(list, { id: list[0].id, name: '克制 2', text: '更少动' })
  assert.deepEqual([list.length, list[0].name, list[0].text], [1, '克制 2', '更少动'])
  assert.throws(() => savePreset(list, { name: '', text: 'x' }), /名称/)
  assert.throws(() => savePreset(list, { name: 'x'.repeat(31), text: 'x' }), /名称/)
  assert.throws(() => savePreset(list, { name: 'x', text: 'y'.repeat(4001) }), /内容/)
  assert.deepEqual(deletePreset(list, list[0].id), [])
})
