import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRegistry } from './pluginRegistry.ts'

const OPTS = { allowedHosts: ['eas.biily.top'] }
const entry = (over = {}) => ({
  name: 'board', displayName: '看板', description: '三栏看板', category: 'Productivity',
  brandColor: '#5E6AD2', version: '1.0.0',
  url: 'https://eas.biily.top/plugins/board/board-1.0.0.zip',
  sha256: 'a'.repeat(64), size: 6421, permissions: { canvas: ['canvas_open_file'] }, ...over
})

test('合法 registry：条目完整解出，字段带过', () => {
  const r = parseRegistry({ schema: 1, updated: '2026-09-15T00:00:00Z', plugins: [entry()] }, OPTS)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.entries.length, 1)
  assert.deepEqual({ name: r.entries[0].name, version: r.entries[0].version, sha256: r.entries[0].sha256, size: r.entries[0].size },
    { name: 'board', version: '1.0.0', sha256: 'a'.repeat(64), size: 6421 })
  assert.deepEqual(r.entries[0].permissions, { canvas: ['canvas_open_file'] })
})

test('整份格式错才拒：非对象 / schema 不对 / plugins 非数组', () => {
  assert.equal(parseRegistry(null, OPTS).ok, false)
  assert.equal(parseRegistry({ schema: 2, plugins: [] }, OPTS).ok, false)
  assert.equal(parseRegistry({ schema: 1, plugins: {} }, OPTS).ok, false)
})

test('坏条目丢弃 + warning，好条目保留（同 parseManifest 原则）', () => {
  const r = parseRegistry({ schema: 1, plugins: [
    entry(),
    entry({ name: 'Bad_Name' }),                 // name 非法
    entry({ name: 'nover', version: 'v1' }),      // version 非 semver
    entry({ name: 'badhash', sha256: 'xyz' }),    // sha256 格式错
    entry({ name: 'badsize', size: -1 }),         // size 非正整数
    entry({ name: 'nourl', url: 42 })             // url 缺失/非串
  ] }, OPTS)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.entries.map((e) => e.name), ['board'])
  assert.equal(r.warnings.length, 5)
})

test('下载地址必须 https + 在允许域名内，否则丢弃', () => {
  const r = parseRegistry({ schema: 1, plugins: [
    entry({ name: 'httponly', url: 'http://eas.biily.top/x.zip' }),         // 非 https
    entry({ name: 'evil', url: 'https://evil.com/x.zip' }),                 // 域名不在白名单
    entry({ name: 'oss', url: 'https://cdn.biily.top/x.zip' })              // 也不在（第一步只允 eas.biily.top）
  ] }, OPTS)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.entries.length, 0)
  assert.equal(r.warnings.length, 3)
  // 切到 OSS 域名后：把域名加进 allowedHosts 即可放行
  const r2 = parseRegistry({ schema: 1, plugins: [entry({ name: 'oss', url: 'https://cdn.biily.top/x.zip' })] }, { allowedHosts: ['eas.biily.top', 'cdn.biily.top'] })
  assert.equal(r2.ok && r2.entries.length, 1)
})

test('重名条目：保留第一个，后者丢弃 + warning', () => {
  const r = parseRegistry({ schema: 1, plugins: [entry({ version: '1.0.0' }), entry({ version: '2.0.0' })] }, OPTS)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.entries.length, 1)
  assert.equal(r.entries[0].version, '1.0.0')
  assert.equal(r.warnings.length, 1)
})
