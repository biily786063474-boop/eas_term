import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryIdOf, categoryName, MARKET_CATEGORIES } from './pluginCategories.ts'

test('中文分类名直接命中', () => {
  assert.equal(categoryIdOf('办公文档'), 'office')
  assert.equal(categoryIdOf('自媒体'), 'media')
  assert.equal(categoryIdOf('设计创意'), 'design')
})

test('英文 / 自家老值映射', () => {
  assert.equal(categoryIdOf('Productivity'), 'office')
  assert.equal(categoryIdOf('System'), 'dev')
  assert.equal(categoryIdOf('Developer Tools'), 'dev')
})

test('空 / 认不出 → other', () => {
  assert.equal(categoryIdOf(''), 'other')
  assert.equal(categoryIdOf(undefined), 'other')
  assert.equal(categoryIdOf('随便写的'), 'other')
})

test('每个分类 id 都能查到名字', () => {
  for (const c of MARKET_CATEGORIES) assert.equal(categoryName(c.id), c.name)
  assert.equal(categoryName('不存在'), '其他')
})
