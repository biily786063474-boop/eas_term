import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const component = readFileSync(new URL('./CanvasComponentNode.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./canvas.css', import.meta.url), 'utf8')
const selection = await import('./pluginPanelClick.ts').catch(() => null)

test('a short left click counts, but dragging or non-left clicking does not', () => {
  assert.ok(selection?.isPluginPanelClick, 'plugin panel click classifier is missing')
  const start = { x: 100, y: 100, button: 0 }
  assert.equal(selection.isPluginPanelClick(start, { x: 103, y: 104 }), true)
  assert.equal(selection.isPluginPanelClick(start, { x: 110, y: 100 }), false)
  assert.equal(selection.isPluginPanelClick({ ...start, button: 1 }, { x: 100, y: 100 }), false)
  assert.equal(selection.isPluginPanelClick(null, { x: 100, y: 100 }), false)
})

test('unselected plugin body stays click-through until mouseup, then selects without stealing canvas drag', () => {
  assert.match(css, /\.cfile-node\[data-kind='c-plugin-panel'\]:not\(\.sel\)\s+\.plg-frame[^{}]*\{[^}]*pointer-events:\s*none/s)
  assert.match(component, /onMouseDownCapture=\{\(e\) => \{[\s\S]*?closest\('\.cfile-body'\)[\s\S]*?pluginBodyDown\.current[\s\S]*?return/)
  assert.match(component, /onClickCapture=\{\(e\) => \{[\s\S]*?isPluginPanelClick\(pluginBodyDown\.current,[\s\S]*?onSelect\?\.\(e\.shiftKey\)/)
})

test('the activation click does not also run a loading or retry control inside the panel body', () => {
  assert.match(component, /onClickCapture=\{\(e\) => \{[\s\S]*?isPluginPanelClick\(pluginBodyDown\.current,[\s\S]*?e\.stopPropagation\(\)[\s\S]*?e\.preventDefault\(\)/)
})

test('plugin header controls can select the node without changing other component controls', () => {
  assert.match(component, /comp\.type === 'plugin-panel' \|\| !\(e\.target as HTMLElement\)\.closest\('button, input'\)/)
})
