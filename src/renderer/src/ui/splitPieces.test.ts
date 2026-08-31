import assert from 'node:assert/strict'
import { test } from 'node:test'

import { animatedCount, splitForAnimation } from './splitPieces.ts'

const chars = (s: string): string[] => splitForAnimation(s).map((p) => p.ch)

test('**按码点拆，emoji 不能被切成两半**', () => {
  // '👍'.length 是 2 —— split('') 会切出两个孤立代理项，渲染成两个「�」
  assert.equal('👍'.length, 2, '前提：它在 UTF-16 里占两个码元')
  assert.deepEqual(chars('a👍b'), ['a', '👍', 'b'])
})

test('中文一个字一个片段', () => {
  assert.deepEqual(chars('插入文档'), ['插', '入', '文', '档'])
})

test('**空格要留住** —— 换成不换行空格，否则行内会被折叠掉', () => {
  const c = chars('你 好')
  assert.equal(c.length, 3)
  assert.equal(c[1], ' ', '普通空格要变成 NBSP')
  assert.notEqual(c[1], ' ')
})

test('**换行要留住**，而且单独标出来', () => {
  const p = splitForAnimation('a\nb')
  assert.equal(p.length, 3)
  assert.equal(p[1].br, true)
  assert.equal(p[0].br, undefined)
})

test('换行不占动画序号 —— 否则它后面所有字白等一拍', () => {
  assert.equal(animatedCount(splitForAnimation('ab\ncd')), 4)
  assert.equal(animatedCount(splitForAnimation('abcd')), 4)
})

test('空串不炸', () => {
  assert.deepEqual(splitForAnimation(''), [])
  assert.equal(animatedCount([]), 0)
})

test('拆完能原样拼回去（除了空格被换成 NBSP）', () => {
  const src = '插入 terminal\n第二行'
  const back = splitForAnimation(src)
    .map((p) => (p.br ? '\n' : p.ch))
    .join('')
  assert.equal(back.replace(/ /g, ' '), src, '除 NBSP 外应完全一致')
})
