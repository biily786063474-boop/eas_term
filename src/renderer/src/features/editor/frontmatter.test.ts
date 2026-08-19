import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitFrontmatter } from './frontmatter.ts'

test('摘出 frontmatter，正文不含它', () => {
  const fm = splitFrontmatter('---\nname: eas-term\n---\n\n# 标题\n正文\n')!
  assert.equal(fm.body, '\n# 标题\n正文\n')
  assert.deepEqual(fm.fields, [{ key: 'name', value: 'eas-term' }])
})

test('折叠块标量拍平成一行（SKILL.md 的 description 就是这种写法）', () => {
  const src = '---\nname: x\ndescription: >\n  第一行\n  第二行\n---\n正文\n'
  const fm = splitFrontmatter(src)!
  assert.deepEqual(fm.fields, [
    { key: 'name', value: 'x' },
    { key: 'description', value: '第一行 第二行' }
  ])
})

test('没有 frontmatter 返回 null（调用方回落到整篇当正文）', () => {
  assert.equal(splitFrontmatter('# 标题\n正文\n'), null)
})

test('正文里的 --- 分割线不当成 frontmatter（判据是「第一行就是 ---」）', () => {
  assert.equal(splitFrontmatter('# 标题\n\n---\n\n下半段\n'), null)
})

test('开头是 --- 但没有闭合 --- → 不敢摘', () => {
  assert.equal(splitFrontmatter('---\nname: x\n\n# 其实是正文\n'), null)
})

test('CRLF 与 BOM 都认', () => {
  assert.equal(splitFrontmatter('---\r\nname: x\r\n---\r\n正文\r\n')!.body, '正文\r\n')
  assert.equal(splitFrontmatter('﻿---\nname: x\n---\n正文\n')!.body, '正文\n')
})

test('嵌套/缩进的键不当成顶层字段（只认顶格的 key:）', () => {
  const fm = splitFrontmatter('---\nmetadata:\n  type: project\nname: x\n---\n正文\n')!
  assert.deepEqual(fm.fields.map((f) => f.key), ['metadata', 'name'])
})
