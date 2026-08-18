import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NO_SILENCE,
  SILENCE_TIMEOUT_MS,
  silenceAfterSlash,
  endSilence,
  shouldSilence
} from './slashSilence.ts'

const T0 = 1_000_000

test('没进静默期时什么都不吞', () => {
  for (const k of ['turn.start', 'text.delta', 'turn.done', 'session.ready']) {
    assert.equal(shouldSilence(NO_SILENCE, k, T0).silenced, false, k)
  }
})

test('发两条 slash 就吞两个 turn，第三个 turn 正常显示', () => {
  let st = silenceAfterSlash(NO_SILENCE, 2, T0)
  // 第一个 turn 的文本和收尾都吞掉
  assert.equal(shouldSilence(st, 'text.delta', T0).silenced, true)
  let r = shouldSilence(st, 'turn.done', T0)
  assert.equal(r.silenced, true)
  st = r.next
  // 第二个
  assert.equal(shouldSilence(st, 'text.delta', T0).silenced, true)
  r = shouldSilence(st, 'turn.done', T0)
  assert.equal(r.silenced, true)
  st = r.next
  // 第三个是用户真正的对话，必须放行
  assert.equal(shouldSilence(st, 'text.delta', T0).silenced, false)
})

// CLI 换完模型会重推一次 init，那条是「当前模型听 CLI 报的」的数据来源
test('session.ready 和 error 不吞', () => {
  const st = silenceAfterSlash(NO_SILENCE, 1, T0)
  assert.equal(shouldSilence(st, 'session.ready', T0).silenced, false)
  assert.equal(shouldSilence(st, 'error', T0).silenced, false)
})

test('exec 事件不吞（静默的是回执文本，不是工具执行）', () => {
  const st = silenceAfterSlash(NO_SILENCE, 1, T0)
  assert.equal(shouldSilence(st, 'exec.start', T0).silenced, false)
  assert.equal(shouldSilence(st, 'approval.request', T0).silenced, false)
})

// 最糟的失败方式：计数清不掉，之后所有真实回复都被吞
test('超时兜底：CLI 不回 turn.done 也会自己退出静默', () => {
  const st = silenceAfterSlash(NO_SILENCE, 1, T0)
  const r = shouldSilence(st, 'text.delta', T0 + SILENCE_TIMEOUT_MS + 1)
  assert.equal(r.silenced, false)
  assert.deepEqual(r.next, NO_SILENCE, '超时后状态要清干净，不能每条都重算一次')
})

test('超时边界内仍然静默', () => {
  const st = silenceAfterSlash(NO_SILENCE, 1, T0)
  assert.equal(shouldSilence(st, 'text.delta', T0 + SILENCE_TIMEOUT_MS).silenced, true)
})

test('用户开口立刻解除，他要的答复不许被吞', () => {
  const st = silenceAfterSlash(NO_SILENCE, 3, T0)
  assert.equal(shouldSilence(endSilence(), 'text.delta', T0).silenced, false)
  assert.ok(st.turns > 0, '原状态确实处在静默期，对照用')
})

test('连着切两次，计数累加而不是覆盖', () => {
  let st = silenceAfterSlash(NO_SILENCE, 2, T0)
  st = silenceAfterSlash(st, 1, T0 + 100)
  assert.equal(st.turns, 3)
})

test('n<=0 不改变状态', () => {
  assert.equal(silenceAfterSlash(NO_SILENCE, 0, T0), NO_SILENCE)
})
