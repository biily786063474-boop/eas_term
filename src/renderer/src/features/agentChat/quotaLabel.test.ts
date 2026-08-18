import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windowLabel, untilReset, severityOf, quotaText } from './quotaLabel.ts'

test('窗口类型翻成中文，认不出的原样显示（不吞成空白或「未知」）', () => {
  assert.equal(windowLabel('five_hour'), '五小时')
  assert.equal(windowLabel('weekly'), '本周')
  assert.equal(windowLabel('some_new_window'), 'some_new_window')
})

test('倒计时不显示秒——瞥一眼的信息，秒级只会让数字乱跳', () => {
  const now = 1_000_000_000_000
  const at = (mins: number): number => (now + mins * 60_000) / 1000
  assert.equal(untilReset(at(0.5), now), '不到 1 分钟')
  assert.equal(untilReset(at(45), now), '45 分钟')
  assert.equal(untilReset(at(60), now), '1 小时')
  assert.equal(untilReset(at(134), now), '2 小时 14 分钟')
  assert.equal(untilReset(at(60 * 30), now), '1 天 6 小时')
})

test('已经过了重置时刻返回 null（时钟偏差/事件过期时别显示倒计时）', () => {
  const now = 1_000_000_000_000
  assert.equal(untilReset((now - 60_000) / 1000, now), null)
  assert.equal(untilReset(undefined, now), null)
  assert.equal(untilReset(NaN, now), null)
})

test('**认不出的状态按正常处理** —— 不该为没见过的状态大呼小叫', () => {
  assert.equal(severityOf('allowed'), 0)
  assert.equal(severityOf(''), 0)
  assert.equal(severityOf('some_new_status'), 0)
})

test('明确表示超限的状态判为最高级', () => {
  for (const s of ['rejected', 'exceeded', 'exhausted', 'rate_limited']) {
    assert.equal(severityOf(s), 2, `${s} 应判为已用尽`)
  }
})

test('quotaText 把窗口、状态、倒计时拼成一句人话', () => {
  const now = 1_000_000_000_000
  const at = (mins: number): number => (now + mins * 60_000) / 1000
  assert.equal(
    quotaText({ window: 'five_hour', status: 'allowed', resetsAt: at(134) }, now),
    '五小时额度 · 2 小时 14 分钟后重置'
  )
  assert.equal(
    quotaText({ window: 'weekly', status: 'rejected', resetsAt: at(60 * 30) }, now),
    '本周额度已用尽 · 1 天 6 小时后重置'
  )
  // 没有 resetsAt 时不硬凑倒计时
  assert.equal(quotaText({ window: 'five_hour', status: 'allowed' }, now), '五小时额度')
})

test('**allowed_warning 判为「该注意」** —— 实测七天窗口 79% 时就是这个状态', () => {
  // 精确等于 'allowed' 那一支不会误吞它（那样会把一次真实的告警当成正常）
  assert.equal(severityOf('allowed_warning'), 1)
  assert.equal(severityOf('allowed'), 0)
})
