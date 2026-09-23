import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const css = postcss.parse(readFileSync(new URL('./workspace.css', import.meta.url), 'utf8'))
const palette = (selector) => {
  let values = {}
  css.walkRules(selector, (rule) => {
    values = Object.fromEntries(rule.nodes.filter((n) => n.type === 'decl' && n.prop.startsWith('--vault-')).map((n) => [n.prop, n.value]))
  })
  return values
}
const rgb = (hex) => hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16))

test('暗色密钥弹窗使用与应用一致的冷色层级，亮色独立保留', () => {
  const dark = palette('.vault-backdrop')
  const light = palette('[data-theme="light"] .vault-backdrop')
  for (const key of ['--vault-surface', '--vault-soft']) {
    const [r, g, b] = rgb(dark[key])
    assert.ok(b >= r + 8 && b >= g + 5, `${key} 应为冷蓝黑，不是中性灰：${dark[key]}`)
  }
  assert.equal(dark['--vault-text'], '#e2e4ea')
  assert.equal(dark['--vault-muted'], '#969aa8')
  assert.equal(light['--vault-surface'], '#ffffff')
  assert.equal(light['--vault-soft'], '#f3f3f3')
})
