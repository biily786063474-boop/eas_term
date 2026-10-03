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
  const oldC = frames.find((f) => f.owner)!.nodes.find((x) => x.pane?.kind === 'web' && x.pane.companion?.key === 'c')!
  const r = applySplit(frames, req(['a', 'g'], ['c']), 50, id, geom)!
  assert.equal(r.frames.filter((f) => f.owner?.purpose === 'split').length, 1)
  assert.deepEqual(r.result.reused, ['a'])
  assert.deepEqual(r.result.replaced, [{ out: 'c', in: 'g' }])
  const sub = r.frames.find((f) => f.owner)!
  const g = sub.nodes.find((x) => x.pane?.kind === 'web' && x.pane.companion?.key === 'g')!
  assert.equal(g.pane?.kind === 'web' && g.pane.url, 'https://g.com')
  assert.equal(sub.nodes.length, 6)
  assert.notEqual(g.id, oldC.id)
  assert.ok(!sub.nodes.some((x) => x.id === oldC.id))
})

test('父 Frame 不存在返回 null', () => {
  assert.equal(applySplit([], req(['x']), 1, id, geom), null)
})

test('第一个格子落在 (PAD, HEAD+PAD)', () => {
  const sub = applySplit([parent], req(['x', 'reddit']), 100, id, geom)!.frames.find((f) => f.owner)!
  assert.equal(sub.nodes[0].x, geom.PAD)
  assert.equal(sub.nodes[0].y, geom.HEAD + geom.PAD)
})

// 2026-10-02 终审：key 只用平台 id 时，换批次后旧批次的 X 格被当成新批次的 X 格复用，头条还拿着旧 batchId。
// 发布台改为 key = 「批次:平台」，这里钉住：同平台、不同批次的旧格子不复用，满格时它是被替换的那格。
test('换批次：旧批次同平台的格子不复用，满格时作为被替换的格子', () => {
  const wantOf = (batch: string, platform: string) => ({ key: `${batch}:${platform}`, url: `https://${platform}.com`, companion: { panelId: 'cell', props: { batchId: batch, platform } } })
  const reqOf = (batch: string, platforms: string[], published: string[] = []) => ({ pluginId: 'eas:publish-desk', parentFrameId: 'p', title: `发布分屏 · ${batch}`, max: 6, cells: platforms.map((p) => wantOf(batch, p)), published: published.map((p) => `${batch}:${p}`) })
  const frames = applySplit([parent], reqOf('A', ['x', 'zhihu', 'reddit', 'bluesky', 'threads', 'douyin']), 1, id, geom)!.frames
  const oldX = frames.find((f) => f.owner)!.nodes.find((x) => x.pane?.kind === 'web' && x.pane.companion?.key === 'A:x')!
  const r = applySplit(frames, reqOf('B', ['x']), 50, id, geom)!
  assert.deepEqual(r.result.reused, [])
  assert.deepEqual(r.result.opened, [])
  assert.deepEqual(r.result.replaced, [{ out: 'A:x', in: 'B:x' }]) // A 批次最早打开的就是 A:x
  const sub = r.frames.find((f) => f.owner)!
  const newX = sub.nodes.find((x) => x.pane?.kind === 'web' && x.pane.companion?.key === 'B:x')!
  assert.deepEqual(newX.pane?.kind === 'web' && newX.pane.companion?.props, { batchId: 'B', platform: 'x' })
  assert.notEqual(newX.id, oldX.id)
  assert.ok(!sub.nodes.some((x) => x.pane?.kind === 'web' && x.pane.companion?.key === 'A:x'))
})
test('换批次、没满格：新批次的格子新开，旧批次的格子留着（之后满格时可被替换）', () => {
  const w = (key: string) => ({ ...want(key), companion: { panelId: 'cell', props: { key } } })
  const frames = applySplit([parent], { ...req([]), cells: [w('A:x'), w('A:zhihu')] }, 1, id, geom)!.frames
  const r = applySplit(frames, { ...req([]), cells: [w('B:x')] }, 50, id, geom)!
  assert.deepEqual(r.result.reused, [])
  assert.deepEqual(r.result.opened, ['B:x'])
  assert.equal(r.frames.find((f) => f.owner)!.nodes.length, 3)
})

test('分屏 Frame 里格子超过 6 个（旧存档等异常）：再次打开不抛错；最近的 6 格排进槽位，最早的原位不动', () => {
  let frames = applySplit([parent], req(['a', 'b', 'c', 'd', 'e', 'f']), 1, id, geom)!.frames
  const sub = frames.find((f) => f.owner)!
  const extra = { ...sub.nodes[0], id: 'dup-1', x: 9999, y: 8888, pane: { ...(sub.nodes[0].pane as object), companion: { ...((sub.nodes[0].pane as { companion: object }).companion), key: 'a-copy', openedAt: 99 } } } as typeof sub.nodes[0]
  frames = frames.map((f) => (f.id === sub.id ? { ...f, nodes: [...f.nodes, extra] } : f))
  const r = applySplit(frames, req(['g']), 200, id, geom)
  assert.ok(r)
  const after = r!.frames.find((f) => f.owner)!
  const key = (n: (typeof after.nodes)[number]) => (n.pane?.kind === 'web' ? n.pane.companion?.key : undefined)
  const g = after.nodes.find((n) => key(n) === 'g')!
  assert.ok(g.x >= geom.PAD && g.y >= geom.HEAD + geom.PAD && g.x < after.w, '新开的格子排进了槽位')
  const b = after.nodes.find((n) => key(n) === 'b')!
  const bBefore = sub.nodes.find((n) => key(n) === 'b')!
  assert.deepEqual([b.x, b.y], [bBefore.x, bBefore.y], '最早的那格原位不动')
})
