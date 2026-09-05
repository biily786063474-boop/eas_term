import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PANEL_CSP, preparePanelHtml } from './panelHtml.ts'

test('正常 HTML → ok，带 CSP 响应头，不改内容', () => {
  const r = preparePanelHtml('<!doctype html><html><body>hi</body></html>')
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.headers['Content-Security-Policy'], PANEL_CSP)
  assert.equal(r.stripped, false)
  assert.ok(r.html.includes('hi'))
})

test('CSP 里没有任何外连口子：connect-src none、frame-src none、default-src none', () => {
  assert.match(PANEL_CSP, /connect-src 'none'/)
  assert.match(PANEL_CSP, /frame-src 'none'/)
  assert.match(PANEL_CSP, /default-src 'none'/)
  assert.doesNotMatch(PANEL_CSP, /https?:/)
})

test('超过上限 → 拒，说明里带 KB 数', () => {
  const r = preparePanelHtml('x'.repeat(600 * 1024))
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.why, /KB/)
})

test('空串 → 拒', () => {
  assert.equal(preparePanelHtml('   ').ok, false)
})

test('HTML 自带的 CSP meta 被剥掉（头才是唯一的 CSP），并标记 stripped', () => {
  const r = preparePanelHtml('<head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>t</title></head>')
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.stripped, true)
  assert.doesNotMatch(r.html, /Content-Security-Policy/i)
  assert.match(r.html, /<title>t<\/title>/)
})
