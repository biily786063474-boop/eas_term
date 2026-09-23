import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const diagram = fs.readFileSync(new URL('./BlueprintDiagram.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./dict.css', import.meta.url), 'utf8')
test('blueprint areas show contextual page structure, not only uniform label rectangles', () => {
  for (const role of ['搜索','首屏','轮播','金刚区','列表','标签栏','图集','表单','侧边栏','表格','页脚'])
    assert.ok(diagram.includes(`'${role}'`), `${role} needs a distinctive wireframe`)
  assert.match(diagram, /bp-wireframe/)
  assert.match(diagram, /preview\s*\?/)
})
test('interactive main diagram has enough room and wireframe stays neutral', () => {
  assert.match(css, /\.bp-diagram\s*\{[^}]*height:2[1-5]\dpx/)
  const block = css.match(/\.bp-wireframe[^}]*\{([^}]*)\}/)?.[1] ?? ''
  assert.ok(block.includes('var(--t-3)'))
  assert.ok(!block.includes('--bp-color'))
})
