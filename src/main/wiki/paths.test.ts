import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { isRawName, TAXONOMY_FILE } from './taxonomy.ts'

// paths.ts 引了 electron，node --test 加载不了它 —— 判定逻辑本身放在 taxonomy.ts
// 里（isRawName），paths.ts 的 isRawDir 只是转发。这个文件钉住「原始素材区判定」
// 这条行为，直接调真实导出，不在测试里重写一遍判定逻辑（那样测的是测试自己）。

test('内置库：收件箱和 sources 算原始素材区', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  assert.ok(isRawName(dir, '00-inbox', (k) => k))
  assert.ok(isRawName(dir, 'sources', (k) => k))
  assert.ok(!isRawName(dir, 'methods', (k) => k))
})

test('自定义库：按配置里的 role 判，内置那些名字不再特殊', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(
    path.join(dir, TAXONOMY_FILE),
    JSON.stringify({
      version: 1,
      dirs: [
        { name: '收件', purpose: 'x', role: 'inbox' },
        { name: '原始档', purpose: 'y', role: 'raw' },
        { name: 'sources', purpose: '这个库里 sources 是正经笔记目录' }
      ],
      frontMatter: { required: ['summary'] }
    })
  )
  assert.ok(isRawName(dir, '收件', (k) => k))
  assert.ok(isRawName(dir, '原始档', (k) => k))
  assert.ok(!isRawName(dir, 'sources', (k) => k), 'sources 在这个库里没有 raw 角色，不该被跳过')
})

test('中文老库里同时存在两套目录名时，两个都仍算原始素材区', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.mkdirSync(path.join(dir, '00-收件箱'))
  fs.mkdirSync(path.join(dir, '00-inbox'))
  // 两个都不该被当成笔记目录 —— 这是「老库一个字节不变」的一部分
  assert.ok(isRawName(dir, '00-收件箱', (k) => k))
  assert.ok(isRawName(dir, '00-inbox', (k) => k))
})
