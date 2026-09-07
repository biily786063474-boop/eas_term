import { test } from 'node:test'
import assert from 'node:assert/strict'
import { externalResourceUrl, resourcePanel } from './resourceLink.ts'
import type { PluginInfo } from '../../../../shared/types.ts'
test('跨 harness 和历史资源只开放无凭证 HTTP(S)，面板资源不外跳', () => {
  assert.equal(externalResourceUrl('https://example.com/report'), 'https://example.com/report')
  for (const uri of ['javascript:alert(1)', 'file:///tmp/a', 'ui://panel', 'https://user:pw@example.com', '/tmp/a']) assert.equal(externalResourceUrl(uri), null)
})
test('资源仅映射到选中插件的已声明面板', () => {
  const plugin: PluginInfo = { id:'eas:test', cli:'eas', name:'test', displayName:'Test', root:'/tmp', panels:[{id:'report',title:'Report',entry:'ui://test/report',defaultSize:{w:500,h:400}}] }
  assert.equal(resourcePanel('ui://test/report', plugin.id, [plugin])?.panel.id, 'report')
  assert.equal(resourcePanel('ui://test/unknown', plugin.id, [plugin]), undefined)
  assert.equal(resourcePanel('ui://test/report', 'eas:other', [plugin]), undefined)
  assert.equal(resourcePanel('https://test/report', plugin.id, [plugin]), undefined)
})
