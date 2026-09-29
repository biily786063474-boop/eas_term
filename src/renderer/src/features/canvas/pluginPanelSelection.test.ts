// 插件面板的选中。2026-09-29 用户改规则：未选中时第一下点击既选中节点、又直接作用到面板内容
//（「做同款」、点卡片一次到位）。代价是不能再从面板正文起手框选 / 空格平移，只能从标题栏或空白画布起手。
// 旧的 pluginPanelClick.ts（正文短点击只选中、不进 iframe）已删除。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const component = readFileSync(new URL('./CanvasComponentNode.tsx', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../plugins/PluginPanel.tsx', import.meta.url), 'utf8')

test('the body-only "first click just selects" classifier is gone', () => {
  assert.equal(existsSync(new URL('./pluginPanelClick.ts', import.meta.url)), false)
  assert.doesNotMatch(component, /isPluginPanelClick|pluginBodyDown/)
})

test('first click inside the iframe selects via the bridge, with the same store actions as the node click', () => {
  // 与 CanvasStage 给 CanvasComponentNode 的 onSelect 同一套：toggleCanvasSel(非累加) + clearPhoneNode
  assert.match(panel, /const handleSelect = \(recheck: boolean\)[\s\S]*?toggleCanvasSel\(selKey, false\)[\s\S]*?clearPhoneNode\(ctx\.nodeId\)/)
  assert.match(panel, /method === 'ui\/notifications\/canvas-select'\) \{\s*handleSelect\(false\)/)
  // 弹窗形态不碰画布选中
  assert.match(panel, /if \(!popup && msg\?\.jsonrpc === '2\.0' && msg\.method === 'ui\/notifications\/canvas-select'\)/)
})

test('plugin header controls can select the node without changing other component controls', () => {
  assert.match(component, /comp\.type === 'plugin-panel' \|\| !\(e\.target as HTMLElement\)\.closest\('button, input'\)/)
})
