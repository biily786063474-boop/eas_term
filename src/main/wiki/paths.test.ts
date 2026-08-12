import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { isRawName, rawDirOf, TAXONOMY_FILE } from './taxonomy.ts'

// paths.ts 引了 electron，node --test 加载不了它 —— 判定逻辑本身放在 taxonomy.ts
// 里（isRawName / rawDirOf），paths.ts 的 isRawDir / archiveDirOf 只是转发。这个文件
// 钉住「原始素材区判定」「归档落点解析」这两条行为，直接调真实导出，不在测试里
// 重写一遍判定逻辑（那样测的是测试自己）。

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

// ── rawDirOf（paths.ts 的 archiveDirOf 转发的就是它）：wiki:archive 的归档落点解析 ──
// Critical 1：旧代码在 wiki:archive 里固定拼 dirOf(root,'sources')，对自定义库不成立，
// 会凭空建一个配置外的 sources/。这里钉住新行为：无配置逐字等价、有配置按 role:"raw"、
// 没有 raw 目录时明确失败而不是兜底出一个目录名。

test('rawDirOf：无配置 → 落点是 sources，和以前 sourcesOf = dirOf(root,"sources") 逐字等价', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const r = rawDirOf(dir, (k) => k)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.name, 'sources')
})

test('rawDirOf：无配置的老库（中文目录名）落点跟着 resolve 回落，不是写死的 sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const r = rawDirOf(dir, (k) => (k === 'sources' ? '素材' : k))
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.name, '素材')
})

test('rawDirOf：自定义库有 role:"raw" 目录 → 落点是那个目录，不是凭空的 sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(
    path.join(dir, TAXONOMY_FILE),
    JSON.stringify({
      version: 1,
      dirs: [
        { name: '收件', purpose: 'x', role: 'inbox' },
        { name: '素材库', purpose: '原始录音与文章存档', role: 'raw' },
        { name: '课题', purpose: 'y' }
      ],
      frontMatter: { required: ['summary'] }
    })
  )
  const r = rawDirOf(dir, (k) => k)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.name, '素材库')
})

test('rawDirOf：多个 role:"raw" 目录时取第一个（配置顺序即优先级）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(
    path.join(dir, TAXONOMY_FILE),
    JSON.stringify({
      version: 1,
      dirs: [
        { name: '收件', purpose: 'x', role: 'inbox' },
        { name: '录音', purpose: 'a', role: 'raw' },
        { name: '文章', purpose: 'b', role: 'raw' }
      ],
      frontMatter: { required: ['summary'] }
    })
  )
  const r = rawDirOf(dir, (k) => k)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.name, '录音')
})

test('rawDirOf：自定义库没有任何 role:"raw" 目录 → 明确失败，不凭空造目录名', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(
    path.join(dir, TAXONOMY_FILE),
    JSON.stringify({
      version: 1,
      dirs: [
        { name: '收件', purpose: 'x', role: 'inbox' },
        { name: '课题', purpose: 'y' }
      ],
      frontMatter: { required: ['summary'] }
    })
  )
  const r = rawDirOf(dir, (k) => k)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /role.*raw/, '错误信息要点明缺的是 role:"raw"，用户才知道去补什么')
})
