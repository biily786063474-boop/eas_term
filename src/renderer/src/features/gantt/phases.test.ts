import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GanttTask } from '../../../../shared/types.ts'
import type { Phase } from './phases.ts'
import { fmtDur, groupPhases, PHASE_GAP_MS } from './phases.ts'

const M = 60_000
const NOW = 1_000_000_000

let seq = 0
const mk = (o: Partial<GanttTask> & { startAt: number }): GanttTask => ({
  id: 'g' + ++seq,
  projectId: 'p1',
  ptyId: '1',
  leafId: 'l1',
  prompt: '干活',
  endAt: o.startAt + 5 * M,
  ...o
})

const one = (ts: GanttTask[], now = NOW): Phase[] => groupPhases(ts, now).get('p1') ?? []

test('间隔小于 30 分钟的连成一段', () => {
  const ph = one([mk({ startAt: 0 }), mk({ startAt: 20 * M })])
  assert.equal(ph.length, 1)
  assert.equal(ph[0].startAt, 0)
  assert.equal(ph[0].endAt, 25 * M)
  assert.equal(ph[0].tasks.length, 2)
})

test('间隔正好 30 分钟就切开——判据是 >=，不是 >', () => {
  // 前一条 0..5m，后一条从 35m 开始 → 空隙正好 30 分钟
  const ph = one([mk({ startAt: 0 }), mk({ startAt: 35 * M })])
  assert.equal(ph.length, 2)
})

test('差一毫秒不切', () => {
  const ph = one([mk({ startAt: 0 }), mk({ startAt: 35 * M - 1 })])
  assert.equal(ph.length, 1)
})

test('结束时间取「最晚一次返回」，不是最后一条的返回', () => {
  // 长任务 0..60m 与短任务 10..15m 重叠；按「上一条的 endAt」算会误判
  const ph = one([mk({ startAt: 0, endAt: 60 * M }), mk({ startAt: 10 * M, endAt: 15 * M })])
  assert.equal(ph.length, 1)
  assert.equal(ph[0].endAt, 60 * M)
})

test('重叠任务不会被误切——断点基准必须是「目前为止最晚的结束」', () => {
  // 长任务 0..60m，之后 50m 处再来一条：距长任务结束只有 10 分钟，同一段
  const ph = one([mk({ startAt: 0, endAt: 60 * M }), mk({ startAt: 50 * M, endAt: 55 * M })])
  assert.equal(ph.length, 1)
})

test('终端和 AI 对话合流进同一段（按项目整体算）', () => {
  const ph = one([
    mk({ startAt: 0, kind: 'terminal', ptyId: '1' }),
    mk({ startAt: 3 * M, kind: 'agent', ptyId: 'ac-2' })
  ])
  assert.equal(ph.length, 1)
  assert.equal(ph[0].tasks.length, 2)
})

test('不同项目各切各的', () => {
  const m = groupPhases([mk({ startAt: 0 }), mk({ startAt: 0, projectId: 'p2' })], NOW)
  assert.equal(m.get('p1')!.length, 1)
  assert.equal(m.get('p2')!.length, 1)
})

test('真在跑的任务把段拉到 now', () => {
  const ph = one([mk({ startAt: NOW - 10 * M, endAt: null })])
  assert.equal(ph[0].endAt, NOW)
  assert.equal(ph[0].running, true)
})

test('被强杀的任务只算到 startAt，不能吞掉后面所有阶段', () => {
  // 三天前一条 aborted。若按 now 算，它会把之后每一段都并进来
  const old = NOW - 3 * 24 * 60 * M
  const ph = one([
    mk({ startAt: old, endAt: null, aborted: true }),
    mk({ startAt: NOW - 20 * M, endAt: NOW - 15 * M })
  ])
  assert.equal(ph.length, 2, 'aborted 记录不该把两段粘成一段')
  assert.equal(ph[0].endAt, old, '结束时间不编造，只到它开始的那一刻')
  assert.equal(ph[0].hasAborted, true)
  assert.equal(ph[0].running, false, 'aborted 不算「在跑」')
})

test('整段都是 aborted 时退化成零长，不出负数', () => {
  const ph = one([mk({ startAt: 5 * M, endAt: null, aborted: true })])
  assert.equal(ph[0].endAt, 5 * M)
  assert.ok(ph[0].endAt >= ph[0].startAt)
})

test('输入无序也能正确切', () => {
  const ph = one([mk({ startAt: 100 * M }), mk({ startAt: 0 }), mk({ startAt: 10 * M })])
  assert.equal(ph.length, 2)
  assert.equal(ph[0].tasks.length, 2)
})

test('阈值可传——同一批数据换阈值会切出不同段数', () => {
  const ts = [mk({ startAt: 0 }), mk({ startAt: 20 * M })]
  assert.equal(groupPhases(ts, NOW, 10 * M).get('p1')!.length, 2)
  assert.equal(groupPhases(ts, NOW, PHASE_GAP_MS).get('p1')!.length, 1)
})

test('空输入不抛', () => {
  assert.equal(groupPhases([], NOW).size, 0)
})

test('id 稳定：同一批数据重算得到同一个 id', () => {
  const ts = [mk({ startAt: 7 * M })]
  assert.equal(groupPhases(ts, NOW).get('p1')![0].id, groupPhases(ts, NOW).get('p1')![0].id)
})

test('fmtDur', () => {
  assert.equal(fmtDur(51 * M), '51m')
  assert.equal(fmtDur(60 * M), '1h')
  assert.equal(fmtDur(130 * M), '2h10m')
  assert.equal(fmtDur(-5), '0m')
})
