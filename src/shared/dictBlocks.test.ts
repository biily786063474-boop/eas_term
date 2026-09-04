import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DICT_BLOCKS, BLOCKS_MAX, normalizeBlocks } from './dictBlocks.ts'

const bundle = JSON.parse(
  fs.readFileSync('src/renderer/src/features/dict/dictionary-bundle.json', 'utf8')
) as { terms: { id: string; blocks?: string[] }[] }

// 词库里冒出一个名单外的区块名 → 界面上没有对应的 chip，那些词条按区块**永远筛不到**，
// 和分类表分叉是同一类静默失效。
test('词库里出现过的每个区块名都在名单里', () => {
  const seen = new Set(bundle.terms.flatMap((t) => t.blocks ?? []))
  const unknown = [...seen].filter((b) => !(DICT_BLOCKS as readonly string[]).includes(b))
  assert.deepEqual(unknown, [])
})

test('没有词条挂超过上限个区块', () => {
  const over = bundle.terms.filter((t) => (t.blocks?.length ?? 0) > BLOCKS_MAX)
  assert.deepEqual(over.map((t) => t.id), [])
})

test('没有空数组 —— 没标过就不该有这个字段', () => {
  const empty = bundle.terms.filter((t) => Array.isArray(t.blocks) && t.blocks.length === 0)
  assert.deepEqual(empty.map((t) => t.id), [])
})

test('区块名不重复', () => {
  assert.equal(new Set(DICT_BLOCKS).size, DICT_BLOCKS.length)
})

test('normalizeBlocks：滤掉名单外的、去重、封顶', () => {
  assert.deepEqual(normalizeBlocks(['卡片', '弹层']), ['卡片', '弹层'])
  assert.deepEqual(normalizeBlocks(['卡片', '卡片']), ['卡片'], '去重')
  assert.deepEqual(normalizeBlocks(['卡片', '不存在的区块']), ['卡片'], '滤掉名单外的')
  assert.deepEqual(normalizeBlocks(['导航栏', '标签栏', '侧边栏', '卡片']).length, BLOCKS_MAX, '封顶')
})

test('normalizeBlocks：一个都不合法时返回 null，不是空数组', () => {
  // 空数组会被写进词库，而「标过但一个区块都不属于」和「没标过」在界面上是两回事
  assert.equal(normalizeBlocks([]), null)
  assert.equal(normalizeBlocks(['不存在的区块']), null)
  assert.equal(normalizeBlocks('卡片'), null, '不是数组')
  assert.equal(normalizeBlocks(undefined), null)
  assert.equal(normalizeBlocks([1, 2]), null, '非字符串项')
})
