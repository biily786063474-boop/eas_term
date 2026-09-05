import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankSkills, termsOf } from './skillSearch.ts'

const sk = (name: string, description: string): { name: string; description: string } => ({ name, description })
const names = (xs: { name: string }[]): string[] => xs.map((x) => x.name)

test('查询为空 → 原样全部返回，顺序不变', () => {
  const all = [sk('b', ''), sk('a', '')]
  assert.deepEqual(names(rankSkills(all, '')), ['b', 'a'])
  assert.deepEqual(names(rankSkills(all, '   ')), ['b', 'a'])
})

// 这条是用户定的核心规则
test('**description 命中的排在 name 命中的前面**', () => {
  const all = [
    sk('design-router', '视觉设计总入口'), // name 含 design
    sk('copywriting', 'design 相关的文案技巧') // description 含 design
  ]
  assert.deepEqual(names(rankSkills(all, 'design')), ['copywriting', 'design-router'])
})

test('大小写不敏感', () => {
  const all = [sk('Skill-Organizer', 'Set up an Agent Team')]
  assert.equal(rankSkills(all, 'agent team').length, 1)
  assert.equal(rankSkills(all, 'AGENT').length, 1)
})

test('多个词：每个词都要命中，缺一个就不算', () => {
  const all = [sk('a', '给 Eas-Term 接入一个新的 AI CLI'), sk('b', '整理一下我的 skill')]
  assert.deepEqual(names(rankSkills(all, '接入 CLI')), ['a'])
  assert.deepEqual(names(rankSkills(all, '接入 skill')), [], '两个词分别落在两条里，不算')
})

test('各词分散在 name 和 description 里也算（第三档）', () => {
  const all = [sk('design-router', '视觉总入口')]
  assert.deepEqual(names(rankSkills(all, 'design 视觉')), ['design-router'])
})

test('同一档内保持原来的顺序（分类里的顺序是用户拖出来的）', () => {
  const all = [sk('z', 'foo 1'), sk('y', 'foo 2'), sk('x', 'foo 3')]
  assert.deepEqual(names(rankSkills(all, 'foo')), ['z', 'y', 'x'])
})

test('没命中的一律不出现', () => {
  const all = [sk('a', 'alpha'), sk('b', 'beta')]
  assert.deepEqual(names(rankSkills(all, 'gamma')), [])
})

test('termsOf：拆词、去空、转小写', () => {
  assert.deepEqual(termsOf('  Foo   BAR '), ['foo', 'bar'])
  assert.deepEqual(termsOf(''), [])
})
