import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortNum, cacheHitRate, statsSegments } from './chatStats.ts'

test('shortNum：千位以下原样，上万不留小数', () => {
  assert.equal(shortNum(0), '0')
  assert.equal(shortNum(999), '999')
  assert.equal(shortNum(1234), '1.2K')
  assert.equal(shortNum(21100), '21K')
  assert.equal(shortNum(2_400_000), '2.4M')
})

test('缓存命中率：分母是 cached + input，不是 input', () => {
  // 命中 49% ≈ 参考 UI 里那个数：cached 4900 / (4900 + 5100)
  assert.equal(Math.round(cacheHitRate(5100, 4900)! * 100), 49)
})

test('缓存命中率：没有 cached 字段就是「不知道」，不是 0%', () => {
  assert.equal(cacheHitRate(5000, undefined), null)
})

test('什么都没有时不出任何段（整行不渲染）', () => {
  assert.deepEqual(statsSegments({ turns: 0, steps: 0 }), [])
})

test('只报了轮数就只显示轮数，不编步数', () => {
  assert.deepEqual(statsSegments({ turns: 1, steps: 0 }), ['1 轮'])
})

test('齐全时的完整一行', () => {
  const segs = statsSegments({ turns: 1, steps: 2, inputTokens: 5100, cachedInputTokens: 4900, outputTokens: 251, costUsd: 0.0123 })
  // 输入是总量 5100 + 4900 = 10K，不是「这次真读的」5.1K
  assert.deepEqual(segs, ['1 轮 · 2 步', '缓存命中 49%', '输入 10K · 输出 251', '$0.01'])
})

test('花费为 0 也显示（免费额度内是有意义的信息）', () => {
  assert.ok(statsSegments({ turns: 1, steps: 0, costUsd: 0 }).includes('$0.0000'))
})

test('缓存命中率高时，输入不会显示成一个荒唐的小数字', () => {
  // 真跑一轮实测到的形状：这次真读 2 个 token，其余全走缓存
  const segs = statsSegments({ turns: 1, steps: 0, inputTokens: 2, cachedInputTokens: 21000, outputTokens: 3 })
  assert.ok(segs.some((x) => x.startsWith('输入 21K')), '要报总量，不是 2')
})
