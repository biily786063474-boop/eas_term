import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { validateTaxonomy, readTaxonomy, taxonomyState, TAXONOMY_FILE, libraryDirs, BUILTIN_DIRS } from './taxonomy.ts'

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

// Critical 2：wiki:query 返回给 agent 的 library 字段就是 readTaxonomy(root)?.dirs——
// 老库必须不出现这个字段（首要不变量：老库响应形状不能变），自定义库要给出配置里
// 逐条的 name/purpose/role，agent 端（MCP 工具描述 + skills）靠它而不是 dirs 判断东西往哪放。
test('wiki:query 的 library 字段数据源：没有配置 → readTaxonomy 是 null，library 不该出现', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const t = readTaxonomy(dir)
  assert.equal(t, null, '老库不能凭空多出 library 字段——调用方是用 `t ? {library: t.dirs} : {}` 这种展开式判断的')
})

test('wiki:query 的 library 字段数据源：有配置 → dirs 逐条给到 name/purpose/role，形状与 WikiQueryResult.library 一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), JSON.stringify(GOOD))
  const t = readTaxonomy(dir)
  assert.notEqual(t, null)
  assert.deepEqual(t?.dirs, [
    { name: '00-收件箱', purpose: '还没整理的原始素材', role: 'inbox' },
    { name: '课题', purpose: '一个课题一篇' },
    { name: '_模板', purpose: '新建笔记的模板', role: 'templates' }
  ])
})

// ── taxonomyState：三态判定（Important 3）──────────────────────────────
//
// readTaxonomy 把「没有配置」和「配置在但读不出来」都压成同一个 null，initWiki
// 靠这个函数才能把两者分开：前者照常回落内置八目录（老库的日常状态，必须不受影响），
// 后者必须整个停手，不能建目录、不能改说明书——回落会把自定义库真的改写成内置形状，
// 不可逆。下面钉住三态各自的判据，以及「老库不受影响」这条最重要的边界。

test('taxonomyState：没有配置文件（老库的日常状态）→ none，不是 broken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const s = taxonomyState(dir)
  assert.equal(s.kind, 'none')
})

test('taxonomyState：库目录本身都还不存在 → 同样是 none（建库前第一次调用的样子）', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-')), '还没建出来的子目录')
  const s = taxonomyState(dir)
  assert.equal(s.kind, 'none')
})

test('taxonomyState：合法配置 → valid，value 就是校验通过后的那份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), JSON.stringify(GOOD))
  const s = taxonomyState(dir)
  assert.equal(s.kind, 'valid')
  if (s.kind === 'valid') assert.equal(s.value.dirs[0].name, '00-收件箱')
})

test('taxonomyState：不是合法 JSON → broken，不是 none（这是本次新增的第三态）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), '{ 这不是 JSON')
  const s = taxonomyState(dir)
  assert.equal(s.kind, 'broken')
  if (s.kind === 'broken') assert.ok(s.error.length > 0, '要给人能看懂的原因，界面靠它提示')
})

test('taxonomyState：JSON 合法但校验不过（比如缺 inbox）→ broken，error 复用 validateTaxonomy 的原话', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const noInbox = { ...GOOD, dirs: GOOD.dirs.map((d) => ({ ...d, role: d.role === 'inbox' ? undefined : d.role })) }
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), JSON.stringify(noInbox))
  const s = taxonomyState(dir)
  assert.equal(s.kind, 'broken')
  if (s.kind === 'broken') assert.match(s.error, /收件箱/)
})

test('taxonomyState：文件在但读不出来（权限）→ broken，不是 none——「没配过」和「配坏了」不能混成一种', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root 不受文件权限限制，这条断不出区别')
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const file = path.join(dir, TAXONOMY_FILE)
  fs.writeFileSync(file, JSON.stringify(GOOD))
  fs.chmodSync(file, 0o000)
  try {
    const s = taxonomyState(dir)
    assert.equal(s.kind, 'broken', '文件明明在，不该被判成「没配过」而悄悄回落')
  } finally {
    fs.chmodSync(file, 0o644) // 恢复权限，不影响系统清理临时目录
  }
})

test('readTaxonomy：JSON 合法但校验不过 → 同样是 null（三态里 valid 之外都收敛成 null，老调用点不用改）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  const noInbox = { ...GOOD, dirs: GOOD.dirs.map((d) => ({ ...d, role: d.role === 'inbox' ? undefined : d.role })) }
  fs.writeFileSync(path.join(dir, TAXONOMY_FILE), JSON.stringify(noInbox))
  assert.equal(readTaxonomy(dir), null)
})

test('老库不受影响：没有配置文件时，taxonomyState 和 readTaxonomy 的判断完全一致（都是「没有」）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'))
  assert.equal(taxonomyState(dir).kind, 'none')
  assert.equal(readTaxonomy(dir), null)
})
