// 2026-09-29 用户改规则：插件面板 iframe 始终接收指针，首击直达面板内容；
// 未选中时滚轮由注入桥转发回宿主驱动画布。这里钉住宿主侧的纯函数：坐标换算与限流。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CANVAS_SELECT_DEBOUNCE_MS,
  WHEEL_DELTA_MAX,
  acceptPanelSelect,
  canvasPanStartAllowed,
  canvasSelectDecision,
  canvasWheelAllowed,
  iframePointToHost,
  panPointFromScreen,
  parsePanelPan,
  mergePanelWheel,
  parsePanelWheel,
  type PanelWheel
} from './panelPointerBridge.ts'

test('iframe 坐标换算成宿主坐标：画布缩放 1 / 0.5 / 2', () => {
  // 画布缩放 1：rect 与 iframe 自身尺寸相同，只加偏移
  assert.deepEqual(iframePointToHost({ x: 10, y: 20 }, { left: 100, top: 50, width: 400, height: 300 }, { w: 400, h: 300 }), { x: 110, y: 70 })
  // 画布缩放 0.5：iframe 被 transform 缩到一半，iframe 内 (100,60) 在宿主里只走了 (50,30)
  assert.deepEqual(iframePointToHost({ x: 100, y: 60 }, { left: 100, top: 50, width: 200, height: 150 }, { w: 400, h: 300 }), { x: 150, y: 80 })
  // 画布缩放 2
  assert.deepEqual(iframePointToHost({ x: 100, y: 60 }, { left: -40, top: 10, width: 800, height: 600 }, { w: 400, h: 300 }), { x: 160, y: 130 })
})

test('iframe 尺寸为 0（还没布局）时按 1:1 换算，不产出 NaN/Infinity', () => {
  const p = iframePointToHost({ x: 5, y: 7 }, { left: 1, top: 2, width: 0, height: 0 }, { w: 0, h: 0 })
  assert.deepEqual(p, { x: 6, y: 9 })
})

test('parsePanelWheel 只收有限数字，布尔字段取严格 true，delta 夹到上限', () => {
  const ok = parsePanelWheel({ deltaX: 3, deltaY: -4, deltaMode: 0, ctrlKey: true, metaKey: 'yes', clientX: 1, clientY: 2 })
  assert.deepEqual(ok, { deltaX: 3, deltaY: -4, deltaMode: 0, ctrlKey: true, metaKey: false, clientX: 1, clientY: 2 })
  assert.equal(parsePanelWheel(null), null)
  assert.equal(parsePanelWheel({ deltaX: NaN, deltaY: 0, deltaMode: 0, clientX: 0, clientY: 0 }), null)
  assert.equal(parsePanelWheel({ deltaX: 0, deltaY: 0, deltaMode: 7, clientX: 0, clientY: 0 }), null)
  assert.equal(parsePanelWheel({ deltaX: 0, deltaY: '1', deltaMode: 0, clientX: 0, clientY: 0 }), null)
  const big = parsePanelWheel({ deltaX: 1e9, deltaY: -1e9, deltaMode: 0, clientX: 0, clientY: 0 })
  assert.equal(big?.deltaX, WHEEL_DELTA_MAX)
  assert.equal(big?.deltaY, -WHEEL_DELTA_MAX)
})

const w = (o: Partial<PanelWheel>): PanelWheel => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, ...o })

test('mergePanelWheel：同一帧内同类滚轮合并 delta，取最新坐标', () => {
  const a = mergePanelWheel(null, w({ deltaY: 10, clientX: 1 }))
  assert.equal(a.flush, null)
  const b = mergePanelWheel(a.pending, w({ deltaX: 2, deltaY: 5, clientX: 9 }))
  assert.equal(b.flush, null)
  assert.deepEqual(b.pending, w({ deltaX: 2, deltaY: 15, clientX: 9 }))
})

test('mergePanelWheel：合并后也夹在上限内（插件刷消息推不动画布太远）', () => {
  let p: PanelWheel | null = null
  for (let i = 0; i < 50; i++) p = mergePanelWheel(p, w({ deltaY: 900 })).pending
  assert.equal(p?.deltaY, WHEEL_DELTA_MAX)
})

