import { test } from 'node:test'
import assert from 'node:assert/strict'
import { healthOf, fmtAge, labelOf, isSettled, ageMsOf, STALL_MS } from './agentAge.ts'

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

test('团队 agent 的 idle 说「这轮完了」，不承诺「干完了」', () => {
  // busy 只反映 turn 结束，而 turn 结束有两种：真干完了，和「干了一半先说到这」。
  // 实测踩过：dup-verifier 报着 idle，findings 最后一行写着「结论逐条填充中」。
  // 标签替它下结论的话，人看一眼就不去读文件了
  assert.equal(labelOf('idle', true), '这轮完了')
  assert.equal(labelOf('idle', false), '空闲')
  assert.ok(!labelOf('idle', true).includes('交活'), '别承诺任务完成')
})

test('除 idle 外，是不是团队成员不影响标签', () => {
  for (const h of ['running', 'stalled', 'dead'] as const) {
    assert.equal(labelOf(h, true), labelOf(h, false), `${h} 不该因为身份而变`)
  }
})

// ── 时长那一列该从哪一刻算起 ────────────────────────────────────────

test('在跑 → 跑了多久（用 startedAt，不是 lastActiveAt）', () => {
  // 用 lastActiveAt 的话这里恒趋近 0：每块 stdout 都会续期，
  // 面板会显示「在跑 0s」，被读成「跑了 0 秒」
  assert.equal(ageMsOf('running', 1000, 9000, 10_000), 9000)
})

test('可能卡住 → 静默多久（这个数该涨，越久越该去看）', () => {
  assert.equal(ageMsOf('stalled', 1000, 9000, 10_000), 1000)
  assert.equal(ageMsOf('stalled', 1000, 9000, 20_000), 11_000, '卡着就该继续涨')
})

test('停下来的行是定值 —— now 走了也不变', () => {
  // 这条是用户实测指出来的：一个已经完成的 agent，时间还在一秒秒涨，
  // 看起来像它越来越卡；而那段时间是我们没去管它，不是它出了事
  for (const h of ['idle', 'dead'] as const) {
    const early = ageMsOf(h, 1000, 9000, 10_000)
    const later = ageMsOf(h, 1000, 9000, 999_999)
    assert.equal(early, 8000, `${h} 应该报「这一轮跑了 8 秒」`)
    assert.equal(later, early, `${h} 停下来之后这个数不该再变`)
  }
})
