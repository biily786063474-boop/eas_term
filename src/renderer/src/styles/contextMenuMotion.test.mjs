import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const css = postcss.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'base.css'), 'utf8'))

test('双击与右键共用菜单有入场微动效，减少动态效果时关闭', () => {
  let entrance = null
  let reduced = null
  css.walkRules((rule) => {
    if (!rule.selectors?.includes('.canvas-ctxmenu')) return
    const animation = rule.nodes.find((node) => node.type === 'decl' && node.prop === 'animation')
    if (!animation) return
    if (rule.parent.type === 'atrule' && rule.parent.params.includes('prefers-reduced-motion')) reduced = animation.value
    else entrance = animation.value
  })
  assert.match(entrance ?? '', /cctx-enter/)
  assert.equal(reduced, 'none')
})
