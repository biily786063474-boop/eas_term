import { test } from 'node:test'
import assert from 'node:assert/strict'
import { todoFrameOf, todosOfFrame } from './todoOwner.ts'

const F = (id: string, x: number, y: number, w: number, h: number, over = {}) => ({ id, x, y, w, h, ...over })
const T = (x: number, y: number, w = 200, h = 100) => ({ x, y, w, h })

test('中心点落在哪个 Frame 里就归谁', () => {
  const frames = [F('a', 0, 0, 1000, 800)]
  assert.equal(todoFrameOf(T(100, 100), frames), 'a')
  assert.equal(todoFrameOf(T(5000, 5000), frames), undefined, '外面的不属于任何 Frame')
})

test('判中心点不判整体包含 —— 压着边界也算', () => {
  const frames = [F('a', 0, 0, 500, 500)]
  // 清单左半截在外面，中心 (400,250) 仍在里面
  assert.equal(todoFrameOf(T(300, 200), frames), 'a')
})

test('子 Frame 优先 —— 否则放在子里的会被判给父', () => {
  const frames = [F('parent', 0, 0, 1000, 800), F('child', 100, 100, 300, 200, { parentId: 'parent' })]
  assert.equal(todoFrameOf(T(150, 130, 100, 50), frames), 'child')
  assert.equal(todoFrameOf(T(700, 600, 100, 50), frames), 'parent', '子 Frame 外面的还是父的')
})

test('折叠的 Frame 不参与 —— 那时它只剩一条标题栏', () => {
  const frames = [F('a', 0, 0, 1000, 800, { collapsed: true })]
  assert.equal(todoFrameOf(T(100, 100), frames), undefined)
})

test('一个 Frame 的待办包含它子 Frame 里的那些', () => {
  const frames = [F('p', 0, 0, 1000, 800), F('c', 100, 100, 300, 200, { parentId: 'p' })]
  const todos = [
    { ...T(150, 130, 100, 50), id: 'in-child' },
    { ...T(700, 600, 100, 50), id: 'in-parent' },
    { ...T(5000, 5000, 100, 50), id: 'outside' }
  ]
  const got = todosOfFrame('p', todos, frames).map((t) => t.id)
  assert.deepEqual(got.sort(), ['in-child', 'in-parent'], '子 Frame 里的算这个项目的')
  assert.deepEqual(todosOfFrame('c', todos, frames).map((t) => t.id), ['in-child'])
})

test('画布上没有 Frame 时不抛', () => {
  assert.equal(todoFrameOf(T(0, 0), []), undefined)
  assert.deepEqual(todosOfFrame('nope', [{ ...T(0, 0), id: 'x' }], []), [])
})
