import { test } from 'node:test'
import assert from 'node:assert'
import { sanitizeCategoryAssignment, groupByCategory, UNCATEGORIZED } from './category.ts'
import type { SkillInfo } from '../../shared/types.ts'

const sk = (p: string): SkillInfo => ({ path: p, name: p.split('/').pop()!, description: '' })

test('sanitizeCategoryAssignment：不是对象 / 是数组 / 是 null → 全部返回空', () => {
  const valid = new Set(['/a'])
  assert.deepStrictEqual(sanitizeCategoryAssignment(null, valid), {})
  assert.deepStrictEqual(sanitizeCategoryAssignment(undefined, valid), {})
  assert.deepStrictEqual(sanitizeCategoryAssignment('a string', valid), {})
  assert.deepStrictEqual(sanitizeCategoryAssignment(['/a', '设计'], valid), {})
  assert.deepStrictEqual(sanitizeCategoryAssignment(42, valid), {})
})

test('sanitizeCategoryAssignment：正常条目原样保留', () => {
  const valid = new Set(['/a', '/b'])
  const out = sanitizeCategoryAssignment({ '/a': '设计', '/b': '工具' }, valid)
  assert.deepStrictEqual(out, { '/a': '设计', '/b': '工具' })
})

test('sanitizeCategoryAssignment：值不是字符串的条目被丢弃，其余条目不受影响', () => {
  const valid = new Set(['/a', '/b'])
  const out = sanitizeCategoryAssignment({ '/a': '设计', '/b': 123 }, valid)
  assert.deepStrictEqual(out, { '/a': '设计' })
})

test('sanitizeCategoryAssignment：空字符串 / 纯空格的分类名被丢弃', () => {
  const valid = new Set(['/a', '/b'])
  const out = sanitizeCategoryAssignment({ '/a': '', '/b': '   ' }, valid)
  assert.deepStrictEqual(out, {})
})

test('sanitizeCategoryAssignment：超过长度上限的分类名被丢弃', () => {
  const valid = new Set(['/a'])
  const longName = '分'.repeat(41)
  const out = sanitizeCategoryAssignment({ '/a': longName }, valid)
  assert.deepStrictEqual(out, {})
})

test('sanitizeCategoryAssignment：引用了当前不存在的 skill 路径 → 那一条被丢弃（skill 可能后来被删了），其余条目不受连累', () => {
  const valid = new Set(['/a'])
  const out = sanitizeCategoryAssignment({ '/a': '设计', '/deleted': '工具' }, valid)
  assert.deepStrictEqual(out, { '/a': '设计' })
})

test('sanitizeCategoryAssignment：分类名首尾空格会被裁剪', () => {
  const valid = new Set(['/a'])
  const out = sanitizeCategoryAssignment({ '/a': '  设计  ' }, valid)
  assert.deepStrictEqual(out, { '/a': '设计' })
})

test('groupByCategory：没有任何分类数据 → 全部落进未分类', () => {
  const skills = [sk('/a'), sk('/b')]
  const groups = groupByCategory(skills, {})
  assert.deepStrictEqual(groups, [{ name: UNCATEGORIZED, skillPaths: ['/a', '/b'] }])
})

test('groupByCategory：未分类固定排最后，即便它人数最多', () => {
  const skills = [sk('/a'), sk('/b'), sk('/c'), sk('/d')]
  const groups = groupByCategory(skills, { '/a': '设计' })
  assert.deepStrictEqual(
    groups.map((g) => g.name),
    ['设计', UNCATEGORIZED]
  )
  assert.deepStrictEqual(groups.find((g) => g.name === UNCATEGORIZED)?.skillPaths, ['/b', '/c', '/d'])
})

test('groupByCategory：已命名分类之间按名称排序（结果稳定，不依赖输入顺序）', () => {
  const skills = [sk('/a'), sk('/b'), sk('/c')]
  const groups = groupByCategory(skills, { '/a': '工具', '/b': '设计', '/c': '内容' })
  // zh locale 按拼音排序：工具(gongju) < 内容(neirong) < 设计(shejii)
  assert.deepStrictEqual(
    groups.map((g) => g.name),
    ['工具', '内容', '设计']
  )
})

test('groupByCategory：没有任何 skill 时返回空数组，不产生一个空的未分类组', () => {
  const groups = groupByCategory([], {})
  assert.deepStrictEqual(groups, [])
})

test('groupByCategory：同一分类下多个 skill 保持传入顺序', () => {
  const skills = [sk('/z'), sk('/a'), sk('/m')]
  const groups = groupByCategory(skills, { '/z': '同类', '/a': '同类', '/m': '同类' })
  assert.deepStrictEqual(groups[0].skillPaths, ['/z', '/a', '/m'])
})
