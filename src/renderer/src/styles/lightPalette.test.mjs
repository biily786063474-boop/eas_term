import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const css = fs.readFileSync(new URL('./base.css', import.meta.url), 'utf8')
const light = css.split(":root[data-theme='light'] {")[1].split('\n}')[0]
const value = name => light.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]
test('light surfaces separate canvas, inset and raised content without changing brand', () => {
  assert.equal(value('bg'), '#fafafa')
  assert.equal(value('s-1'), '#f3f3f3')
  assert.equal(value('pane-solid'), '#ffffff')
  assert.equal(value('t-1'), '#0d0d0d')
  assert.equal(value('accent'), '#2f3338')
})
test('light auxiliary text remains legible on inset surfaces', () => {
  assert.equal(value('t-3'), '#737373')
})
