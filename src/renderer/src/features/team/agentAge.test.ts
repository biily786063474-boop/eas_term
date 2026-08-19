import { test } from 'node:test'
import assert from 'node:assert/strict'
import { healthOf, fmtAge, labelOf, isSettled, ageBasis, STALL_MS } from './agentAge.ts'

const NOW = 1_700_000_000_000

test('进程没了就是 dead，哪怕刚刚才有过动静', () => {
  assert.equal(healthOf(false, NOW - 100, NOW), 'dead')
})

test('busy=false → idle（这一轮跑完了，人还在）', () => {
  assert.equal(healthOf(true, NOW - 100, NOW, false), 'idle')
})

test('busy 未知时按「多久没动」判', () => {
  assert.equal(healthOf(true, NOW - 1000, NOW), 'running')
  assert.equal(healthOf(true, NOW - STALL_MS - 1, NOW), 'stalled')
})

test('刚好卡在阈值上不算卡住（严格大于才算）', () => {
  assert.equal(healthOf(true, NOW - STALL_MS, NOW), 'running')
})

test('fmtAge：秒 / 分秒 / 时分', () => {
  assert.equal(fmtAge(4200), '4s')
  assert.equal(fmtAge(252_000), '4m12s')
  assert.equal(fmtAge(3_780_000), '1h03m')
})

test('fmtAge：负数和非法值不崩，给一个占位', () => {
  assert.equal(fmtAge(-1), '—')
  assert.equal(fmtAge(NaN), '—')
})

// ── 交活判定（team_status 的等待模式与面板共用这一条） ─────────────────

test('busy 还没定过 → 不算交活（会话刚建起来，一轮都没跑过）', () => {
  // 这条最要紧：当成交活的话，team_status 的等待模式会在第一次检查就立刻返回，
  // 挂起等待整个形同虚设 —— 而它恰恰是为「等到有人干完」而存在的
  assert.equal(isSettled(true, undefined), false)
})

test('busy=false → 交活了；busy=true → 还在跑', () => {
  assert.equal(isSettled(true, false), true)
  assert.equal(isSettled(true, true), false)
})

test('进程没了一律算结束，不管 busy 停在哪个值', () => {
  // 崩在半路的会话 busy 可能还停在 true，但它不会再产出任何东西了
  assert.equal(isSettled(false, true), true)
  assert.equal(isSettled(false, undefined), true)
})

// ── 状态标签：同一个 idle，两种会话两种意思 ──────────────────────────

test('团队 agent 的 idle 是「已交活」，不是「空闲」', () => {
  assert.equal(labelOf('idle', true), '已交活')
  assert.equal(labelOf('idle', false), '空闲')
})

test('除 idle 外，是不是团队成员不影响标签', () => {
  for (const h of ['running', 'stalled', 'dead'] as const) {
    assert.equal(labelOf(h, true), labelOf(h, false), `${h} 不该因为身份而变`)
  }
})

// ── 时长那一列该从哪一刻算起 ────────────────────────────────────────

test('在跑 → 从 startedAt 算（答「跑了多久」）', () => {
  // 用 lastActiveAt 的话这里恒趋近 0：每块 stdout 都会续期，
  // 面板会显示「在跑 0s」，被读成「跑了 0 秒」
  assert.equal(ageBasis('running', 1000, 9000), 1000)
})

test('不在跑 → 从 lastActiveAt 算（答「多久没动静」）', () => {
  for (const h of ['stalled', 'idle', 'dead'] as const) {
    assert.equal(ageBasis(h, 1000, 9000), 9000, `${h} 该看静默时长`)
  }
})
