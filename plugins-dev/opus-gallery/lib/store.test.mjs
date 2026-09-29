import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from './store.mjs'

const DATA = 'https://data.test/videos.json'
const entry = (n) => ({ slug: `a-${n}`, author: `u${n}`, category: 'motion', post_url: '', poster_url: `https://m.test/p/${n}.webp`, prompt: `p${n}`, prompt_partial: false, tech_tags: [], added: '2026-09-20' })
const body = JSON.stringify([entry(1), entry(2)])

function res(status, text = '', headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer }
}
function fake(routes) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url, headers: init.headers ?? {} })
    const h = routes[url]
    if (!h) throw new Error('offline')
    return h(init)
  }
  f.calls = calls
  return f
}
function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'opus-store-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

test('首次同步写缓存与 etag；下次带 If-None-Match，304 用缓存', async (t) => {
  const dir = tmp(t)
  const a = createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, body, { etag: '"v1"' }) }) })
  assert.equal((await a.ensure()).length, 2)
  assert.equal(fs.readFileSync(path.join(dir, 'etag'), 'utf8'), '"v1"')
  const f = fake({ [DATA]: () => res(304) })
  const b = createStore({ dir, dataUrl: DATA, fetchImpl: f })
  assert.equal((await b.ensure()).length, 2)
  assert.equal(f.calls[0].headers['If-None-Match'], '"v1"')
  assert.equal(b.status().offline, false)
})

test('上游失败但有缓存 → 离线模式，给出原因', async (t) => {
  const dir = tmp(t)
  await createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, body) }) }).ensure()
  const s = createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(502) }) })
  assert.equal((await s.ensure()).length, 2)
  assert.deepEqual(s.status(), { offline: true, lastError: '上游返回 502', all: 2 })
})

test('首次失败且无缓存 → 抛出说人话的错误', async (t) => {
  const s = createStore({ dir: tmp(t), dataUrl: DATA, fetchImpl: fake({}) })
  await assert.rejects(s.ensure(), /拉取作品清单失败：offline/)
})

test('上游给了空清单或坏 JSON 不覆盖旧缓存', async (t) => {
  const dir = tmp(t)
  await createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, body) }) }).ensure()
  const s = createStore({ dir, dataUrl: DATA, fetchImpl: fake({ [DATA]: () => res(200, '[]') }) })
  assert.equal((await s.ensure()).length, 2)
  assert.equal(s.status().offline, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8')).length, 2)
})

test('并发 ensure 只拉一次', async (t) => {
  const f = fake({ [DATA]: () => res(200, body) })
  const s = createStore({ dir: tmp(t), dataUrl: DATA, fetchImpl: f })
  await Promise.all([s.ensure(), s.ensure(), s.sync()])
  assert.equal(f.calls.length, 1)
})

test('图片：下载一次后走磁盘；失败、非 2xx、超大都给空串', async (t) => {
  const f = fake({
    [DATA]: () => res(200, body),
    'https://m.test/p/1.webp': () => res(200, 'IMG'),
    'https://m.test/p/2.webp': () => res(404),
    'https://media.test/a-1/preview.webp': () => res(200, 'X'.repeat(50))
  })
  const s = createStore({ dir: tmp(t), dataUrl: DATA, mediaBase: 'https://media.test', fetchImpl: f, maxImageBytes: 10 })
  const [e1, e2] = await s.ensure()
  const byslug = (x) => (x.slug === 'a-1' ? x : null)
  const one = [e1, e2].find(byslug)
  const two = [e1, e2].find((x) => x.slug === 'a-2')
  assert.equal(await s.image('poster', one), 'data:image/webp;base64,' + Buffer.from('IMG').toString('base64'))
  const before = f.calls.length
  await s.image('poster', one)
  assert.equal(f.calls.length, before, '第二次应读磁盘')
  assert.equal(await s.image('poster', two), '')
  assert.equal(await s.image('preview', one), '', '超过 maxImageBytes')
  assert.equal(await s.image('preview', two), '', '没有路由 = 网络失败')
})
