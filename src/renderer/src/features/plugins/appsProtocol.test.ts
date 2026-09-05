import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasCallAllowed,
  clampPanelSize,
  initializeResult,
  methodNotFound,
  resourceUriOfTool,
  routeViewMessage
} from './appsProtocol.ts'
import { APPS_PROTOCOL_VERSION } from '../../../../shared/pluginProtocol.ts'

const ctx = { nodeId: 'n1', frameId: 'f1', projectId: 'p1', cwd: '/x' }

test('握手前只放 ui/initialize 和 ping，其它请求 drop 且带 id（好回错误）', () => {
  const r = routeViewMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} }, false)
  assert.equal(r.kind, 'drop')
  if (r.kind === 'drop') assert.equal(r.id, 7)
  assert.equal(routeViewMessage({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} }, false).kind, 'request')
  assert.equal(routeViewMessage({ jsonrpc: '2.0', id: 2, method: 'ping' }, false).kind, 'request')
})

test('握手后：白名单内的请求/通知放行，白名单外 drop', () => {
  assert.equal(routeViewMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }, true).kind, 'request')
  assert.equal(routeViewMessage({ jsonrpc: '2.0', id: 1, method: 'eas/canvas.call', params: {} }, true).kind, 'request')
  assert.equal(routeViewMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: {} }, true).kind, 'notification')
  assert.equal(routeViewMessage({ jsonrpc: '2.0', id: 1, method: 'evil/rm', params: {} }, true).kind, 'drop')
  assert.equal(routeViewMessage({ jsonrpc: '2.0', method: 'evil/notify' }, true).kind, 'drop')
})

test('不是 JSON-RPC 2.0 的一律 drop（别的库也往 parent postMessage）', () => {
  assert.equal(routeViewMessage({ type: 'react-devtools' }, true).kind, 'drop')
  assert.equal(routeViewMessage('str', true).kind, 'drop')
  assert.equal(routeViewMessage(null, true).kind, 'drop')
})

test('initializeResult：协议版本、hostInfo、eas 扩展只在 _meta.eas 下', () => {
  const r = initializeResult(ctx, 'dark', ['canvas_open_file'], '0.4.79')
  assert.equal(r.protocolVersion, APPS_PROTOCOL_VERSION)
  assert.deepEqual(r.hostInfo, { name: 'eas-term', version: '0.4.79' })
  const hc = r.hostContext as Record<string, unknown>
  assert.equal(hc.theme, 'dark')
  assert.deepEqual((hc._meta as { eas: { context: unknown } }).eas.context, ctx)
  const caps = r.hostCapabilities as Record<string, unknown>
  assert.ok(caps.openLinks && caps.serverTools)
})

test('**eas/canvas.call 双白名单**：宿主允许 ∩ 清单声明，缺一边都不放', () => {
  assert.equal(canvasCallAllowed('canvas_open_file', ['canvas_open_file']), true)
  assert.equal(canvasCallAllowed('canvas_open_file', []), false, '清单没声明')
  assert.equal(canvasCallAllowed('canvas_open_file', undefined), false)
  assert.equal(canvasCallAllowed('canvas_snapshot', ['canvas_snapshot']), false, '宿主全局不允许，清单声明了也不行')
})

test('resourceUriOfTool：1.7.x 的 _meta["ui/resourceUri"] 优先，兼容老的 _meta.ui.resourceUri，非 ui:// 不认', () => {
  assert.equal(resourceUriOfTool({ _meta: { 'ui/resourceUri': 'ui://a/b' } }), 'ui://a/b')
  assert.equal(resourceUriOfTool({ _meta: { ui: { resourceUri: 'ui://old' } } }), 'ui://old')
  assert.equal(resourceUriOfTool({ _meta: { 'ui/resourceUri': 'https://x' } }), null)
  assert.equal(resourceUriOfTool({}), null)
})

test('clampPanelSize：夹在 [240,1200]，非数字保持当前值', () => {
  assert.deepEqual(clampPanelSize({ w: 10, h: 5000 }, { w: 460, h: 340 }), { w: 240, h: 1200 })
  assert.deepEqual(clampPanelSize({ w: 'x' }, { w: 460, h: 340 }), { w: 460, h: 340 })
})

test('methodNotFound 用标准 -32601（别的宿主也这么回）', () => {
  const e = methodNotFound(3, 'x') as { error: { code: number } }
  assert.equal(e.error.code, -32601)
})
