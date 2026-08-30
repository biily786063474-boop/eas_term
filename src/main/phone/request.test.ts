import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  allow,
  deny,
  expired,
  fulfill,
  open,
  publicView,
  REQ_TTL_MS,
  settle,
  type PendingRequest
} from './request.ts'

const NOW = 1_000_000
const mk = (over: Partial<PendingRequest> = {}): Omit<PendingRequest, 'state'> => ({
  id: 'r1',
  deviceId: 'd1',
  deviceName: 'iPhone',
  action: 'newSession',
  title: '在「口播相机」里新建一个 AI 对话',
  args: { projectId: 'p1' },
  createdAt: NOW,
  ...over
})
const waiting = (over: Partial<PendingRequest> = {}): PendingRequest => ({
  ...mk(),
  state: 'waiting',
  ...over
})

// ── 一次只允许一个 ────────────────────────────────────────────
test('没有在等的请求时可以开一个新的', () => {
  const r = open(null, mk(), NOW)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.req.state, 'waiting')
})

test('**已经有一个在等时直接拒** —— 手机连点五下不该在电脑上排出五个弹窗', () => {
  assert.deepEqual(open(waiting(), mk({ id: 'r2' }), NOW), { ok: false, reason: 'busy' })
})

test('上一个已处理完（allowed/denied/done）就能开新的', () => {
  for (const s of ['allowed', 'denied', 'done', 'failed', 'expired'] as const) {
    assert.equal(open(waiting({ state: s }), mk({ id: 'r2' }), NOW).ok, true, s)
  }
})

test('上一个挂过期了也能开新的', () => {
  assert.equal(open(waiting(), mk({ id: 'r2' }), NOW + REQ_TTL_MS).ok, true)
})

// ── 过期 ──────────────────────────────────────────────────────
test('过期判定就是 >=，且只对 waiting 成立', () => {
  assert.equal(expired(waiting(), NOW + REQ_TTL_MS - 1), false)
  assert.equal(expired(waiting(), NOW + REQ_TTL_MS), true)
  // 已经批过的不会因为放久了变成过期
  assert.equal(expired(waiting({ state: 'allowed' }), NOW + REQ_TTL_MS * 5), false)
})

test('settle 把挂太久的推到 expired，不动别的状态', () => {
  assert.equal(settle(waiting(), NOW + REQ_TTL_MS)?.state, 'expired')
  assert.equal(settle(waiting(), NOW)?.state, 'waiting')
  assert.equal(settle(null, NOW), null)
})

// ── 允许 / 拒绝 ───────────────────────────────────────────────
test('允许把 waiting 推到 allowed', () => {
  assert.equal(allow(waiting(), NOW)?.state, 'allowed')
})

test('**过期之后再点允许不算数** —— 人两分钟后才看到那个弹窗', () => {
  assert.equal(allow(waiting(), NOW + REQ_TTL_MS)?.state, 'expired')
})

test('拒绝把 waiting 推到 denied；过期的同样拦住', () => {
  assert.equal(deny(waiting(), NOW)?.state, 'denied')
  assert.equal(deny(waiting(), NOW + REQ_TTL_MS)?.state, 'expired')
})

test('重复点允许不会把 denied 翻回 allowed', () => {
  assert.equal(allow(waiting({ state: 'denied' }), NOW)?.state, 'denied')
})

// ── 完成 ──────────────────────────────────────────────────────
test('只有 allowed 能被 fulfill —— 没批过的动作不该有结果', () => {
  assert.equal(fulfill(waiting(), { ok: true })?.state, 'waiting')
  assert.equal(fulfill(waiting({ state: 'denied' }), { ok: true })?.state, 'denied')
})

test('成功带 result，**失败带 error 而不是装成成功**', () => {
  const a = fulfill(waiting({ state: 'allowed' }), { ok: true, result: { nodeId: 'cnode-1' } })
  assert.equal(a?.state, 'done')
  assert.deepEqual(a?.result, { nodeId: 'cnode-1' })

  const b = fulfill(waiting({ state: 'allowed' }), { ok: false, error: '这个项目没有 Frame' })
  assert.equal(b?.state, 'failed')
  assert.equal(b?.error, '这个项目没有 Frame')
  assert.equal(b?.result, undefined, '失败不能带结果')
})

// ── 给手机看的视图 ────────────────────────────────────────────
test('**publicView 不回 args** —— 那是手机自己发的，回去没意义', () => {
  const v = publicView(waiting(), NOW)
  assert.equal(v.state, 'waiting')
  assert.equal('args' in v, false)
  assert.equal('title' in v, false)
  assert.equal('deviceId' in v, false)
})

test('没有请求时是 none，不是 null / 报错', () => {
  assert.deepEqual(publicView(null, NOW), { state: 'none' })
})

test('轮询时顺手判过期 —— 不养定时器，问的那一刻算准就行', () => {
  assert.equal(publicView(waiting(), NOW + REQ_TTL_MS).state, 'expired')
})

test('done 的结果和 failed 的原因都要透出去', () => {
  assert.deepEqual(publicView(waiting({ state: 'done', result: { nodeId: 'x' } }), NOW), {
    state: 'done',
    result: { nodeId: 'x' },
    error: undefined
  })
  assert.equal(publicView(waiting({ state: 'failed', error: '建不出来' }), NOW).error, '建不出来')
})
