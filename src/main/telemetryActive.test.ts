import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTIVE_IDLE_S, cappedActiveSeconds, isActiveSample } from './telemetryActive.ts'

test('在用判据：窗口在前台且最近有键鼠才算', () => {
  assert.equal(isActiveSample(true, 0), true)
  assert.equal(isActiveSample(true, ACTIVE_IDLE_S - 1), true)
  assert.equal(isActiveSample(true, ACTIVE_IDLE_S), false, '静置满 60 秒不算在用')
  assert.equal(isActiveSample(false, 0), false, '窗口不在前台不算，哪怕在别的应用里打字')
  assert.equal(isActiveSample(true, Number.NaN), false)
  assert.equal(isActiveSample(true, -1), false)
})

test('上报的在用秒数不超过这段总时长，坏值按 0', () => {
  assert.equal(cappedActiveSeconds(300, 120_000), 120)
  assert.equal(cappedActiveSeconds(10, 15_000), 10, '采样粒度多算的部分封顶')
  assert.equal(cappedActiveSeconds(-5, 15_000), 0)
  assert.equal(cappedActiveSeconds(300, Number.NaN), 0)
  assert.equal(cappedActiveSeconds(Number.POSITIVE_INFINITY, 15_000), 0)
  assert.equal(cappedActiveSeconds(300, -1000), 0)
})
