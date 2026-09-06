import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTENT_CAP, contentStat, isContentNode, nodesToEvict } from './nodeCap.ts'
import type { CanvasNode } from './types.ts'

const base = { x: 0, y: 0, w: 100, h: 100 }
const web = (id: string, pinned?: boolean): CanvasNode => ({ id, pane: { kind: 'web', url: 'x' }, ...base, ...(pinned ? { pinned } : {}) }) as CanvasNode
const code = (id: string): CanvasNode => ({ id, pane: { kind: 'code', filePath: '/a' }, ...base }) as CanvasNode
const img = (id: string): CanvasNode => ({ id, pane: { kind: 'image', filePath: '/a.png' }, ...base }) as CanvasNode
const term = (id: string): CanvasNode => ({ id, leafId: 'leaf-' + id, ...base }) as CanvasNode
const comp = (id: string): CanvasNode => ({ id, component: { type: 'git' }, ...base }) as CanvasNode

test('内容模块只算 web / code / image', () => {
  assert.equal(isContentNode(web('a')), true)
  assert.equal(isContentNode(code('b')), true)
  assert.equal(isContentNode(img('c')), true)
  assert.equal(isContentNode(term('d')), false, '终端和 AI 对话是活的，不算')
  assert.equal(isContentNode(comp('e')), false, '画布组件是用户摆的工具，不算')
})

test('没超上限不淘汰任何东西', () => {
  assert.deepEqual(nodesToEvict([web('1'), code('2'), img('3')]), [])
  assert.deepEqual(nodesToEvict([web('1'), web('2'), web('3'), web('4'), web('5')]), [])
})

test('**超了淘汰最早的那个**（先进先出）', () => {
  const ns = [web('1'), web('2'), web('3'), web('4'), web('5'), web('6')]
  assert.deepEqual(nodesToEvict(ns), ['1'])
})

test('一次超好几个就淘汰好几个，仍从最早的开始', () => {
  const ns = ['1', '2', '3', '4', '5', '6', '7', '8'].map((i) => web(i))
  assert.deepEqual(nodesToEvict(ns), ['1', '2', '3'])
})

test('**钉住的既不占名额也不会被淘汰**', () => {
  // 三个钉住 + 五个没钉 = 不该淘汰（钉的不占名额）
  const ns = [web('p1', true), web('p2', true), web('p3', true), web('1'), web('2'), web('3'), web('4'), web('5')]
  assert.deepEqual(nodesToEvict(ns), [])
  // 再加一个才超
  assert.deepEqual(nodesToEvict([...ns, web('6')]), ['1'])
})

test('最早的那个被钉住时，淘汰的是它后面第一个没钉的', () => {
  const ns = [web('p', true), web('1'), web('2'), web('3'), web('4'), web('5'), web('6')]
  assert.deepEqual(nodesToEvict(ns), ['1'])
})

test('终端和组件夹在中间不影响计数与顺序', () => {
  const ns = [term('t1'), web('1'), comp('c1'), web('2'), web('3'), term('t2'), web('4'), web('5'), web('6')]
  assert.deepEqual(nodesToEvict(ns), ['1'], '只数内容模块，只淘汰内容模块')
})

test('contentStat：占用 / 上限 / 钉住数', () => {
  const ns = [web('p', true), web('1'), web('2'), term('t')]
  assert.deepEqual(contentStat(ns), { used: 2, cap: CONTENT_CAP, pinned: 1 })
})
