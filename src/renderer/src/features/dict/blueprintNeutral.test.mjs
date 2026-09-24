import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const css = fs.readFileSync(new URL('./dict.css', import.meta.url), 'utf8')
test('idle blueprint regions and thumbnail hover stay neutral', () => {
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim()
    if (!selector.includes('.bp-region>rect:first-child')) continue
    if (selector.includes('.is-active') || selector.includes('.is-selected') || selector.includes('.bp-region:focus-visible')) continue
    assert.ok(!rule[2].includes('--bp-color'), `idle region must not use its highlight color: ${selector}`)
  }
})
test('selected regions retain colored fill after pointer leaves', () => {
  const body = css.match(/\.bp-region\.is-selected>rect:first-child\s*\{([^}]+)\}/)?.[1]
  assert.match(body ?? '', /fill:color-mix\(in srgb,var\(--bp-color\)/)
})
