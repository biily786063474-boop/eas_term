import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidList, parseCatalog, resolveModels, shouldPersist } from './modelCatalog.ts'

const A = [{ id: 'a', label: 'A' }]
const B = [{ id: 'b', label: 'B' }]
const C = [{ id: 'c', label: 'C' }]

test('三级取值：探到就用探到的', () => {
  const r = resolveModels({ probed: A, cached: B, fallback: C })
  assert.equal(r.source, 'probe')
  assert.deepEqual(r.models, A)
  assert.equal(r.note, undefined)
})

test('**探不到就降级到上次成功的那份**，并说清楚是哪来的', () => {
  const r = resolveModels({ probed: undefined, cached: B, fallback: C, cachedAt: Date.UTC(2026, 8, 1) })
  assert.equal(r.source, 'cache')
  assert.deepEqual(r.models, B)
  assert.match(r.note ?? '', /2026-09-01/)
})

test('从没探到过才用兜底，且标注是内置清单', () => {
  const r = resolveModels({ fallback: C })
  assert.equal(r.source, 'fallback')
  assert.match(r.note ?? '', /内置清单/)
})

test('探测返回空数组当作失败（空下拉和没下拉对用户是一回事）', () => {
  assert.equal(resolveModels({ probed: [], cached: B }).source, 'cache')
})

test('三级都没有 → 空清单，工具栏自己不显示下拉', () => {
  assert.deepEqual(resolveModels({}), { models: [], source: 'none' })
})

test('isValidList：挡住坏数据', () => {
  assert.equal(isValidList([{ id: '', label: 'x' }]), false)
  assert.equal(isValidList([]), false)
  assert.equal(isValidList('x'), false)
  assert.equal(isValidList([{ label: '没有 id' }]), false)
})

test('shouldPersist：内容没变就不写盘', () => {
  assert.equal(shouldPersist(A, A.map((m) => ({ ...m }))), false)
  assert.equal(shouldPersist(A, B), true)
  assert.equal(shouldPersist(undefined, A), true)
  assert.equal(shouldPersist(A, [...A, ...B]), true)
})

test('parseCatalog：坏条目丢掉，不抛', () => {
  const got = parseCatalog({ codex: { at: 1, models: A }, bad: { models: 'x' }, worse: null })
  assert.deepEqual(Object.keys(got), ['codex'])
  assert.deepEqual(parseCatalog('不是对象'), {})
})
