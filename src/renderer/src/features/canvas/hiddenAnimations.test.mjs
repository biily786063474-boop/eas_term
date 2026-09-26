import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('最大化隐藏画布时暂停空 Frame 光环动画', () => {
  const css = readFileSync(new URL('./canvas.css', import.meta.url), 'utf8')
  assert.ok(/\.canvas-world\.hidden-by-max\s+\.cframe-start-ring::before\s*\{[^}]*animation-play-state:\s*paused/s.test(css), 'hidden canvas must pause ambient frame rings')
})
