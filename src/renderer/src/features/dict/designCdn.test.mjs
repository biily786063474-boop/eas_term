import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('all 307 design previews use the owned HTTPS CDN and preserve local covers', () => {
  const previews = JSON.parse(readFileSync(new URL('./design-previews.json', import.meta.url)))
  assert.equal(Object.keys(previews).length, 307)
  for (const [slug, entry] of Object.entries(previews)) {
    const url = new URL(entry.previewUrl)
    assert.equal(url.origin, 'https://design.biily.top', slug)
    assert.ok(url.pathname.startsWith('/cdn-mirror/template-kits/'), slug)
    assert.ok(entry.cover === '' || entry.cover === `design-covers/${slug}.jpg`, slug)
  }
})
