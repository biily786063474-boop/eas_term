import { test } from 'node:test'
import assert from 'node:assert/strict'
import { healthOf, fmtAge, STALL_MS } from './agentAge.ts'

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
