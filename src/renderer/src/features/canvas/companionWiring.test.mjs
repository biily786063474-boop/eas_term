import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const node = fs.readFileSync(new URL('./CanvasFileNode.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./canvas.css', import.meta.url), 'utf8')
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
test('flashNodeId 命中时节点加 flash 类；只订阅布尔（闪一次不重渲染全部文件节点）', () => {
  assert.match(node, /useStore\(\(s\) => s\.flashNodeId === node\.id\)/)
  assert.doesNotMatch(node, /useStore\(\(s\) => s\.flashNodeId\)/)
})
test('embedded 面板的 size-changed 通知也不改节点尺寸', () => {
  assert.match(panel, /r\.method === 'ui\/notifications\/size-changed' && !embedded/)
})
test('openSplit 加格后用 reflowSeparate（父 Frame 长大不压住下面的 Frame）', () => {
  const slice = fs.readFileSync(new URL('../../store/canvasSlice.ts', import.meta.url), 'utf8')
  const body = slice.slice(slice.indexOf('openSplit: (req) =>'), slice.indexOf('flashNode: (nodeId) =>'))
  assert.match(body, /reflowSeparate\(r\.frames\)/)
  assert.doesNotMatch(body, /reflowFrames\(/)
})
test('embedded 不改节点名；加载/出错时不渲染文字与重试，出错通知宿主', () => {
  assert.match(panel, /if \(!popup && !embedded && \(/)
  assert.match(panel, /onUnavailable/)
  assert.match(panel, /state\.k === 'loading'\) return embedded \? null/)
  assert.match(panel, /if \(embedded\) return null/)
})
test('插件不可用时 CanvasFileNode 收起头条', () => {
  assert.match(node, /companionOff/)
  assert.match(node, /onUnavailable=\{/)
  assert.match(node, /pane\.companion && !companionOff/)
})
test('头条单独抬一层（position + z-index），否则画布缩放下点击被宿主吞掉', () => {
  const rule = css.match(/\.cfile-companion \{[^}]*\}/)?.[0] ?? ''
  assert.match(rule, /position: relative/)
  assert.match(rule, /z-index: \d+/)
})
