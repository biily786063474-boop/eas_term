import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripFrontmatter } from './frontmatter.ts'

test('剥掉开头的 frontmatter，正文原样', () => {
  const src = '---\nname: eas-term\ndescription: >\n  一段话\n---\n\n# 标题\n正文\n'
  assert.equal(stripFrontmatter(src), '\n# 标题\n正文\n')
})

test('没有 frontmatter 的文档一个字不动', () => {
  const src = '# 标题\n正文\n'
  assert.equal(stripFrontmatter(src), src)
})

test('正文里的 --- 分割线不当成 frontmatter（判据是「第一行就是 ---」）', () => {
  const src = '# 标题\n\n---\n\n下半段\n'
  assert.equal(stripFrontmatter(src), src)
})

test('开头是 --- 但没有闭合 --- → 不敢剥，原样返回', () => {
  const src = '---\nname: x\n\n# 其实是正文\n'
  assert.equal(stripFrontmatter(src), src)
})

test('CRLF 换行也认', () => {
  const src = '---\r\nname: x\r\n---\r\n正文\r\n'
  assert.equal(stripFrontmatter(src), '正文\r\n')
})

test('带 BOM 的文件也认', () => {
  assert.equal(stripFrontmatter('﻿---\nname: x\n---\n正文\n'), '正文\n')
})
