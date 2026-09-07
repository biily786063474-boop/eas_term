import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeToolContent } from './toolResult.ts'
test('MCP 混合内容保留文本、资源名称及未知类型的降级信息', () => {
  const r = normalizeToolContent([{ type: 'text', text: '报告' }, { type: 'resource_link', uri: 'https://example.com/report', name: '查看报告' }, { type: 'image', data: 'fixture' }], 'raw')
  assert.match(r.output, /报告/)
  assert.match(r.output, /fixture/)
  assert.equal(r.resources?.[0].uri, 'https://example.com/report')
})
test('危险和带凭证链接不成为可打开资源，ui 资源保留标识', () => {
  const r = normalizeToolContent(['javascript:alert(1)', 'https://a:b@example.com/', 'ui://panel/report'].map(uri => ({ type: 'resource_link', uri })), '')
  assert.deepEqual(r.resources?.map(r => r.uri), ['ui://panel/report'])
})
