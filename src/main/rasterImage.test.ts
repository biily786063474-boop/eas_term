import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateRasterImage } from './rasterImage.ts'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
test('local image validator enforces raster format, guardPath and real project containment', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raster 安全 ')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const project = path.join(root, 'project'), other = path.join(root, 'other'); fs.mkdirSync(project); fs.mkdirSync(other)
  fs.writeFileSync(path.join(project, 'ok.png'), png); fs.writeFileSync(path.join(other, 'outside.png'), png)
  fs.writeFileSync(path.join(project, 'fake.png'), '<html><script>fetch("https://example.test")</script></html>')
  fs.writeFileSync(path.join(project, 'vector.svg'), '<svg/>')
  const calls: unknown[] = []
  const guards = { path: (p: unknown) => { calls.push(p); return { ok: true, path: String(p) } }, directory: (p: unknown) => ({ ok: true, path: String(p) }) }
  assert.deepEqual(await validateRasterImage('ok.png', [project], guards), { path: fs.realpathSync(path.join(project, 'ok.png')) })
  assert.ok(calls.includes(path.join(project, 'ok.png')))
  for (const input of ['../other/outside.png', 'fake.png', 'vector.svg', 'page.html', 'movie.mp4', 'https://example.test/a.png', '//server/share/a.png']) await assert.rejects(validateRasterImage(input, [project], guards), { name: /Error/ }, input)
  fs.symlinkSync(path.join(other, 'outside.png'), path.join(project, 'escape.png'))
  await assert.rejects(validateRasterImage('escape.png', [project], guards), /当前会话项目/)
  await assert.rejects(validateRasterImage('ok.png', [project], { ...guards, path: () => ({ ok: false, error: 'guard-denied' }) }), /guard-denied/)
})
