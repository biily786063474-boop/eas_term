// 插件面板鼠标边界。
// 历史：2026-09-24 用户确认的旧规则是「未选中 iframe pointer-events:none，正文首击只选中」。
// 2026-09-29 用户改规则（C 改、B 不改）：iframe 始终接收指针，首击既选中又直接作用到面板内容；
// 未选中时滚轮仍然平移/缩放画布 —— 由宿主注入桥拦下滚轮转发给宿主。本测试钉住新规则。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const css=fs.readFileSync(new URL('./canvas.css',import.meta.url),'utf8')
const stage=fs.readFileSync(new URL('./CanvasStage.tsx',import.meta.url),'utf8')
const node=fs.readFileSync(new URL('./CanvasComponentNode.tsx',import.meta.url),'utf8')
const panel=fs.readFileSync(new URL('../plugins/PluginPanel.tsx',import.meta.url),'utf8')
const bridge=fs.readFileSync(new URL('../../../../main/panelHtml.ts',import.meta.url),'utf8')

test('2026-09-29: unselected plugin iframe no longer releases pointer; Ctrl zoom and resize still do',()=>{
 assert.doesNotMatch(css,/:not\(\.sel\)\s+\.plg-frame/)
 assert.match(css,/\.canvas-zoom-modifier[^{}]*\.cfile-node\[data-kind='c-plugin-panel'\][^{}]*\.plg-frame[^{}]*\{[^}]*pointer-events:\s*none/s)
 assert.match(css,/\.plg-frame\.plg-zoom-modifier[^{}]*\{[^}]*pointer-events:\s*none/s)
 assert.match(css,/body\.canvas-resizing \.plg-frame[^{}]*\{[^}]*pointer-events:\s*none/s)
 assert.match(stage,/classList\.add\('canvas-zoom-modifier'\)/)
 assert.match(stage,/classList\.remove\('canvas-zoom-modifier'\)/)
 assert.match(panel,/classList\.toggle\('plg-zoom-modifier', modifier\.params\.pressed\)/)
 // 旧的「正文首击只选中」路径已删
 assert.doesNotMatch(node,/pluginPanelClick|pluginBodyDown|onClickCapture/)
})

test('injected bridge: pointerdown posts canvas-select, wheel preventDefault only while unselected',()=>{
 assert.match(bridge,/addEventListener\('pointerdown',function\(e\)\{[^}]*canvas-select/)
 assert.match(bridge,/addEventListener\('wheel',function\(e\)\{if\(sel\|\|!e\.isTrusted\)return;e\.preventDefault\(\)[^}]*canvas-wheel/)
 assert.match(bridge,/\{capture:true,passive:false\}/)
 assert.match(bridge,/ui\/notifications\/canvas-selected/)
 // 默认按未选中处理
 assert.match(bridge,/var sel=false/)
 // pointerdown 不拦面板自己的处理
 assert.doesNotMatch(bridge,/pointerdown[^\n]*(preventDefault|stopPropagation)/)
})

test('host only trusts its own iframe, rate-limits select/wheel and replays via the existing canvas wheel entry',()=>{
 assert.match(panel,/e\.source !== f\.contentWindow/)
 assert.match(panel,/acceptPanelSelect\(/)
 assert.match(panel,/mergePanelWheel\(/)
 assert.match(panel,/requestAnimationFrame\(flushWheel\)/)
 // 不另写平移/缩放算法：合成 WheelEvent 在 iframe 元素上派发，冒泡进 CanvasStage 现有 onWheel
 assert.match(panel,/dispatchEvent\(new WheelEvent\('wheel'/)
 assert.doesNotMatch(panel,/zoomViewport|setViewport/)
 assert.match(panel,/ui\/notifications\/canvas-selected/)
})
