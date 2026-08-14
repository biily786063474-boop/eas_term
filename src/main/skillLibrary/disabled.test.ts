import { test } from 'node:test'
import assert from 'node:assert'
import { sanitizeDisabled, applyDisabled } from './disabled.ts'

test('sanitizeDisabled：不是数组 → 空', () => {
  assert.deepStrictEqual(sanitizeDisabled(undefined), [])
  assert.deepStrictEqual(sanitizeDisabled(null), [])
  assert.deepStrictEqual(sanitizeDisabled({ '/a': true }), [])
  assert.deepStrictEqual(sanitizeDisabled('/a'), [])
})

test('sanitizeDisabled：丢掉非字符串 / 空串 / 相对路径，保住其余（单条脏不作废整份）', () => {
  assert.deepStrictEqual(sanitizeDisabled(['/a', 42, '', '  ', 'relative/x', null, '/b']), ['/a', '/b'])
})

test('sanitizeDisabled：去重', () => {
  assert.deepStrictEqual(sanitizeDisabled(['/a', '/a', '/b', '/a']), ['/a', '/b'])
})

test('sanitizeDisabled：不校验 skill 存不存在——挪走再挪回来，禁用状态该还在', () => {
  assert.deepStrictEqual(sanitizeDisabled(['/nowhere/gone']), ['/nowhere/gone'])
})

test('applyDisabled：禁用一个 → 进清单；重复禁用不塞两条', () => {
  assert.deepStrictEqual(applyDisabled([], '/a', true), ['/a'])
  assert.deepStrictEqual(applyDisabled(['/a'], '/a', true), ['/a'])
})

test('applyDisabled：恢复 → 从清单里摘掉；恢复一个本来就没禁的不报错', () => {
  assert.deepStrictEqual(applyDisabled(['/a', '/b'], '/a', false), ['/b'])
  assert.deepStrictEqual(applyDisabled(['/b'], '/a', false), ['/b'])
})

test('applyDisabled：不改动传进来的数组（调用方还要拿旧值比对）', () => {
  const orig = ['/a']
  const next = applyDisabled(orig, '/b', true)
  assert.deepStrictEqual(orig, ['/a'])
  assert.deepStrictEqual(next, ['/a', '/b'])
})

test('applyDisabled：空路径 → 原样返回，不塞一条空的进去', () => {
  assert.deepStrictEqual(applyDisabled(['/a'], '   ', true), ['/a'])
})
