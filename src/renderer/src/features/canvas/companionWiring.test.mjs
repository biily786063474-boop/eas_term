import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const node = fs.readFileSync(new URL('./CanvasFileNode.tsx', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../plugins/PluginPanel.tsx', import.meta.url), 'utf8')
test('带 companion 的网页节点在网页上方渲染插件面板（embedded）', () => {
  assert.match(node, /pane\.companion/)
  assert.match(node, /<PluginPanel[\s\S]{0,200}embedded=/)
  assert.match(node, /className="cfile-companion"/)
})
test('embedded 面板不改节点尺寸', () => {
  const resize = panel.slice(panel.indexOf("case 'eas/panel.resize'"), panel.indexOf("case 'eas/panel.resize'") + 400)
  assert.match(resize, /embedded/)
})
test('flashNodeId 命中时节点加 flash 类', () => {
  assert.match(node, /flashNodeId === node\.id/)
})
