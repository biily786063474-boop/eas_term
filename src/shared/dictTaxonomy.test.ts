import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DICT_TAXONOMY, DICT_CAT1, isValidCat } from './dictTaxonomy.ts'

// 这份表有两个副本：这里（主进程校验用）和 dictionary-bundle.json（界面渲染用，带说明）。
// 改了一边忘了另一边 → 词条会落在一个界面上不存在的分类下，一级二级都筛不到，
// 等于静默丢失。这条测试就是钉死这件事的。
test('**和词库里那份逐字相同** —— 两份分类表不许分叉', () => {
  const bundle = JSON.parse(
    fs.readFileSync('src/renderer/src/features/dict/dictionary-bundle.json', 'utf8')
  ) as { taxonomy: Record<string, { name: string }[]> }
  const fromBundle = Object.fromEntries(
    Object.entries(bundle.taxonomy).map(([k, v]) => [k, v.map((x) => x.name)])
  )
  assert.deepEqual(
    Object.fromEntries(Object.entries(DICT_TAXONOMY).map(([k, v]) => [k, [...v]])),
    fromBundle,
    'shared/dictTaxonomy.ts 和 dictionary-bundle.json 的分类表对不上了'
  )
})

test('词库里每一条的 cat1/cat2 都在表里 —— 不许有孤儿分类', () => {
  const bundle = JSON.parse(
    fs.readFileSync('src/renderer/src/features/dict/dictionary-bundle.json', 'utf8')
  ) as { terms: { id: string; cat1?: string; cat2?: string }[] }
  const bad = bundle.terms.filter((t) => !isValidCat(t.cat1, t.cat2))
  assert.deepEqual(bad.map((t) => t.id), [], '这些词条的分类不在表里')
})

test('九个一级，顺序就是界面导航的顺序', () => {
  assert.equal(DICT_CAT1.length, 9)
  assert.equal(DICT_CAT1[0], '输入与表单')
  assert.equal(DICT_CAT1.at(-1), '运动规律')
})

test('isValidCat：两个都对才算数', () => {
  assert.equal(isValidCat('材质与质感', '玻璃与模糊'), true)
  assert.equal(isValidCat('材质与质感', '缓动曲线'), false, '二级不属于这个一级')
  assert.equal(isValidCat('不存在的一级', '玻璃与模糊'), false)
  assert.equal(isValidCat('材质与质感', undefined), false, '只给一级不算归好类')
  assert.equal(isValidCat(undefined, undefined), false)
  assert.equal(isValidCat('材质与质感', ''), false)
})
