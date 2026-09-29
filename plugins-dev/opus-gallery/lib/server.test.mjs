// 真 spawn server，本地起假上游，照 resources/plugins/timeline/lib/server.test.ts 的做法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url))

test('stdio：工具表、列表、图片、详情、注入、预设、面板资源', async (t) => {
  const up = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${up.address().port}`
    if (req.url === '/videos.json') {
      res.setHeader('etag', '"v1"')
      return res.end(JSON.stringify([
        { slug: 'a-1', author: 'u1', category: 'motion', post_url: 'https://x.com/u1/status/1', poster_url: `${base}/p/a-1.webp`, prompt: '做一个粒子片头', prompt_partial: false, tech_tags: ['canvas'], added: '2026-09-20' },
        { slug: 'b-2', author: 'u2', category: '3d', post_url: '', poster_url: '', prompt: '3D 城市', prompt_partial: true, tech_tags: ['threejs'], added: '2026-09-21' }
      ]))
    }
    if (req.url === '/p/a-1.webp') return res.end('POSTER')
    if (req.url === '/m/a-1/preview.webp') return res.end('PREVIEW')
    res.statusCode = 404
    res.end()
  })
  await new Promise((r) => up.listen(0, '127.0.0.1', r))
  t.after(() => up.close())
  const base = `http://127.0.0.1:${up.address().port}`
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opus-srv-'))
  t.after(() => fs.rmSync(data, { recursive: true, force: true }))

  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, EAS_PLUGIN_DATA: data, OPUS_GALLERY_DATA_URL: `${base}/videos.json`, OPUS_GALLERY_MEDIA_BASE: `${base}/m` } })
  t.after(() => p.kill())
  const pending = new Map()
  let seq = 0
  createInterface({ input: p.stdout }).on('line', (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id) })
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(Error(`rpc timeout ${method}`)), 5000)
    pending.set(id, (m) => { clearTimeout(timer); resolve(m) })
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result

  assert.equal((await rpc('initialize')).result.serverInfo.name, 'opus-gallery')
  const names = (await rpc('tools/list')).result.tools.map((x) => x.name)
  assert.deepEqual(names, ['gallery_show', 'gallery_list', 'gallery_images', 'gallery_detail', 'gallery_compose', 'gallery_presets', 'gallery_preset_save', 'gallery_preset_delete'])

  const list = (await call('gallery_list', {})).structuredContent
  assert.deepEqual([list.all, list.total, list.offline], [2, 2, false])
  assert.deepEqual(list.items.map((i) => i.slug), ['b-2', 'a-1'])
  assert.equal(list.items[0].prompt, undefined, '列表不带全文提示词')
  assert.equal((await call('gallery_list', { category: '3d' })).structuredContent.total, 1)

  const imgs = (await call('gallery_images', { kind: 'poster', slugs: ['a-1', 'b-2', 'nope'] })).structuredContent.images
  assert.equal(imgs['a-1'], 'data:image/webp;base64,' + Buffer.from('POSTER').toString('base64'))
  assert.deepEqual([imgs['b-2'], imgs.nope], ['', ''])
  const prev = (await call('gallery_images', { kind: 'preview', slugs: ['a-1'] })).structuredContent.images
  assert.equal(prev['a-1'], 'data:image/webp;base64,' + Buffer.from('PREVIEW').toString('base64'))
  assert.equal((await call('gallery_images', { kind: 'poster', slugs: Array(13).fill('a-1') })).isError, true)

  const d = (await call('gallery_detail', { slug: 'b-2' })).structuredContent
  assert.deepEqual([d.prompt, d.partial], ['3D 城市', true])
  assert.equal((await call('gallery_detail', { slug: 'zzz' })).isError, true)

  const presets = (await call('gallery_presets')).structuredContent.presets
  assert.equal(presets[0].id, 'eas-promo')
  const c = (await call('gallery_compose', { slug: 'a-1', topic: '笔纵发布', presetId: 'eas-promo' })).structuredContent
  assert.equal(c.label, '@u1 风格')
  assert.match(c.text, /为「笔纵发布」/)
  assert.match(c.text, /附加约束（Eas-Term 宣传片规范）/)
  assert.equal((await call('gallery_compose', { slug: 'a-1', topic: 'x', presetId: 'gone' })).isError, true)

  const saved = (await call('gallery_preset_save', { name: '克制', text: '少动' })).structuredContent.presets
  assert.equal(saved.length, 2)
  assert.ok(fs.existsSync(path.join(data, 'presets.json')))
  const left = (await call('gallery_preset_delete', { id: saved[1].id })).structuredContent.presets
  assert.equal(left.length, 1)

  const res = (await rpc('resources/read', { uri: 'ui://opus-gallery/panel' })).result.contents[0]
  assert.equal(res.mimeType, 'text/html;profile=mcp-app')
  assert.match(res.text, /<!doctype html>/i)
  assert.equal((await rpc('nope')).error.code, -32601)
})
