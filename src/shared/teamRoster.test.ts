import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRoster, addBatch, recentSummary, EMPTY_ROSTER, MAX_BATCHES } from './teamRoster.ts'

const mk = (id: string, at = 0) => ({ id, at, goal: `目标${id}`, agents: [{ role: `r${id}`, task: 't' }] })

test('文件不存在或坏了 → 空花名册，不抛', () => {
  // 这份文件坏了不该让派活失败：它是记录，不是前提
  for (const bad of [null, '', 'not json', '{', '{"batches":"x"}', '[]']) {
    assert.deepEqual(parseRoster(bad), EMPTY_ROSTER, `${JSON.stringify(bad)} 应该退化成空`)
  }
})

test('缺字段的批次被过滤掉，好的保留', () => {
  const raw = JSON.stringify({ v: 1, batches: [mk('a'), { id: 'b' }, mk('c')] })
  assert.deepEqual(parseRoster(raw).batches.map((b) => b.id), ['a', 'c'])
})

test('新批次排在最前面', () => {
  const r = addBatch(addBatch(EMPTY_ROSTER, mk('old')), mk('new'))
  assert.equal(r.batches[0].id, 'new', '读的人几乎总是要最近那批')
})

test('超过上限丢最旧的', () => {
  let r = EMPTY_ROSTER
  for (let i = 0; i < MAX_BATCHES + 3; i++) r = addBatch(r, mk(String(i), i))
  assert.equal(r.batches.length, MAX_BATCHES)
  assert.equal(r.batches[0].id, String(MAX_BATCHES + 2), '最新的还在')
  assert.ok(!r.batches.some((b) => b.id === '0'), '最旧的被丢了')
})

test('摘要要说清「进程没了但产出还在」', () => {
  // 这句话是给「我不记得派过活」那个场景用的，不指路等于没说
  const r = addBatch(EMPTY_ROSTER, { ...mk('x'), at: Date.now() - 5 * 60000 })
  const s = recentSummary(r, Date.now())
  assert.match(s, /5 分钟前/)
  assert.match(s, /findings\.md/, '必须指到产出在哪')
  assert.match(s, /目标x/)
})

test('没有任何批次时返回空串，不硬凑一句话', () => {
  assert.equal(recentSummary(EMPTY_ROSTER, Date.now()), '')
})

test('时间跨度用合适的单位', () => {
  const now = Date.now()
  assert.match(recentSummary(addBatch(EMPTY_ROSTER, { ...mk('a'), at: now - 3 * 3600_000 }), now), /3 小时前/)
  assert.match(recentSummary(addBatch(EMPTY_ROSTER, { ...mk('a'), at: now - 2 * 86400_000 }), now), /2 天前/)
})
