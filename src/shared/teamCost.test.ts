import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tally, fmtTokens, fmtCost, ZERO_TALLY } from './teamCost.ts'

test('token 累加，花费取最新 —— 两者语义相反（实测确认）', () => {
  let t = tally(ZERO_TALLY, { inputTokens: 2, outputTokens: 3, cachedInputTokens: 15895 }, 0.321313)
  t = tally(t, { inputTokens: 2, outputTokens: 3, cachedInputTokens: 47223 }, 0.345369)
  assert.equal(t.tokensIn, 2 + 15895 + 2 + 47223, '输入要累加，且含缓存命中')
  assert.equal(t.tokensOut, 6, '输出是单轮值，两轮各 3')
  assert.equal(t.costUsd, 0.345369, '花费是会话累计，直接取最新而不是相加')
})

test('某一轮不带 costUsd 时保留上一次的，不置回 undefined', () => {
  // 置回去会让面板上的金额忽然消失，看起来像出了错
  let t = tally(ZERO_TALLY, { outputTokens: 1 }, 0.5)
  t = tally(t, { outputTokens: 1 })
  assert.equal(t.costUsd, 0.5)
})

test('缺字段一律按 0 处理，不炸', () => {
  const t = tally(ZERO_TALLY, {})
  assert.deepEqual({ i: t.tokensIn, o: t.tokensOut }, { i: 0, o: 0 })
  assert.equal(t.costUsd, undefined)
})

test('token 格式化', () => {
  assert.equal(fmtTokens(999), '999')
  assert.equal(fmtTokens(1500), '1.5K')
  assert.equal(fmtTokens(46200), '46K')
  assert.equal(fmtTokens(2_300_000), '2.3M')
})

test('拿不到花费时返回空串，绝不显示 $0.00', () => {
  // $0.00 会被读成「没花钱」，而真相是这个 CLI 不报价（Codex 就不报）
  assert.equal(fmtCost(undefined), '')
  assert.equal(fmtCost(NaN), '')
  assert.equal(fmtCost(0.83), '$0.83')
  assert.equal(fmtCost(0.003), '<$0.01', '极小额也要看得出花了钱')
})
