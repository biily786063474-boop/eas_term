import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { validateTaxonomy, readTaxonomy, TAXONOMY_FILE, libraryDirs, BUILTIN_DIRS } from './taxonomy.ts'

const GOOD = {
  version: 1,
  dirs: [
    { name: '00-收件箱', purpose: '还没整理的原始素材', role: 'inbox' },
    { name: '课题', purpose: '一个课题一篇' },
    { name: '_模板', purpose: '新建笔记的模板', role: 'templates' }
  ],
  frontMatter: { required: ['summary', 'tags'], optional: ['status'] }
}

test('合法配置通过校验，并补齐 optional 默认值', () => {
  const r = validateTaxonomy(GOOD)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.value.dirs.length, 3)
  assert.deepEqual(r.value.frontMatter.optional, ['status'])
})

test('缺 optional 时补成空数组', () => {
  const r = validateTaxonomy({ ...GOOD, frontMatter: { required: ['summary'] } })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.value.frontMatter.optional, [])
})

test('没有 inbox 角色 → 拒绝', () => {
  const dirs = GOOD.dirs.map((d) => ({ ...d, role: d.role === 'inbox' ? undefined : d.role }))
  const r = validateTaxonomy({ ...GOOD, dirs })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error, /收件箱/)
})

test('两个 inbox 角色 → 拒绝', () => {
  const dirs = [...GOOD.dirs, { name: '另一个', purpose: 'x', role: 'inbox' }]
  const r = validateTaxonomy({ ...GOOD, dirs })
  assert.equal(r.ok, false)
})

test('目录名带斜杠 / 点开头 / 撞配置文件名 → 拒绝', () => {
  for (const bad of ['a/b', '.hidden', TAXONOMY_FILE]) {
    const dirs = [...GOOD.dirs, { name: bad, purpose: 'x' }]
    const r = validateTaxonomy({ ...GOOD, dirs })
    assert.equal(r.ok, false, `应该拒绝：${bad}`)
  }
})

test('重名目录 → 拒绝', () => {
  const dirs = [...GOOD.dirs, { name: '课题', purpose: '重复的' }]
  assert.equal(validateTaxonomy({ ...GOOD, dirs }).ok, false)
})

test('purpose 为空 → 拒绝（它要写进 agent 说明书，空的等于没说）', () => {
  const dirs = [...GOOD.dirs, { name: '新目录', purpose: '   ' }]
  assert.equal(validateTaxonomy({ ...GOOD, dirs }).ok, false)
})

test('readTaxonomy：文件不存在 → null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  assert.equal(readTaxonomy(dir), null)
})

test('readTaxonomy：JSON 坏了 → null（回落到内置，不能让库打不开）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), '{ 这不是 JSON')
  assert.equal(readTaxonomy(dir), null)
})

test('readTaxonomy：合法文件 → 解析出来', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), JSON.stringify(GOOD))
  const t = readTaxonomy(dir)
  assert.notEqual(t, null)
  assert.equal(t?.dirs[0].name, '00-收件箱')
})

test('没有配置 → 内置八目录，顺序与名字都不变', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const got = libraryDirs(dir, (k) => k)
  assert.deepEqual(got.map((d) => d.name), [
    '00-inbox', 'me', 'people', 'methods', 'domains', 'projects', 'sources', '_templates'
  ])
  assert.equal(got.find((d) => d.role === 'inbox')?.name, '00-inbox')
})

test('没有配置时 resolve 生效（老库中文名回落）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const got = libraryDirs(dir, (k) => (k === '00-inbox' ? '00-收件箱' : k))
  assert.equal(got[0].name, '00-收件箱')
  assert.equal(got[0].role, 'inbox')
})

test('有配置 → 用配置的，resolve 不介入', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), JSON.stringify({
    version: 1,
    dirs: [{ name: '收件', purpose: 'x', role: 'inbox' }, { name: '课题', purpose: 'y' }],
    frontMatter: { required: ['summary'] }
  }))
  const got = libraryDirs(dir, () => '不该被调用')
  assert.deepEqual(got.map((d) => d.name), ['收件', '课题'])
})

test('内置八目录每个都有非空 purpose', () => {
  for (const d of BUILTIN_DIRS) assert.ok(d.purpose.trim().length > 0, d.name)
})
