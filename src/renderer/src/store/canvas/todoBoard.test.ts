import { test } from 'node:test'
import assert from 'node:assert'
import type { TodoItem } from './types.ts'
import {
  arrayMove,
  dropIndexForOffset,
  groupTodoItems,
  moveTodoItem,
  sanitizeTodoBoard,
  sanitizeTodoItem,
  toggleTodoItemDone,
  TODO_BOARD_DEFAULT_H,
  TODO_BOARD_DEFAULT_W
} from './todoBoard.ts'

const item = (id: string, done = false, doneAt?: number, title = id): TodoItem => ({
  id,
  title,
  done,
  doneAt
})

// ---------- groupTodoItems ----------

test('groupTodoItems：待办保持数组原有顺序，已完成过滤掉', () => {
  const items = [item('a'), item('b', true, 100), item('c')]
  const { pending } = groupTodoItems(items)
  assert.deepStrictEqual(pending.map((i) => i.id), ['a', 'c'])
})

test('groupTodoItems：已完成按 doneAt 倒序（新的排前面）', () => {
  const items = [item('a', true, 100), item('b', true, 300), item('c', true, 200)]
  const { done } = groupTodoItems(items)
  assert.deepStrictEqual(done.map((i) => i.id), ['b', 'c', 'a'])
})

test('groupTodoItems：doneAt 缺失当 0 处理，排在最后而不是抛错', () => {
  const items = [item('a', true, 100), item('b', true, undefined)]
  const { done } = groupTodoItems(items)
  assert.deepStrictEqual(done.map((i) => i.id), ['a', 'b'])
})

test('groupTodoItems：空数组不炸', () => {
  assert.deepStrictEqual(groupTodoItems([]), { pending: [], done: [] })
})

// ---------- arrayMove ----------

