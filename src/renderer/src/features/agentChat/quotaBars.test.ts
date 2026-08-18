import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotaBars, contextPercent, barSeverity } from './quotaBars.ts'

// 用户要的：五小时 + 周，两个进度条
test('两个窗口都有百分比时出两个条', () => {
  const bars = quotaBars({
    rateLimits: { five_hour: { used_percentage: 12, resets_at: 100 }, seven_day: { used_percentage: 79 } }
  })
  assert.deepEqual(bars.map((b) => [b.label, b.percent]), [['五小时', 12], ['本周', 79]])
  assert.equal(bars[0].resetsAt, 100)
})

// 拿不到就不画 —— 绝不用倒计时或本地累计倒推一个「看起来精确、实则编造」的数字
test('缺百分比的窗口不产出条', () => {
  assert.equal(quotaBars({ rateLimits: { five_hour: { resets_at: 1 } } }).length, 0)
  assert.equal(quotaBars({ rateLimits: { seven_day: { used_percentage: null } } }).length, 0)
  assert.equal(quotaBars(null).length, 0)
  assert.equal(quotaBars({}).length, 0)
})

test('百分比夹到 0–100 并取整', () => {
  const b = quotaBars({ rateLimits: { five_hour: { used_percentage: 120.7 }, seven_day: { used_percentage: -3 } } })
  assert.deepEqual(b.map((x) => x.percent), [100, 0])
})

// 用户报「上下文不准」的根因：我们自己算的口径和 /context 不同
test('上下文优先用 statusline 的原生值，并标记为精确', () => {
  const r = contextPercent({ contextWindow: { used_percentage: 37 } }, 0.047)
  assert.deepEqual(r, { percent: 37, exact: true })
})

test('没有原生值才回退到事件流算的，并标记为不精确', () => {
  const r = contextPercent(null, 0.047)
  assert.deepEqual(r, { percent: 5, exact: false })
})

test('两个都没有 → null（那就别显示）', () => {
  assert.equal(contextPercent(null, undefined), null)
  assert.equal(contextPercent({}, undefined), null)
})

test('告警档', () => {
  assert.equal(barSeverity(10), 0)
  assert.equal(barSeverity(75), 1)
  assert.equal(barSeverity(90), 2)
  assert.equal(barSeverity(100), 2)
})
