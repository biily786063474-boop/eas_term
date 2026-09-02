import { test } from 'node:test'
import assert from 'node:assert/strict'

import { quotaSegments } from './segments.ts'
import type { CliQuota } from '../../../../shared/quota.ts'

const NOW = 1_788_000_000_000
/** 一个还没过期的窗口（resetsAt 在将来） */
const live = (percent: number, label?: string): CliQuota => ({
  primary: { percent, at: NOW, src: 'omp', resetsAt: Math.floor(NOW / 1000) + 3600 },
  updatedAt: NOW,
  ...(label ? { label } : {})
})
/** 已经过了重置时刻 —— `isWindowExpired` 判它作废 */
const stale = (percent: number): CliQuota => ({
  primary: { percent, at: NOW, src: 'omp', resetsAt: Math.floor(NOW / 1000) - 3600 },
  updatedAt: NOW
})

test('都没数据 → 空数组（整条额度条不出现）', () => {
  assert.deepEqual(quotaSegments({}, NOW), [])
})

test('只有一家有数据就只出一段', () => {
  const segs = quotaSegments({ claude: live(30) }, NOW)
  assert.deepEqual(segs.map((s) => s.name), ['Claude Code'])
})

test('**三家都有数据时三段都要在** —— 加第三段最容易漏的就是这个', () => {
  const segs = quotaSegments({ claude: live(1), codex: live(2), omp: live(3) }, NOW)
  assert.equal(segs.length, 3)
})

test('段序固定：Codex → Claude Code → omp，**不随快照的键序变**', () => {
  // 顺序每次不一样的话，用户每次瞟一眼都要重新找哪个是哪个。
  const segs = quotaSegments({ omp: live(3), claude: live(1), codex: live(2) }, NOW)
  assert.deepEqual(segs.map((s) => s.name), ['Codex', 'Claude Code', 'omp'])
})

test('omp 那段的名字取 label —— 同一个 omp 可以配不同服务商', () => {
  const segs = quotaSegments({ omp: live(3, 'omp · anthropic') }, NOW)
  assert.deepEqual(segs.map((s) => s.name), ['omp · anthropic'])
})

test('数据过期的那家不出段（窗口已经重置了，那个数字不再代表任何东西）', () => {
  const segs = quotaSegments({ claude: stale(90), omp: live(5) }, NOW)
  assert.deepEqual(segs.map((s) => s.name), ['omp'])
})
