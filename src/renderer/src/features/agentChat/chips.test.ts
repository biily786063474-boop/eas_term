import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addChip, dropChip, expandChips, type DictChip } from './chips.ts'

const c = (id: string, text = `提示词-${id}`): DictChip => ({ id, label: id, text })

test('没有 chip 时就是修剪过的原文', () => {
  assert.equal(expandChips('  帮我改一下  ', []), '帮我改一下')
  assert.equal(expandChips('   ', []), '')
})

// 这条是 chip 的全部意义：输入框里只有名字，发出去的是全文
test('有 chip 时用分隔线接在用户那句话后面', () => {
  assert.equal(
    expandChips('帮我把搜索框改一下', [c('debounce', '在上文提到的位置实现「防抖」。')]),
    '帮我把搜索框改一下\n\n---\n在上文提到的位置实现「防抖」。'
  )
})

test('多个 chip 之间空行隔开，顺序就是挂上去的顺序', () => {
  assert.equal(expandChips('改一下', [c('a', 'A'), c('b', 'B')]), '改一下\n\n---\nA\n\nB')
})

// 用户挂了 chip 但一个字没打 —— 他就是想让模型照这条做，必须能发
test('**只挂 chip 不打字也要能发**，且不带那条多余的分隔线', () => {
  const out = expandChips('', [c('a', 'A')])
  assert.equal(out, 'A')
  assert.ok(out.length > 0, '返回空串会被发送按钮判成「没内容」，等于挂了 chip 发不出去')
})

test('chip 的 text 是空的就当它不存在，不要留下一条孤零零的分隔线', () => {
  assert.equal(expandChips('改一下', [c('a', '   ')]), '改一下')
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
