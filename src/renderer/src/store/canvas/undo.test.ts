import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyUndo, pushUndo, stepUndo, stepRedo, snapshotOf, parseSnapshot, UNDO_LIMIT } from './undo.ts'

test('上限就是 20', () => assert.equal(UNDO_LIMIT, 20))

test('push 到上限后丢最旧的，不是拒绝新的', () => {
  let st = emptyUndo()
  for (let i = 0; i < 25; i++) st = pushUndo(st, `s${i}`)
  assert.equal(st.past.length, 20)
  assert.equal(st.past[0], 's5', '最旧的 5 份应该被挤掉')
  assert.equal(st.past[19], 's24')
})

// 画布里不少 action 会重建数组但内容一模一样（reflowFrames 之类），
// 那些不该占掉一格撤销
test('内容与栈顶相同不占一格', () => {
  let st = pushUndo(emptyUndo(), 'a')
  const same = pushUndo(st, 'a')
  assert.equal(same.past.length, 1)
  assert.equal(same, st, '连引用都不该变，免得白白触发渲染')
})

test('撤销取回上一份，当前那份进 future', () => {
  let st = pushUndo(pushUndo(emptyUndo(), 's0'), 's1')
  const r = stepUndo(st, 's2')
  assert.ok(r)
  assert.equal(r.snapshot, 's1')
  assert.deepEqual(r.next.past, ['s0'])
  assert.deepEqual(r.next.future, ['s2'])
})

test('重做把它推回去', () => {
  const afterUndo = stepUndo(pushUndo(pushUndo(emptyUndo(), 's0'), 's1'), 's2')
  assert.ok(afterUndo)
  const r = stepRedo(afterUndo.next, afterUndo.snapshot)
  assert.ok(r)
  assert.equal(r.snapshot, 's2')
  assert.deepEqual(r.next.past, ['s0', 's1'])
  assert.deepEqual(r.next.future, [])
})

test('空栈时撤销/重做返回 null，不抛', () => {
  assert.equal(stepUndo(emptyUndo(), 'x'), null)
  assert.equal(stepRedo(emptyUndo(), 'x'), null)
})

// 撤回去几步之后又动手改了，原来那条「未来」就不再可达
test('撤销后再动手会清空 future', () => {
  const afterUndo = stepUndo(pushUndo(pushUndo(emptyUndo(), 's0'), 's1'), 's2')
  assert.ok(afterUndo)
  assert.equal(afterUndo.next.future.length, 1)
  const after = pushUndo(afterUndo.next, 's9')
  assert.deepEqual(after.future, [])
})

test('撤到底再重做能一路走回最新', () => {
  let st = emptyUndo()
  for (const s of ['a', 'b', 'c']) st = pushUndo(st, s)
  let cur = 'd'
  const seen: string[] = []
  for (;;) {
    const r = stepUndo(st, cur)
    if (!r) break
    st = r.next
    cur = r.snapshot
    seen.push(cur)
  }
  assert.deepEqual(seen, ['c', 'b', 'a'])
  for (;;) {
    const r = stepRedo(st, cur)
    if (!r) break
    st = r.next
    cur = r.snapshot
  }
  assert.equal(cur, 'd')
})

// 撤销一次删除时把镜头也拽回去，人会当场迷失
test('快照不含 viewport', () => {
  const s = snapshotOf({ frames: [1], shapes: [], freeNodes: [], todos: [], viewport: { x: 9 } } as never)
  assert.ok(!s.includes('viewport'))
  assert.ok(s.includes('frames'))
})

test('快照能原样解析回来', () => {
  const scene = { frames: [{ id: 'f1' }], shapes: [], freeNodes: [], todos: [] }
  assert.deepEqual(parseSnapshot(snapshotOf(scene)), scene)
})

test('坏快照返回 null 而不是抛', () => {
  assert.equal(parseSnapshot('不是 json'), null)
  assert.equal(parseSnapshot('{"frames":"不是数组"}'), null)
  assert.equal(parseSnapshot('null'), null)
})
