import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const css = postcss.parse(readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8'))
const component = readFileSync(new URL('./Tooltip.tsx', import.meta.url), 'utf8')

test('气泡出现上移、消失下移各 200 毫秒，减少动态效果时立即隐藏', () => {
  const animations = new Map()
  css.walkRules((rule) => {
    if (!rule.selectors?.some((s) => s.startsWith('.app-tooltip'))) return
    const animation = rule.nodes.find((node) => node.type === 'decl' && node.prop === 'animation')
    if (animation) animations.set(rule.selector, animation.value)
  })
  assert.match(animations.get('.app-tooltip') ?? '', /app-tooltip-in 200ms/)
  assert.match(animations.get('.app-tooltip.leaving') ?? '', /app-tooltip-out 200ms/)
  assert.match(component, /const EXIT_MS = 200/)
  assert.match(component, /prefers-reduced-motion: reduce/)
  assert.match(component, /className=\{`app-tooltip\$\{tip\.above \? ' above' : ''\}\$\{leaving \? ' leaving' : ''\}`\}/)
  assert.match(component, /document\.addEventListener\('focusin', onFocusIn, true\)/)
  assert.match(component, /document\.addEventListener\('focusout', onFocusOut, true\)/)
})
