import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDLE_TIMEOUT_MS,
  shouldReap,
  planSend,
  applyParamChange,
  type SessionRecord
} from './sessionState.ts'

const base = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  cli: 'claude',
  cwd: '/WORK/proj',
  alive: true,
  lastActiveAt: 1_000_000,
  model: 'sonnet',
  effort: 'medium',
  ...over
})

test('空闲回收阈值是 15 分钟', () => {
  assert.equal(IDLE_TIMEOUT_MS, 15 * 60 * 1000)
})

test('刚活动过的会话不回收', () => {
  const s = base()
  assert.equal(shouldReap(s, s.lastActiveAt + 60_000), false)
})

test('超过 15 分钟没动静的活会话要回收', () => {
  const s = base()
  assert.equal(shouldReap(s, s.lastActiveAt + IDLE_TIMEOUT_MS + 1), true)
})

test('已经死了的会话不重复回收', () => {
  const s = base({ alive: false })
  assert.equal(shouldReap(s, s.lastActiveAt + IDLE_TIMEOUT_MS + 1), false)
})

test('改模型只记为待生效，不动当前会话', () => {
  const s = applyParamChange(base(), { model: 'opus' })
  assert.equal(s.model, 'sonnet', '当前会话的模型不能当场改——那会截断正在跑的任务')
  assert.equal(s.pending?.model, 'opus')
})

test('有待生效参数时，下次发送要重启并 resume', () => {
  const s = applyParamChange(base({ resumeId: 'sess-abc' }), { effort: 'high' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.effort, 'high', '重启要用新参数')
  assert.equal(plan.opts.resumeId, 'sess-abc', '重启必须接上原来的上下文')
})

test('没有待生效参数、进程还活着 → 直接发送，不重启', () => {
  const plan = planSend(base(), 1_000_100)
  assert.equal(plan.action, 'send')
})

test('进程已被回收 → 即使没改参数也要重启并 resume', () => {
  const s = base({ alive: false, resumeId: 'sess-abc' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.resumeId, 'sess-abc')
})

test('从没起过的会话（无 resumeId）重启时不带 resume 参数', () => {
  const s = base({ alive: false, resumeId: undefined })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.resumeId, undefined)
})

// ---- 以下是简报测试之外、覆盖我自己实现分支的补充断言（见任务要求：
// 简报的测试若没盖到实现的某个字段/分支，实现者要自己补） ----

test('[补充] 刚好 15 分钟整——未超过阈值，不回收（锁定"超过"是严格大于）', () => {
  const s = base()
  assert.equal(
    shouldReap(s, s.lastActiveAt + IDLE_TIMEOUT_MS),
    false,
    '"超过 15 分钟"应为严格大于，卡在整 15 分钟不该回收'
  )
})

test('[补充] applyParamChange 连续两次改不同字段——待生效参数要合并，不能互相覆盖丢失', () => {
  const s1 = applyParamChange(base(), { model: 'opus' })
  const s2 = applyParamChange(s1, { effort: 'high' })
  assert.equal(s2.pending?.model, 'opus', '先改的 model 不能被后改的 effort 冲掉')
  assert.equal(s2.pending?.effort, 'high')
})

test('[补充] applyParamChange 不改动 model/effort 之外的字段', () => {
  const before = base({ resumeId: 'sess-xyz', alive: true, lastActiveAt: 42 })
  const after = applyParamChange(before, { model: 'opus' })
  assert.equal(after.id, before.id)
  assert.equal(after.cli, before.cli)
  assert.equal(after.cwd, before.cwd)
  assert.equal(after.alive, before.alive)
  assert.equal(after.lastActiveAt, before.lastActiveAt)
  assert.equal(after.resumeId, before.resumeId)
})

test('[补充] 重启时，opts 里未被 patch 的字段保留当前值，不会因为只改了 effort 就丢了 model', () => {
  const s = applyParamChange(base({ resumeId: 'sess-abc' }), { effort: 'high' })
  const plan = planSend(s, 2_000_000)
  assert.equal(plan.action, 'restart')
  assert.equal(plan.opts.model, 'sonnet', 'model 没被 patch，重启也不该丢')
  assert.equal(plan.opts.cwd, s.cwd, 'restart 的 opts 必须带上正确的 cwd')
})

test('[补充] 直接 send 时，opts 也要如实反映当前会话参数（不是占位空值）', () => {
  const s = base({ resumeId: 'sess-abc' })
  const plan = planSend(s, 1_000_100)
  assert.equal(plan.action, 'send')
  assert.equal(plan.opts.cwd, s.cwd)
  assert.equal(plan.opts.model, 'sonnet')
  assert.equal(plan.opts.effort, 'medium')
  assert.equal(plan.opts.resumeId, 'sess-abc')
})
