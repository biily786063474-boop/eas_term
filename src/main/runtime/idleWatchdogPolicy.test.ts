import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createIdleWatchdogPolicy, summarizeCpuProfile } from './idleWatchdogPolicy.ts'

const opts = { threshold: 20, consecutive: 2, cooldownMs: 600_000, maxCaptures: 5 }
const s = (at: number, renderer: number, extra: Partial<{ busy: boolean; voice: boolean }> = {}) => ({ at, rendererCpu: renderer, busy: false, voice: false, ...extra })

test('连续两次超阈值才触发，抓完仍在烧则进冷却', () => {
  const p = createIdleWatchdogPolicy(opts)
  assert.equal(p.next(s(0, 45)), 'watch')
  assert.equal(p.next(s(30_000, 45)), 'capture')
  assert.equal(p.next(s(60_000, 45)), 'cooldown')
})

test('中间掉下来一次就重新数', () => {
  const p = createIdleWatchdogPolicy(opts)
  p.next(s(0, 45))
  assert.equal(p.next(s(30_000, 3)), 'idle')
  assert.equal(p.next(s(60_000, 45)), 'watch')
})

test('有会话在忙或语音在采集时不算空闲，也不累计', () => {
  const p = createIdleWatchdogPolicy(opts)
  assert.equal(p.next(s(0, 45, { busy: true })), 'skip')
  assert.equal(p.next(s(30_000, 45, { voice: true })), 'skip')
  assert.equal(p.next(s(60_000, 45)), 'watch')
})

test('冷却期内不重复抓，冷却结束仍在烧就再抓', () => {
  const p = createIdleWatchdogPolicy(opts)
  p.next(s(0, 45)); assert.equal(p.next(s(30_000, 45)), 'capture')
  assert.equal(p.next(s(60_000, 45)), 'cooldown')
  assert.equal(p.next(s(90_000, 45)), 'cooldown')
  // 一直在烧：冷却一到就再抓，不用重新数
  assert.equal(p.next(s(660_000, 45)), 'capture')
})

test('一次运行最多抓 maxCaptures 份', () => {
  const p = createIdleWatchdogPolicy({ ...opts, cooldownMs: 0, maxCaptures: 2 })
  p.next(s(0, 45)); assert.equal(p.next(s(1, 45)), 'capture')
  assert.equal(p.next(s(2, 45)), 'capture')
  assert.equal(p.next(s(3, 45)), 'exhausted')
})

test('非法读数（NaN / 负数）当作没读到', () => {
  const p = createIdleWatchdogPolicy(opts)
  assert.equal(p.next(s(0, Number.NaN)), 'idle')
  assert.equal(p.next(s(30_000, -1)), 'idle')
})

test('profile 汇总：按 self time 排，去掉 idle/program/gc，给出忙碌占比', () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 }, children: [2, 3, 4] },
      { id: 2, callFrame: { functionName: '(idle)', url: '', lineNumber: -1 } },
      { id: 3, callFrame: { functionName: 'measure', url: 'file:///x/out/renderer/assets/index-abc.js', lineNumber: 5597 } },
      { id: 4, callFrame: { functionName: '', url: 'file:///x/out/renderer/assets/index-abc.js', lineNumber: 12 } }
    ],
    samples: [2, 2, 3, 3, 3, 4, 2],
    timeDeltas: [500, 500, 500, 500, 500, 500, 500]
  }
  const sum = summarizeCpuProfile(profile)
  assert.equal(sum.busyPercent, 57.1)
  assert.deepEqual(sum.top.slice(0, 2), [
    { name: 'measure @ index-abc.js:5597', ms: 1.5 },
    { name: '(anon) @ index-abc.js:12', ms: 0.5 }
  ])
})