test('arrayMove：往后挪', () => {
  assert.deepStrictEqual(arrayMove(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
})

test('arrayMove：往前挪', () => {
  assert.deepStrictEqual(arrayMove(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c'])
})

test('arrayMove：from === to 不改变顺序', () => {
  assert.deepStrictEqual(arrayMove(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c'])
})

test('arrayMove：越界下标夹到合法范围，不抛错', () => {
  assert.deepStrictEqual(arrayMove(['a', 'b', 'c'], 0, 99), ['b', 'c', 'a'])
  assert.deepStrictEqual(arrayMove(['a', 'b', 'c'], -5, 0), ['a', 'b', 'c'])
})

test('arrayMove：空数组不炸', () => {
  assert.deepStrictEqual(arrayMove([], 0, 1), [])
})

test('arrayMove：不改入参', () => {
  const input = ['a', 'b', 'c']
  arrayMove(input, 0, 2)
  assert.deepStrictEqual(input, ['a', 'b', 'c'])
})

// ---------- moveTodoItem ----------

test('moveTodoItem：只在未完成子序列内搬移，已完成项的值与「格位」都不受影响', () => {
  // 排列：待办 A / 已完成 B / 待办 C / 待办 D —— 把 A 挪到未完成序列的第 2 位（末尾）
  const items = [item('a'), item('b', true, 1), item('c'), item('d')]
  const out = moveTodoItem(items, 'a', 2)
  assert.deepStrictEqual(out.map((i) => i.id), ['c', 'b', 'd', 'a'])
  // B 本身（含 doneAt）原样保留，不是被替换成的新对象
  assert.strictEqual(out[1], items[1])
})

test('moveTodoItem：未知 id 原样返回（不同引用的拷贝，但内容相等）', () => {
  const items = [item('a'), item('b')]
  const out = moveTodoItem(items, 'zzz', 0)
  assert.deepStrictEqual(out, items)
})

test('moveTodoItem：全部未完成时退化为普通 arrayMove', () => {
  const items = [item('a'), item('b'), item('c')]
  const out = moveTodoItem(items, 'c', 0)
  assert.deepStrictEqual(out.map((i) => i.id), ['c', 'a', 'b'])
})

// ---------- dropIndexForOffset ----------

test('dropIndexForOffset：dy=0 原地不动', () => {
  assert.strictEqual(dropIndexForOffset(5, 2, 0, 48), 2)
})

test('dropIndexForOffset：正 dy 往下移', () => {
  assert.strictEqual(dropIndexForOffset(5, 0, 100, 48), 2) // round(100/48)=2
})

test('dropIndexForOffset：负 dy 往上移', () => {
  assert.strictEqual(dropIndexForOffset(5, 4, -100, 48), 2)
})

test('dropIndexForOffset：结果夹在 [0, length-1] 之间', () => {
  assert.strictEqual(dropIndexForOffset(3, 0, -999, 48), 0)
  assert.strictEqual(dropIndexForOffset(3, 0, 999, 48), 2)
})

test('dropIndexForOffset：rowStep<=0 或没有待排序项时原地不动，不产生 NaN', () => {
  assert.strictEqual(dropIndexForOffset(5, 2, 100, 0), 2)
  assert.strictEqual(dropIndexForOffset(0, 0, 100, 48), 0)
})

// ---------- toggleTodoItemDone ----------

test('toggleTodoItemDone：未完成 → 完成，盖章 doneAt', () => {
  const items = [item('a')]
  const out = toggleTodoItemDone(items, 'a', 12345)
  assert.strictEqual(out[0].done, true)
  assert.strictEqual(out[0].doneAt, 12345)
})

test('toggleTodoItemDone：完成 → 取消勾选，doneAt 清空', () => {
  const items = [item('a', true, 999)]
  const out = toggleTodoItemDone(items, 'a', 12345)
  assert.strictEqual(out[0].done, false)
  assert.strictEqual(out[0].doneAt, undefined)
})

test('toggleTodoItemDone：未命中的项原样返回同一引用（不引发多余渲染）', () => {
  const items = [item('a'), item('b')]
  const out = toggleTodoItemDone(items, 'a', 1)
  assert.strictEqual(out[1], items[1])
})

// ---------- sanitizeTodoItem ----------

test('sanitizeTodoItem：合法项原样通过', () => {
  const out = sanitizeTodoItem({ id: 'x', title: '标题', body: '正文', done: true, doneAt: 100 })
  assert.deepStrictEqual(out, { id: 'x', title: '标题', body: '正文', done: true, doneAt: 100 })
})

test('sanitizeTodoItem：非对象 / 缺 id → null', () => {
  assert.strictEqual(sanitizeTodoItem(null), null)
  assert.strictEqual(sanitizeTodoItem('x'), null)
  assert.strictEqual(sanitizeTodoItem({ title: '没有 id' }), null)
})

test('sanitizeTodoItem：title/body 非字符串时兜底', () => {
  const out = sanitizeTodoItem({ id: 'x', title: 42, body: 42, done: false })
  assert.strictEqual(out?.title, '')
  assert.strictEqual(out?.body, undefined)
})

test('sanitizeTodoItem：done=false 时哪怕存档里带脏 doneAt 也清掉（不产生「未完成但有完成时间」的畸形数据）', () => {
  const out = sanitizeTodoItem({ id: 'x', title: 't', done: false, doneAt: 999 })
  assert.strictEqual(out?.doneAt, undefined)
})

test('sanitizeTodoItem：done=true 但 doneAt 不是合法数字时兜成 undefined，不抛错', () => {
  const out = sanitizeTodoItem({ id: 'x', title: 't', done: true, doneAt: 'nope' })
  assert.strictEqual(out?.doneAt, undefined)
  assert.strictEqual(out?.done, true)
})

// ---------- sanitizeTodoBoard ----------

test('sanitizeTodoBoard：合法 board 原样通过', () => {
  const out = sanitizeTodoBoard({
    id: 'b1',
    x: 10,
    y: 20,
    w: 300,
    h: 150,
    title: '清单',
    items: [{ id: 'i1', title: 'a', done: false }]
  })
  assert.strictEqual(out?.id, 'b1')
  assert.strictEqual(out?.x, 10)
  assert.strictEqual(out?.items.length, 1)
})

test('sanitizeTodoBoard：非对象 / 缺 id → null', () => {
  assert.strictEqual(sanitizeTodoBoard(null), null)
  assert.strictEqual(sanitizeTodoBoard(undefined), null)
  assert.strictEqual(sanitizeTodoBoard({ items: [] }), null)
})

test('sanitizeTodoBoard：坏的那一条 item 被丢弃，其余项存活——不能因为一条坏待办拖垮整个 board', () => {
  const out = sanitizeTodoBoard({
    id: 'b1',
    items: [{ id: 'ok1', title: 'a', done: false }, { noId: true }, { id: 'ok2', title: 'b', done: false }]
  })
  assert.deepStrictEqual(out?.items.map((i) => i.id), ['ok1', 'ok2'])
})

test('sanitizeTodoBoard：items 不是数组时兜成空数组，不抛错', () => {
  const out = sanitizeTodoBoard({ id: 'b1', items: 'not-an-array' })
  assert.deepStrictEqual(out?.items, [])
})

test('sanitizeTodoBoard：x/y/w/h 非法时兜默认值', () => {
  const out = sanitizeTodoBoard({ id: 'b1', x: 'nope', y: NaN, w: null, items: [] })
  assert.strictEqual(out?.x, 0)
  assert.strictEqual(out?.y, 0)
  assert.strictEqual(out?.w, TODO_BOARD_DEFAULT_W)
  assert.strictEqual(out?.h, TODO_BOARD_DEFAULT_H)
})

test('sanitizeTodoBoard：title 非字符串时兜成 undefined（不是空字符串——未设标题和设了空标题是两回事）', () => {
  const out = sanitizeTodoBoard({ id: 'b1', title: 42, items: [] })
  assert.strictEqual(out?.title, undefined)
})
