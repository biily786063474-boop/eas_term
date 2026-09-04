import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DICT_BLOCKS } from '../../../../shared/dictBlocks.ts'

const BP = JSON.parse(fs.readFileSync('src/renderer/src/features/dict/blueprints.json', 'utf8')) as {
  blueprints: { id: string; name: string; platform: string; intent: string; slots: { block: string; note: string }[] }[]
}
const DICT = JSON.parse(
  fs.readFileSync('src/renderer/src/features/dict/dictionary-bundle.json', 'utf8')
) as { terms: { blocks?: string[] }[] }

const countOf = (block: string): number => DICT.terms.filter((t) => t.blocks?.includes(block)).length

test('蓝图 id 不重复', () => {
  const ids = BP.blueprints.map((b) => b.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('每张蓝图字段齐全，且槽位不少于 3 个', () => {
  for (const b of BP.blueprints) {
    for (const f of ['id', 'name', 'platform', 'intent'] as const) {
      assert.ok(b[f], `${b.id} 缺 ${f}`)
    }
    assert.ok(b.slots.length >= 3, `${b.id} 只有 ${b.slots.length} 个槽位，撑不起一张页面`)
    for (const s of b.slots) assert.ok(s.note, `${b.id} 的「${s.block}」没写 note`)
  }
})

test('端只有移动和桌面两种', () => {
  for (const b of BP.blueprints) assert.ok(['移动', '桌面'].includes(b.platform), `${b.id}: ${b.platform}`)
})

// ── 这条是这一期的核心保证 ──────────────────────────────────────────────
// 蓝图的价值全在「点开有东西」。引用了一个空区块，用户点进去看到一片空白，
// 会以为功能坏了 —— 而这种坏法不会有任何报错。
// 2026-09-04 为此专门补了 34 条词条把 16 个区块全填满，这条测试是不让它退回去。
test('**每个被引用的区块都必须有词条** —— 蓝图里不许有空格子', () => {
  const empty: string[] = []
  for (const b of BP.blueprints) {
    for (const s of b.slots) {
      if (countOf(s.block) === 0) empty.push(`${b.name} 的「${s.block}」`)
    }
  }
  assert.deepEqual(empty, [])
})

test('被引用的区块都在区块名单里', () => {
  const bad: string[] = []
  for (const b of BP.blueprints) {
    for (const s of b.slots) {
      if (!(DICT_BLOCKS as readonly string[]).includes(s.block)) bad.push(`${b.id}: ${s.block}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('同一张蓝图里区块不重复出现', () => {
  for (const b of BP.blueprints) {
    const bs = b.slots.map((s) => s.block)
    assert.equal(new Set(bs).size, bs.length, `${b.id} 有重复区块`)
  }
})

test('每个有词条的区块至少被一张蓝图用到 —— 否则那批词条按蓝图路径永远走不到', () => {
  const used = new Set(BP.blueprints.flatMap((b) => b.slots.map((s) => s.block)))
  const orphan = DICT_BLOCKS.filter((b) => countOf(b) > 0 && !used.has(b))
  assert.deepEqual(orphan, [])
})
