import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DICT_TAXONOMY, DICT_CAT1, isValidCat, normalizeCat1 } from './dictTaxonomy.ts'

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

test('五个场景一级，顺序就是界面导航的顺序', () => {
  assert.equal(DICT_CAT1.length, 5)
  assert.equal(DICT_CAT1[0], '前端 · 组件')
  assert.equal(DICT_CAT1.at(-1), '后端 · 服务')
})

test('二级名全局唯一 —— 迁移脚本按二级名找 desc，重名会静默张冠李戴', () => {
  const all = Object.values(DICT_TAXONOMY).flat()
  assert.equal(new Set(all).size, all.length)
})

test('isValidCat：两个都对才算数', () => {
  assert.equal(isValidCat('前端 · 视觉', '玻璃与模糊'), true)
  assert.equal(isValidCat('前端 · 视觉', '缓动曲线'), false, '二级不属于这个一级')
  assert.equal(isValidCat('不存在的一级', '玻璃与模糊'), false)
  assert.equal(isValidCat('前端 · 视觉', undefined), false, '只给一级不算归好类')
  assert.equal(isValidCat(undefined, undefined), false)
  assert.equal(isValidCat('前端 · 视觉', ''), false)
})

// ── 老一级名的兼容。**这组测试删不得。** ────────────────────────────────
// 用户机器上已装的 skill 还在按 2026-08-31 那版的一级名调 dict_add；
// 更要命的是 readUser() 会拿 isValidCat 校验**已经存在**的自建词条，
// 而 dict:add 是「整个读出来再整个写回去」—— 认不出老名的话，
// 下次加词就把老词条的分类洗掉一遍。
test('老一级名仍然认，且归一成新名', () => {
  assert.equal(normalizeCat1('材质与质感', '玻璃与模糊'), '前端 · 视觉')
  assert.equal(normalizeCat1('加载与等待', '缓存与预取'), '前端 · 数据')
  assert.equal(normalizeCat1('手势与拖拽', '光标跟随'), '前端 · 动效')
  assert.equal(isValidCat('输入与表单', '键盘与焦点'), true, '老名不能被拒')
})

test('老一级名配错二级仍然要拒', () => {
  assert.equal(normalizeCat1('材质与质感', '缓动曲线'), null, '缓动曲线不在视觉那一支下')
  assert.equal(normalizeCat1('加载与等待', '玻璃与模糊'), null)
})

test('新名原样返回，不经过别名表', () => {
  for (const [c1, subs] of Object.entries(DICT_TAXONOMY)) {
    for (const c2 of subs) assert.equal(normalizeCat1(c1, c2), c1)
  }
})

test('每个老一级名都映射到一个真实存在的新一级', () => {
  const OLD = ['输入与表单', '列表与滚动', '加载与等待', '转场与入场', '手势与拖拽',
               '反馈与提示', '材质与质感', '版式与风格', '运动规律']
  for (const old of OLD) {
    // 拿这个老一级下**任意一个**二级去探，能归一就说明别名连着
    const hit = DICT_CAT1.some((c1) =>
      DICT_TAXONOMY[c1].some((c2) => normalizeCat1(old, c2) !== null))
    assert.ok(hit, `老一级「${old}」没有映射，已装的 skill 会被拒`)
  }
})
