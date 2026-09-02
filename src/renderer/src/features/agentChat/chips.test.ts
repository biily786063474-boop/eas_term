import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addChip, dropChip, expandChips, type DictChip } from './chips.ts'

const c = (id: string, text = `提示词-${id}`): DictChip => ({ id, label: id, text })

test('没有 chip 时就是修剪过的原文', () => {
  assert.equal(expandChips('  帮我改一下  ', []).text, '帮我改一下')
  assert.equal(expandChips('   ', []).text, '')
})

// 这条是 chip 的全部意义：输入框里只有名字，发出去的是全文
test('有 chip 时用分隔线接在用户那句话后面', () => {
  assert.equal(
    expandChips('帮我把搜索框改一下', [c('debounce', '在上文提到的位置实现「防抖」。')]).text,
    '帮我把搜索框改一下\n\n---\n在上文提到的位置实现「防抖」。'
  )
})

test('多个 chip 之间空行隔开，顺序就是挂上去的顺序', () => {
  assert.equal(expandChips('改一下', [c('a', 'A'), c('b', 'B')]).text, '改一下\n\n---\nA\n\nB')
})

// 用户挂了 chip 但一个字没打 —— 他就是想让模型照这条做，必须能发
test('**只挂 chip 不打字也要能发**，且不带那条多余的分隔线', () => {
  const out = expandChips('', [c('a', 'A')]).text
  assert.equal(out, 'A')
  assert.ok(out.length > 0, '返回空串会被发送按钮判成「没内容」，等于挂了 chip 发不出去')
})

test('chip 的 text 是空的就当它不存在，不要留下一条孤零零的分隔线', () => {
  assert.equal(expandChips('改一下', [c('a', '   ')]).text, '改一下')
})

test('同一个词条只挂一次 —— 重复点不该攒出两份相同的提示词', () => {
  const one = addChip([], c('debounce'))
  const two = addChip(one, c('debounce'))
  assert.equal(two.length, 1)
  assert.equal(two, one, '没变化时返回原数组，调用方可以据此跳过一次 setState')
})

test('不同词条各占一个位置', () => {
  assert.equal(addChip(addChip([], c('a')), c('b')).length, 2)
})

test('划掉一个只影响它自己', () => {
  const chips = addChip(addChip([], c('a')), c('b'))
  assert.deepEqual(dropChip(chips, 'a').map((x) => x.id), ['b'])
  assert.deepEqual(dropChip(chips, '不存在').map((x) => x.id), ['a', 'b'])
})

// ── 2026-09-02：改成「正文里 @ 谁就发谁，在原位展开」 ──────────────────────
//
// 用户原话：「chip 块现在在对话框上方预加载，我希望用户在正文中可以通过艾特
// 引用已经预加载的 chip 块，发送的时候不发送预加载的只发送被引用的，
// 并且根据引用的位置进行拼接。」
//
// 原来的做法是**全部挂着的 chip 一股脑拼在末尾**（一条 `---` 之后）。
// 那有两个问题：
//   ① 提示词只能放在最后，而很多时候它该出现在某句话**中间**
//      （「按 @文案风格 改写下面这段」）；
//   ② 预加载了但这次不想用的，得先手动摘掉。
//
// 新规矩：预加载只是「让它可被 @」，**发不发、发在哪，由正文里的 @ 决定**。

import { expandChips as _expand } from './chips.ts'

const C = (id: string, label: string, text: string) => ({ id, label, text })
const 文案 = C('a', '文案风格', '用简洁有力的短句，不堆形容词。')
const 代码 = C('b', '代码规范', '两空格缩进，不用分号。')

test('**@ 到的在原位展开** —— 提示词该出现在它被提到的地方，不是永远在末尾', () => {
  const r = _expand('按 @文案风格 改写下面这段', [文案, 代码])
  assert.match(r.text, /^按 用简洁有力的短句，不堆形容词。 改写下面这段$/)
  assert.deepEqual(r.usedIds, ['a'])
})

test('**没被 @ 的不发** —— 预加载只是「可被引用」，不是「一定会发」', () => {
  const r = _expand('按 @文案风格 改写', [文案, 代码])
  assert.ok(!r.text.includes('两空格缩进'), '没引用的代码规范被发出去了')
  assert.deepEqual(r.usedIds, ['a'])
})

test('同一个 chip @ 两次 → 两处都展开（那是用户明确写了两遍）', () => {
  const r = _expand('@文案风格 开头，结尾也 @文案风格', [文案])
  assert.equal(r.text.match(/用简洁有力的短句/g)?.length, 2)
  assert.deepEqual(r.usedIds, ['a'], 'usedIds 去重 —— 它回答的是「用了哪些」')
})

test('**一个都没 @ 时不静默丢掉**，退回旧行为（末尾拼全部）', () => {
  // 这是刻意的兜底：用户点了辞典条目、直接打字发送 —— 这条老路子还在。
  // 静默什么都不发，是最难自查的一种「东西不见了」。
  const r = _expand('帮我看看这段', [文案])
  assert.ok(r.text.includes('用简洁有力的短句'))
  assert.deepEqual(r.usedIds, ['a'])
})

test('@ 了不存在的名字 → **原样留着**，别吞掉用户打的字', () => {
  const r = _expand('问一下 @某个不存在的 怎么办', [文案])
  assert.ok(r.text.includes('@某个不存在的'), '把用户打的字吃掉了')
  // 一个都没**成功**引用 → 按「没引用」算，走末尾拼接那条兜底。
  // 也就是说打错名字的代价是「提示词跑到末尾去了」，而不是「凭空消失」——
  // 前者看得见，后者查不出来。
  assert.deepEqual(r.usedIds, ['a'])
})

test('**长名字优先匹配** —— 「@代码规范」不能被「@代码」截胡', () => {
  const 代码 = C('x', '代码', '短的')
  const 代码规范 = C('y', '代码规范', '长的')
  const r = _expand('看 @代码规范 这条', [代码, 代码规范])
  assert.ok(r.text.includes('长的'), '被短名字截胡了')
  assert.ok(!r.text.includes('短的'))
  assert.deepEqual(r.usedIds, ['y'])
})

test('邮箱之类的 @ 不该被当成引用', () => {
  const r = _expand('发到 a@b.com 那边', [文案])
  assert.ok(r.text.includes('a@b.com'))
})

test('只有 @ 引用、没有别的字 → 也要能发', () => {
  const r = _expand('@文案风格', [文案])
  assert.equal(r.text, '用简洁有力的短句，不堆形容词。')
})

test('什么都没有 → 空串（调用方拿它判断能不能发）', () => {
  assert.equal(_expand('', []).text, '')
})
