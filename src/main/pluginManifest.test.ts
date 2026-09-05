import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest } from './pluginManifest.ts'

const DIR = '/x/plugins/board'
const good = (): Record<string, unknown> => ({
  name: 'board',
  displayName: '看板',
  brandColor: '#5E6AD2',
  mcp: { command: 'node', args: ['./server.mjs'], env: { A: '1' } },
  panels: [{ id: 'main', title: '看板', tool: 'board_show', entry: 'ui://board/panel', defaultSize: { w: 460, h: 340 } }],
  permissions: { canvas: ['canvas_open_file', 'canvas_snapshot'] }
})

test('合法清单 → PluginInfo：id 带 eas: 前缀、args 相对路径按目录解开、mcpServers 故意为空', () => {
  const r = parseManifest(good(), DIR, { exists: () => true })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.info.id, 'eas:board')
  assert.equal(r.info.cli, 'eas')
  assert.deepEqual(r.info.mcp?.args, ['/x/plugins/board/server.mjs'])
  assert.equal(r.info.mcp?.cwd, DIR)
  assert.equal(r.info.mcpServers, undefined)
  assert.equal(r.info.panels?.[0].entry, 'ui://board/panel')
})

test('permissions.canvas 与宿主白名单取交集：不认识的丢掉 + warning，不整份拒', () => {
  const r = parseManifest(good(), DIR)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.info.permissions?.canvas, ['canvas_open_file'])
  assert.ok(r.warnings.some((w) => w.includes('canvas_snapshot')))
})

test('name 与目录名不一致 → 拒', () => {
  const r = parseManifest({ ...good(), name: 'kanban' }, DIR)
  assert.equal(r.ok, false)
})

test('name 含非法字符（../）→ 拒，不碰文件系统', () => {
  const r = parseManifest({ ...good(), name: '../etc' }, DIR)
  assert.equal(r.ok, false)
})

test('mcp.command 缺 → 拒', () => {
  const m = good()
  m.mcp = { args: [] }
  assert.equal(parseManifest(m, DIR).ok, false)
})

test('mcp.args 里的相对路径跳出目录 → 拒', () => {
  const m = good()
  m.mcp = { command: 'node', args: ['../../evil.js'] }
  assert.equal(parseManifest(m, DIR).ok, false)
})

test('panels.entry 既不是 ui:// 也不在目录内 → 拒；目录内相对路径 → 通过', () => {
  const bad = good()
  ;(bad.panels as Record<string, unknown>[])[0].entry = '/etc/passwd'
  assert.equal(parseManifest(bad, DIR).ok, false)
  const ok = good()
  ;(ok.panels as Record<string, unknown>[])[0].entry = 'ui/panel.html'
  assert.ok(parseManifest(ok, DIR).ok)
})

test('defaultSize 夹在 [240,1200]，缺省 460×340', () => {
  const m = good()
  ;(m.panels as Record<string, unknown>[])[0].defaultSize = { w: 10, h: 99999 }
  const r = parseManifest(m, DIR)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.info.panels?.[0].defaultSize, { w: 240, h: 1200 })
  const m2 = good()
  delete (m2.panels as Record<string, unknown>[])[0].defaultSize
  const r2 = parseManifest(m2, DIR)
  assert.ok(r2.ok && r2.info.panels?.[0].defaultSize.w === 460)
})

test('composerIcon：目录内且存在才给 iconPath；不存在 → warning 不拒', () => {
  const m = { ...good(), composerIcon: './ui/icon.svg' }
  const r1 = parseManifest(m, DIR, { exists: () => true })
  assert.ok(r1.ok && r1.info.iconPath === '/x/plugins/board/ui/icon.svg')
  const r2 = parseManifest(m, DIR, { exists: () => false })
  assert.ok(r2.ok && r2.info.iconPath === undefined && r2.warnings.length > 0)
})

test('builtin 标记透传', () => {
  const r = parseManifest(good(), DIR, { builtin: true })
  assert.ok(r.ok && r.info.builtin === true)
})
