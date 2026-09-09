import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('../../features/canvas/canvas.css', import.meta.url), 'utf8')
test('badge hover gradient is a fixed hollow rounded edge, never an expanding full-surface layer', () => {
  const rule = css.match(/\.cfile-badge::after\s*\{([^}]+)\}/)?.[1] ?? ''
  assert.match(rule, /inset:\s*0\s*;/)
  assert.match(rule, /border-radius:\s*inherit/)
  assert.match(rule, /padding:\s*1\.5px/)
  assert.match(rule, /mask-composite:\s*exclude/)
  assert.match(rule, /content-box/)
  assert.match(rule, /pointer-events:\s*none/)
  const animation = css.slice(css.indexOf('@keyframes cfile-badge-smoke'))
  assert.doesNotMatch(animation.slice(0, animation.indexOf('\n}\n') + 3), /transform:/,
    'transforming the hollow mask moves the colored edge across the logo interior')
  assert.match(css, /animation:\s*cfile-badge-smoke 950ms linear;/)
})