test('mergePanelWheel：缩放与平移、不同 deltaMode 不混在一起 —— 先把旧的吐出来', () => {
  const pan = w({ deltaY: 10 })
  const zoom = w({ deltaY: 3, ctrlKey: true })
  const r = mergePanelWheel(pan, zoom)
  assert.deepEqual(r.flush, pan)
  assert.deepEqual(r.pending, zoom)
  const r2 = mergePanelWheel(pan, w({ deltaY: 1, deltaMode: 1 }))
  assert.deepEqual(r2.flush, pan)
})

test('acceptPanelSelect：首次立即放行，100ms 内的重复丢弃', () => {
  assert.equal(CANVAS_SELECT_DEBOUNCE_MS, 100)
  assert.equal(acceptPanelSelect(null, 1000), true)
  assert.equal(acceptPanelSelect(1000, 1050), false)
  assert.equal(acceptPanelSelect(1000, 1099), false)
  assert.equal(acceptPanelSelect(1000, 1100), true)
})

// ── 修复轮 1（2026-09-29 评审）：插件脚本能自己 postMessage 伪造 canvas-select / canvas-wheel，
// 桥里的 isTrusted 挡不住。宿主侧再加一道「真有人在操作这个 iframe」的闸门。

test('canvasSelectDecision：焦点在本 iframe 才选中；还没到就下一帧再看一次，仍不在则丢弃', () => {
  const base = { popup: false, selected: false, focused: true, recheck: false, lastAt: null, now: 1000 }
  assert.equal(canvasSelectDecision(base), 'accept')
  assert.equal(canvasSelectDecision({ ...base, focused: false }), 'recheck')
  assert.equal(canvasSelectDecision({ ...base, focused: false, recheck: true }), 'drop')
  assert.equal(canvasSelectDecision({ ...base, recheck: true }), 'accept')
  assert.equal(canvasSelectDecision({ ...base, popup: true }), 'drop')
  assert.equal(canvasSelectDecision({ ...base, selected: true }), 'drop')
  // 去抖仍在：插件自己聚焦着也刷不动
  assert.equal(canvasSelectDecision({ ...base, lastAt: 950 }), 'drop')
})

test('canvasWheelAllowed：只在未选中、非弹窗、且指针确实悬停在本 iframe 上时驱动画布', () => {
  assert.equal(canvasWheelAllowed({ popup: false, selected: false, hovered: true }), true)
  assert.equal(canvasWheelAllowed({ popup: false, selected: false, hovered: false }), false)
  assert.equal(canvasWheelAllowed({ popup: false, selected: true, hovered: true }), false)
  assert.equal(canvasWheelAllowed({ popup: true, selected: false, hovered: true }), false)
})

test('canvasPanStartAllowed：中键平移只要悬停（与画布「模块上按中键也能拖」一致，不看选中）', () => {
  assert.equal(canvasPanStartAllowed({ popup: false, hovered: true }), true)
  assert.equal(canvasPanStartAllowed({ popup: false, hovered: false }), false)
  assert.equal(canvasPanStartAllowed({ popup: true, hovered: true }), false)
})

test('parsePanelPan：只收有限数字；buttons 缺省按 0', () => {
  assert.deepEqual(parsePanelPan({ clientX: 1, clientY: 2, screenX: 3, screenY: 4, buttons: 4 }), { clientX: 1, clientY: 2, screenX: 3, screenY: 4, buttons: 4 })
  assert.deepEqual(parsePanelPan({ clientX: 1, clientY: 2, screenX: 3, screenY: 4 }), { clientX: 1, clientY: 2, screenX: 3, screenY: 4, buttons: 0 })
  assert.equal(parsePanelPan({ clientX: 1, clientY: 2, screenX: Infinity, screenY: 4 }), null)
  assert.equal(parsePanelPan(null), null)
})

test('panPointFromScreen：拖动中用屏幕坐标差推宿主坐标 —— 画布平移会挪动 iframe，iframe 坐标会自激', () => {
  const start = { hostX: 300, hostY: 200, screenX: 1000, screenY: 800 }
  assert.deepEqual(panPointFromScreen(start, { screenX: 1000, screenY: 800 }), { x: 300, y: 200 })
  assert.deepEqual(panPointFromScreen(start, { screenX: 1040, screenY: 770 }), { x: 340, y: 170 })
})
