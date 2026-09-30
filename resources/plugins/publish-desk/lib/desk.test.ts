import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { PLATFORMS, xLength, joinTags } from './platforms.mjs'

function dataDir(t: import('node:test').TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-publish-desk-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
// 真起一个 server 进程走 stdio —— 和宿主拉起插件是同一条路
function client(t: import('node:test').TestContext, env: Record<string, string>) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', ...env } })
  t.after(() => child.kill())
  const pending = new Map<number, (v: any) => void>()
  let seq = 0
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line)
    pending.get(msg.id)?.(msg); pending.delete(msg.id)
  })
  const raw = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
    const id = ++seq
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} 超时`)) }, 3000).unref()
  })
  const tool = async (name: string, args: unknown = {}) => {
    const r = (await raw('tools/call', { name, arguments: args, _meta: { eas: { context: {} } } })).result
    if (r.isError) throw new Error(r.content[0].text)
    return r.structuredContent
  }
  return { raw, tool }
}

test('平台表：14 个平台，发布页都是 https，P1 正好是 X / 小红书 / B站，每条规则都有来源', () => {
  assert.equal(PLATFORMS.length, 14)
  assert.equal(new Set(PLATFORMS.map((p) => p.id)).size, 14)
  assert.deepEqual(PLATFORMS.filter((p) => p.p1).map((p) => p.id).sort(), ['bilibili', 'x', 'xiaohongshu'])
  for (const p of PLATFORMS) {
    assert.match(p.url, /^https:\/\//)
    for (const r of Object.values(p.rules) as any[]) { assert.match(r.source, /^https:\/\//); assert.equal(typeof r.verified, 'boolean') }
  }
})

test('X 计数：中文按 2、网址按 23', () => {
  assert.equal(xLength('abc'), 3)
  assert.equal(xLength('中文'), 4)
  assert.equal(xLength('看 https://eas.biily.top/download?very=long'), 2 + 1 + 23)
})

test('标签拼法跟平台走', () => {
  const by = (id: string) => PLATFORMS.find((p) => p.id === id)
  assert.equal(joinTags(['#AI', 'terminal'], by('x')), '#AI #terminal')
  assert.equal(joinTags(['AI', '终端'], by('bilibili')), 'AI,终端')
})

test('stdio：只暴露六个 desk_ 工具，面板资源可读', async (t) => {
  const { raw } = client(t, { EAS_PLUGIN_DATA: dataDir(t) })
  const init = await raw('initialize', { protocolVersion: '2025-06-18' })
  assert.equal(init.result.serverInfo.name, 'publish-desk')
  const tools = (await raw('tools/list')).result.tools.map((x: any) => x.name).sort()
  assert.deepEqual(tools, ['desk_add_batch', 'desk_archive', 'desk_list', 'desk_mark', 'desk_platforms', 'desk_update_card'])
  const res = (await raw('resources/read', { uri: 'ui://publish-desk/panel' })).result
  assert.match(res.contents[0].text, /<!doctype html>/i)
  assert.equal((await raw('panel/list')).error.code, -32601)
})

test('批次：默认 14 张卡，写文案、字数超限、标发布、已发布不能改', async (t) => {
  const dir = dataDir(t)
  const { tool } = client(t, { EAS_PLUGIN_DATA: dir })
  const b = await tool('desk_add_batch', { title: '内测发布', cards: [{ platform: 'x', body: '中'.repeat(141), tags: ['#AI'] }] })
  assert.equal(b.cards.length, 14)
  const x = b.cards.find((c: any) => c.platform === 'x')
  assert.equal(x.lengths.body, 282)
  assert.equal(x.lint[0].level, 'over')           // X 的 280 是官方值
  const xhs = await tool('desk_update_card', { batchId: b.batchId, platform: 'xiaohongshu', title: '字'.repeat(21), body: '下载 https://eas.biily.top' })
  assert.deepEqual(xhs.lint.map((l: any) => l.level), ['warn', 'warn'])   // 参考值 + 外链提醒，都只是提醒
  await tool('desk_mark', { batchId: b.batchId, platform: 'x', status: 'published', url: 'https://x.com/a/status/1' })
  await assert.rejects(tool('desk_update_card', { batchId: b.batchId, platform: 'x', body: '改' }), /已发布/)
  const listed = await tool('desk_list', { batchId: b.batchId })
  assert.equal(listed.batch.published, 1)
  assert.equal(listed.batch.cards.find((c: any) => c.platform === 'x').publishedUrl, 'https://x.com/a/status/1')
  // 落盘在宿主给的目录，不在项目里
  assert.ok(fs.existsSync(path.join(dir, 'publish-desk.json')))
  assert.ok(!fs.existsSync(path.join(dir, 'publish-desk.lock')))
})

test('拒绝：未知平台、同平台两张卡、相对素材路径、多余字段、非 http 链接', async (t) => {
  const { tool } = client(t, { EAS_PLUGIN_DATA: dataDir(t) })
  await assert.rejects(tool('desk_add_batch', { title: 'a', cards: [{ platform: 'weibo' }] }), /未知平台/)
  await assert.rejects(tool('desk_add_batch', { title: 'a', cards: [{ platform: 'x' }, { platform: 'x' }] }), /一张卡片/)
  await assert.rejects(tool('desk_add_batch', { title: 'a', cards: [{ platform: 'x', media: ['out/a.mp4'] }] }), /绝对路径/)
  await assert.rejects(tool('desk_add_batch', { title: 'a', extra: 1 }), /未授权字段/)
  const b = await tool('desk_add_batch', { title: 'a', platforms: ['x'] })
  assert.equal(b.cards.length, 1)
  await assert.rejects(tool('desk_mark', { batchId: b.batchId, platform: 'x', status: 'published', url: 'javascript:alert(1)' }), /http/)
})

test('没有宿主数据目录 / 数据目录是符号链接 / 文件损坏：都拒绝，且不覆盖原文件', async (t) => {
  await assert.rejects(client(t, {}).tool('desk_list'), /EAS_PLUGIN_DATA/)
  const real = dataDir(t), link = real + '-link'
  fs.symlinkSync(real, link); t.after(() => fs.rmSync(link, { force: true }))
  await assert.rejects(client(t, { EAS_PLUGIN_DATA: link }).tool('desk_list'), /符号链接/)
  fs.writeFileSync(path.join(real, 'publish-desk.json'), '{broken')
  const c = client(t, { EAS_PLUGIN_DATA: real })
  await assert.rejects(c.tool('desk_add_batch', { title: 'a' }), /损坏/)
  assert.equal(fs.readFileSync(path.join(real, 'publish-desk.json'), 'utf8'), '{broken')
})
