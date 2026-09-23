import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { rowLetterSpacing } from './rowLetterSpacing.ts'

const css = postcss.parse(readFileSync(new URL('./dict.css', import.meta.url), 'utf8'))
const declarations = (selector) => {
  let result = {}
  css.walkRules(selector, (rule) => {
    result = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]))
  })
  return result
}

test('气泡间距固定，不用 space-between 或气泡伸长补齐', () => {
  assert.equal(declarations('.dict-list')['gap'], '8px')
  assert.equal(declarations('.dict-pill')['flex-grow'], '0')
  assert.notEqual(declarations('.dict-list')['justify-content'], 'space-between')
})

test('仅完整行按文字字数分配余宽，末行保留原字距', () => {
  const rows = [[{ width: 50, chars: 2 }, { width: 60, chars: 2 }, { width: 70, chars: 3 }], [{ width: 50, chars: 2 }]]
  const spacing = rowLetterSpacing(rows, 220, 8)
  assert.ok(Math.abs(spacing[0] - 24 / 7) < 0.001)
  assert.equal(spacing[1], 0)
})
