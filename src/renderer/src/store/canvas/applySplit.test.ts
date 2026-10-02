import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySplit } from './applySplit.ts'
import type { CanvasFrame } from './types.ts'

const parent: CanvasFrame = { id: 'p', projectId: 'proj', name: 'demo', x: 0, y: 0, w: 900, h: 600, collapsed: false, nodes: [] }
const geom = { HEAD: 34, PAD: 16, GAP: 22 } // = canvas/layout.ts 的值
let n = 0; const id = (p: string) => `${p}-${++n}`
const want = (key: string) => ({ key, url: `https://${key}.com`, companion: { panelId: 'cell', props: { platform: key } } })
const req = (keys: string[], published: string[] = []) => ({ pluginId: 'eas:publish-desk', parentFrameId: 'p', title: '发布分屏 · 测试', max: 6, cells: keys.map(want), published })

test('第一次：建一个带 owner 的子 Frame，放进格子并排版', () => {
  const r = applySplit([parent], req(['x', 'reddit']), 100, id, geom)!
  const sub = r.frames.find((f) => f.owner?.purpose === 'split')!
  assert.equal(sub.parentId, 'p')
  assert.equal(sub.name, '发布分屏 · 测试')
  assert.deepEqual(sub.nodes.map((x) => x.pane?.kind === 'web' && x.pane.companion?.key), ['x', 'reddit'])
  assert.deepEqual(r.result.opened, ['x', 'reddit'])
  assert.notEqual(sub.nodes[0].x, sub.nodes[1].x)
})

test('第二次：复用同一个子 Frame；已在的 reused；满了替换并就地换 url 与 companion', () => {
  const frames = applySplit([parent], req(['a', 'b', 'c', 'd', 'e', 'f']), 1, id, geom)!.frames
  const r = applySplit(frames, req(['a', 'g'], ['c']), 50, id, geom)!
  assert.equal(r.frames.filter((f) => f.owner?.purpose === 'split').length, 1)
  assert.deepEqual(r.result.reused, ['a'])
  assert.deepEqual(r.result.replaced, [{ out: 'c', in: 'g' }])
  const sub = r.frames.find((f) => f.owner)!
  const g = sub.nodes.find((x) => x.pane?.kind === 'web' && x.pane.companion?.key === 'g')!
  assert.equal(g.pane?.kind === 'web' && g.pane.url, 'https://g.com')
  assert.equal(sub.nodes.length, 6)
})

test('父 Frame 不存在返回 null', () => {
  assert.equal(applySplit([], req(['x']), 1, id, geom), null)
})
