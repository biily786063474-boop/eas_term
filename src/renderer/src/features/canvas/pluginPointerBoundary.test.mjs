// 插件面板鼠标边界。
// 历史：2026-09-24 用户确认的旧规则是「未选中 iframe pointer-events:none，正文首击只选中」。
// 2026-09-29 用户改规则（C 改、B 不改）：iframe 始终接收指针，首击既选中又直接作用到面板内容；
// 未选中时滚轮仍然平移/缩放画布 —— 由宿主注入桥拦下滚轮转发给宿主。本测试钉住新规则。
// 修复轮 1（同日评审）：插件脚本能伪造桥消息 → 宿主加闸门（select 要求 iframe 持有焦点、
// wheel / 中键平移要求指针在该面板里）；中键平移经桥转发恢复（iframe 吞掉了 document 捕获的中键）。
// 修复轮 3：`:hover` 在 OOPIF 里恒为假（真机探针），改用宿主 document 捕获阶段记录的最后指针位置
// 落在节点框（外扩 8px）内 —— 指针在 iframe 里时父文档没有更新的 move。
// 修复轮 4：转发的滚轮会挪动节点、记录点停在进场处 → 只比实时框会漂出去。改为首次命中即「进场闩」
// （createPointerLatch，进场判定外扩改 48px：真机快速甩入一次 move 跨 30–50px），真实宿主 move / 失焦 /
// 离开窗口 / 卸载 / 被选中解闩；合成 move 不算。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const css=fs.readFileSync(new URL('./canvas.css',import.meta.url),'utf8')
const stage=fs.readFileSync(new URL('./CanvasStage.tsx',import.meta.url),'utf8')
const node=fs.readFileSync(new URL('./CanvasComponentNode.tsx',import.meta.url),'utf8')
const panel=fs.readFileSync(new URL('../plugins/PluginPanel.tsx',import.meta.url),'utf8')
const tracker=fs.readFileSync(new URL('../plugins/hostPointerTracker.ts',import.meta.url),'utf8')
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
 assert.match(bridge,/addEventListener\('pointerdown',function\(e\)\{[^\n]*canvas-select/)
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
 assert.match(panel,/canvasSelectDecision\(/) // 内含 100ms 去抖（acceptPanelSelect）
 assert.match(panel,/mergePanelWheel\(/)
 assert.match(panel,/requestAnimationFrame\(flushWheel\)/)
 // 不另写平移/缩放算法：合成 WheelEvent 在 iframe 元素上派发，冒泡进 CanvasStage 现有 onWheel
 assert.match(panel,/dispatchEvent\(new WheelEvent\('wheel'/)
 assert.doesNotMatch(panel,/zoomViewport|setViewport/)
 assert.match(panel,/ui\/notifications\/canvas-selected/)
})

test('host gates forged bridge messages: select needs focus (one-frame recheck), wheel/pan need the last host pointer inside the node',()=>{
 assert.match(panel,/canvasSelectDecision\(\{[^}]*focused: document\.activeElement === f/)
 assert.match(panel,/'recheck'[\s\S]{0,200}requestAnimationFrame/)
 assert.doesNotMatch(panel,/matches\(':hover'\)/)
 assert.match(panel,/canvasWheelAllowed\(\{[^}]*pointerIn: \(\) => pointerInPanel\(f\)/)
 assert.match(panel,/canvasPanStartAllowed\(\{[^}]*pointerIn: \(\) => pointerInPanel\(f\)/)
 // 用包住 iframe 的节点框，不用 iframe 自己的；走进场闩（每个面板实例一个稳定 id）
 assert.match(panel,/hostPointerGate\(latchId, \(f\.closest\('\.cfile-node'\) \?\? f\)\.getBoundingClientRect\(\)\)/)
 assert.doesNotMatch(panel,/lastHostPointer/)
 // 卸载与被选中都解本面板的闩
 assert.match(panel,/useEffect\(\(\) => \(\) => releaseHostPointerLatch\(latchId\)/)
 assert.match(panel,/if \(selectedForBridge\) releaseHostPointerLatch\(latchId\)/)
 // 追踪器只认真实 move（中键平移时宿主自己派发合成 mousemove，不能解闩）
 assert.match(tracker,/createPointerLatch\(\)/)
 assert.match(tracker,/if \(e\.isTrusted\) latch\.onHostMove\(e\)/)
 assert.match(tracker,/const clear = \(\): void => \{\s*latch\.onLeave\(\)/)
 // 单一 document 捕获阶段追踪器：pointermove + mousemove 记录，blur / mouseleave / pointerleave 清空
 assert.match(tracker,/addEventListener\('pointermove', record, true\)/)
 assert.match(tracker,/addEventListener\('mousemove', record, true\)/)
 assert.match(tracker,/window\.addEventListener\('blur', clear\)/)
 assert.match(tracker,/addEventListener\('mouseleave', clear\)/)
 assert.match(tracker,/addEventListener\('pointerleave', clear\)/)
})

test('middle-button pan over the panel reuses CanvasStage pan via synthetic events and releases iframe pointer',()=>{
 assert.match(bridge,/e\.button===1[^\n]*canvas-pan-start/)
 assert.match(bridge,/canvas-pan-move/)
 assert.match(bridge,/canvas-pan-end/)
 // 中键不再报 canvas-select
 assert.match(bridge,/if\(e\.button===1\)\{[^}]*canvas-pan-start[^}]*\}else post\('ui\/notifications\/canvas-select'\)/)
 // 宿主不另写平移：合成 mousedown(button 1) 进 CanvasStage 的 document 捕获中键监听，mousemove/mouseup 进 beginPan
 assert.match(panel,/new MouseEvent\('mousedown',[^)]*button: 1/)
 assert.match(panel,/new MouseEvent\('mousemove'/)
 assert.match(panel,/new MouseEvent\('mouseup'/)
 assert.doesNotMatch(panel,/beginPan\(|setViewport\(/)
 // 拖动期间 iframe 让出指针：beginPan 走共用画布拖拽（body.canvas-dragging，见 canvasDragWiring.test.mjs）
 assert.match(css,/body\.canvas-dragging \.plg-frame[^{}]*\{[^}]*pointer-events:\s*none/s)
 assert.match(stage,/if \(e\.button !== 1\) return[\s\S]{0,200}closest\?\.\('\.canvas-viewport'\)[\s\S]{0,120}beginPan\(e\.clientX, e\.clientY\)/)
})
