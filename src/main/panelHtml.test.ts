import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PANEL_CSP, preparePanelHtml } from './panelHtml.ts'

test('正常 HTML → ok，带 CSP 响应头，并在插件脚本前加入画板修饰键桥', () => {
  const r = preparePanelHtml('<!doctype html><html><head><script>window.plugin=true</script></head><body>hi</body></html>')
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.headers['Content-Security-Policy'], PANEL_CSP)
  assert.equal(r.stripped, false)
  assert.ok(r.html.includes('hi'))
  assert.ok(r.html.indexOf('canvas-zoom-modifier') < r.html.indexOf('window.plugin=true'))
  assert.match(r.html, /ui\/notifications\/canvas-zoom-modifier/)
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

// 2026-09-29 用户改规则：插件面板首击直达。把注入桥真跑一遍（假 window），钉住行为而不只是字样。
function runBridge(): { fire: (type: string, e: Record<string, unknown>) => void; sent: unknown[]; parent: object } {
  const r = preparePanelHtml('<html><head></head><body></body></html>')
  assert.ok(r.ok)
  if (!r.ok) throw new Error('unreachable')
  const src = /<script>([\s\S]*?)<\/script>/.exec(r.html)![1]
  const listeners: Record<string, ((e: unknown) => void)[]> = {}
  const sent: unknown[] = []
  const parent = { postMessage: (m: unknown) => sent.push(m) }
  const add = (t: string, fn: (e: unknown) => void): void => { (listeners[t] ??= []).push(fn) }
  new Function('addEventListener', 'parent', src)(add, parent)
  return { sent, parent, fire: (type, e) => listeners[type]?.forEach((fn) => fn(e)) }
}

test('注入桥：pointerdown 发 canvas-select，且不拦截面板自己的处理', () => {
  const b = runBridge()
  let blocked = false
  const stop = (): void => { blocked = true }
  b.fire('pointerdown', { isTrusted: true, preventDefault: stop, stopPropagation: stop, stopImmediatePropagation: stop })
  assert.deepEqual(b.sent, [{ jsonrpc: '2.0', method: 'ui/notifications/canvas-select' }])
  assert.equal(blocked, false)
  b.fire('pointerdown', { isTrusted: false })
  assert.equal(b.sent.length, 1)
})

test('注入桥：默认未选中 → wheel preventDefault 并转发；宿主下发已选中后不拦，面板自己滚', () => {
  const b = runBridge()
  let prevented = 0
  const wheel = { isTrusted: true, deltaX: 1, deltaY: 2, deltaMode: 0, ctrlKey: true, metaKey: false, clientX: 3, clientY: 4, preventDefault: () => prevented++ }
  b.fire('wheel', wheel)
  assert.equal(prevented, 1)
  assert.deepEqual(b.sent, [{ jsonrpc: '2.0', method: 'ui/notifications/canvas-wheel', params: { deltaX: 1, deltaY: 2, deltaMode: 0, ctrlKey: true, metaKey: false, clientX: 3, clientY: 4 } }])
  let swallowed = false
  const selected = (v: boolean, source: object): Record<string, unknown> => ({
    source,
    data: { jsonrpc: '2.0', method: 'ui/notifications/canvas-selected', params: { selected: v } },
    stopImmediatePropagation: () => { swallowed = true }
  })
  // 不是 parent 发来的不算数
  b.fire('message', selected(true, {}))
  b.fire('wheel', wheel)
  assert.equal(prevented, 2)
  // 宿主说已选中 → 不拦截、不转发；这条宿主通知不交给插件脚本
  b.fire('message', selected(true, b.parent))
  assert.equal(swallowed, true)
  b.fire('wheel', wheel)
  assert.equal(prevented, 2)
  assert.equal(b.sent.length, 2)
  // 取消选中 → 恢复拦截
  b.fire('message', selected(false, b.parent))
  b.fire('wheel', wheel)
  assert.equal(prevented, 3)
  // 合成事件（插件自己 dispatch 的）不转发
  b.fire('wheel', { ...wheel, isTrusted: false })
  assert.equal(prevented, 3)
})
