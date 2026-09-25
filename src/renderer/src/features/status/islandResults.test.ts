import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createIslandResultCollector, islandReadKey } from './islandResults.ts'
test('two modules and two rounds never share a final result', () => {
  const a = createIslandResultCollector(), b = createIslandResultCollector()
  a.push({ k: 'turn.start' }); b.push({ k: 'turn.start' })
  a.push({ k: 'text.done', text: 'A过程' })
  a.push({ k: 'exec.start' })
  assert.equal(a.push({ k: 'turn.done' })?.answer, '')
  b.push({ k: 'text.done', text: 'B结果' })
  assert.equal(b.push({ k: 'turn.done' })?.answer, 'B结果')
  a.push({ k: 'turn.start' })
  a.push({ k: 'text.delta', text: 'A' })
  a.push({ k: 'text.delta', text: '结果' })
  a.push({ k: 'text.done', text: 'A最终结果' })
  const result = a.push({ k: 'turn.done' })
  assert.equal(result?.answer, 'A最终结果')
  assert.equal(a.current(result!), true)
  a.push({ k: 'turn.start' })
  assert.equal(a.current(result!), false)
  assert.equal(a.push({ k: 'turn.done' })?.answer, '')
})
test('read identity changes on module, binding, CLI, round and running state', () => {
  const identity = ['pty1', 'leaf1', 'session1', 'claude', 123, false]
  const original = islandReadKey(identity)
  identity.forEach((_, i) => {
    const changed = [...identity]; changed[i] = 'different'
    assert.notEqual(islandReadKey(changed), original)
  })
})
test('each text.done replaces earlier process; tool output never becomes an answer', () => {
  const c = createIslandResultCollector()
  c.push({ k: 'turn.start' })
  c.push({ k: 'text.done', text: '过程' })
  c.push({ k: 'exec.done', text: '工具输出' })
  c.push({ k: 'text.done', text: '最终' })
  assert.equal(c.push({ k: 'turn.done' })?.answer, '最终')
})
