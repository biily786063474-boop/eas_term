import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codexQuotaFromLine, clampPercent, windowLabel } from './quota.ts'

const NOW = 1_700_000_000_000

// 真实样本（2026-08-21 从 ~/.codex/sessions 里取的一行，删掉了无关字段）
const REAL = JSON.stringify({
  timestamp: '2026-08-14T19:19:28.063Z',
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: { total_tokens: 12172 }, model_context_window: 258400 },
    rate_limits: {
      primary: { used_percent: 1.0, window_minutes: 43200, resets_at: 1789322408 },
      secondary: null,
      plan_type: 'free'
    }
  }
})

test('从真实的 token_count 行里抽出额度', () => {
  const q = codexQuotaFromLine(REAL, NOW)
  assert.ok(q)
  assert.equal(q.primary?.percent, 1)
  assert.equal(q.primary?.windowMinutes, 43200)
  assert.equal(q.primary?.resetsAt, 1789322408)
  assert.equal(q.secondary, undefined, 'free 计划没有第二个窗口')
  assert.equal(q.planType, 'free')
})

test('不是 token_count 的行一律 null', () => {
  assert.equal(codexQuotaFromLine(JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }), NOW), null)
  assert.equal(codexQuotaFromLine('{"type":"response_item"}', NOW), null)
})

test('坏行不抛 —— 这是别人的私有日志格式，随时可能变', () => {
  assert.equal(codexQuotaFromLine('不是 json', NOW), null)
  assert.equal(codexQuotaFromLine('', NOW), null)
  assert.equal(codexQuotaFromLine('{"payload":{"type":"token_count"}}', NOW), null, '没有 rate_limits')
  assert.equal(
    codexQuotaFromLine('{"payload":{"type":"token_count","rate_limits":{"primary":{}}}}', NOW),
    null,
    '有 rate_limits 但没有百分比 —— 不能编一个 0 出来'
  )
})

test('百分比钳制到 0–100，不猜单位', () => {
  assert.equal(clampPercent(1.0), 1)
  assert.equal(clampPercent(68.4), 68)
  assert.equal(clampPercent(-5), 0)
  assert.equal(clampPercent(150), 100)
  assert.equal(clampPercent('68'), undefined, '字符串不认')
  assert.equal(clampPercent(NaN), undefined)
})

test('窗口长度说人话', () => {
  assert.equal(windowLabel(300), '5 小时')
  assert.equal(windowLabel(10080), '本周')
  assert.equal(windowLabel(43200), '30 天')
  assert.equal(windowLabel(60), '60 分钟')
  assert.equal(windowLabel(undefined), '当前窗口')
})
