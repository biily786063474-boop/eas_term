import { test } from 'node:test'
import assert from 'node:assert'
import { isTerminalNode, tidyOrder } from './tidyOrder.ts'

/** 活终端：挂 leafId，没有 pane/component */
const term = (id: string, x: number, y: number): { id: string; leafId: string; x: number; y: number } => ({
  id,
  leafId: 'leaf-' + id,
  x,
  y
})
/** 文件类预览：有 pane */
const file = (id: string, x: number, y: number): { id: string; pane: object; x: number; y: number } => ({
  id,
  pane: { kind: 'code' },
  x,
  y
})
/** 画布组件：有 component */
const comp = (id: string, x: number, y: number): { id: string; component: object; x: number; y: number } => ({
  id,
  component: { type: 'history' },
  x,
  y
})

test('三种形态的判据', () => {
  assert.strictEqual(isTerminalNode(term('t', 0, 0)), true)
  assert.strictEqual(isTerminalNode(file('f', 0, 0)), false)
  assert.strictEqual(isTerminalNode(comp('c', 0, 0)), false)
})

test('挂了 leafId 但同时有 pane 的不算终端（文件节点也可能被挂上 leaf）', () => {
  assert.strictEqual(isTerminalNode({ leafId: 'l1', pane: { kind: 'code' }, x: 0, y: 0 }), false)
})

test('终端排到最前，哪怕它原本在最下面', () => {
  // 文件在上（y=0），终端在下（y=500）——整理后终端要跑到第一位
  const out = tidyOrder([file('f1', 0, 0), term('t1', 0, 500)])
  assert.deepStrictEqual(out.map((n) => n.id), ['t1', 'f1'])
})

test('多个终端之间保持阅读顺序（先上后左）', () => {
  const out = tidyOrder([term('b', 0, 100), term('c', 200, 0), term('a', 0, 0)])
  assert.deepStrictEqual(out.map((n) => n.id), ['a', 'c', 'b'])
})

test('非终端之间也保持阅读顺序，且整体排在全部终端之后', () => {
  const out = tidyOrder([
    file('f-low', 0, 300),
    term('t-low', 0, 400),
    comp('c-high', 0, 0),
    term('t-high', 0, 10)
  ])
  assert.deepStrictEqual(
    out.map((n) => n.id),
    ['t-high', 't-low', 'c-high', 'f-low'],
    '两个终端按 y 升序在前，其余按 y 升序在后'
  )
})

test('同一 y 上按 x 升序（先上后左里的「后左」）', () => {
  const out = tidyOrder([term('right', 300, 0), term('left', 0, 0)])
  assert.deepStrictEqual(out.map((n) => n.id), ['left', 'right'])
})

test('不改入参', () => {
  const input = [file('f', 0, 0), term('t', 0, 100)]
  const before = input.map((n) => n.id)
  tidyOrder(input)
  assert.deepStrictEqual(input.map((n) => n.id), before)
})

test('空数组不炸', () => {
  assert.deepStrictEqual(tidyOrder([]), [])
})

test('全是终端时，结果就是纯阅读顺序（终端优先这一档不产生额外扰动）', () => {
  const out = tidyOrder([term('c', 0, 200), term('a', 0, 0), term('b', 100, 0)])
  assert.deepStrictEqual(out.map((n) => n.id), ['a', 'b', 'c'])
})
