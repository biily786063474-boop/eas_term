import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpuBusyPercent } from './cpuMetrics.ts'
const core = (idle: number, user: number) => ({ idle, user, nice: 0, sys: 0, irq: 0 })
test('所有核心按总ticks归一化，不把单核心百分比相加', () => {
  assert.equal(cpuBusyPercent([core(0, 0), core(0, 0)], [core(0, 100), core(100, 0)]), 50)
})
test('完全空闲为0，完全忙为100', () => {
  assert.equal(cpuBusyPercent([core(10, 20)], [core(110, 20)]), 0)
  assert.equal(cpuBusyPercent([core(10, 20)], [core(10, 120)]), 100)
})
test('首帧、空核心、核心数改变或零间隔为未知', () => {
  assert.equal(cpuBusyPercent(null, [core(0, 0)]), null)
  assert.equal(cpuBusyPercent([], []), null)
  assert.equal(cpuBusyPercent([core(0, 0)], [core(0, 0), core(1, 2)]), null)
  assert.equal(cpuBusyPercent([core(1, 2)], [core(1, 2)]), null)
})
test('计数回退或非有限值不能伪装成低占用', () => {
  assert.equal(cpuBusyPercent([core(5, 5)], [core(4, 15)]), null)
  for (const bad of [NaN, Infinity, -1]) {
    assert.equal(cpuBusyPercent([core(0, 0)], [core(bad, 20)]), null)
  }
})
test('使用各核心时间差加权且不修改输入', () => {
  const before = [core(0, 0), core(0, 0)]
  const after = [core(100, 0), core(0, 300)]
  const saved = JSON.stringify({ before, after })
  assert.equal(cpuBusyPercent(before, after), 75)
  assert.equal(JSON.stringify({ before, after }), saved)
})
