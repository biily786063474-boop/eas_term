import { test } from 'node:test'
import assert from 'node:assert'
import { statusOf, locate, byProject, sortRows } from './machine.ts'
import type { RawSignals } from './machine.ts'

const raw = (o: Partial<RawSignals> = {}): RawSignals => ({
  runningPtys: [],
  attentionPtys: [],
  ptyApproval: {},
  ptyTiming: {},
  ...o
})

// ── 三态判定 ──
test('在 runningPtys 里 = running', () => {
  assert.strictEqual(statusOf('p1', raw({ runningPtys: ['p1'] })), 'running')
})

test('不在 running、在 attention、有问句 = approval', () => {
  const r = raw({ attentionPtys: ['p1'], ptyApproval: { p1: { question: '要删吗' } } })
  assert.strictEqual(statusOf('p1', r), 'approval')
})

test('不在 running、在 attention、无问句 = done', () => {
  assert.strictEqual(statusOf('p1', raw({ attentionPtys: ['p1'] })), 'done')
})

test('三态互斥：running 优先于 attention', () => {
  // spinner 又转起来了但 attention 还没清 —— 以 running 为准
  const r = raw({ runningPtys: ['p1'], attentionPtys: ['p1'] })
  assert.strictEqual(statusOf('p1', r), 'running')
})

test('什么都不在 = null', () => {
  assert.strictEqual(statusOf('p1', raw()), null)
})

// ── 权威性：attentionPtys 说了算 ──
test('ptyApproval 有残留但不在 attentionPtys 里 → null 而不是 approval', () => {
  const r = raw({ ptyApproval: { p1: { question: '上一轮的残留' } } })
  assert.strictEqual(statusOf('p1', r), null)
})

// ── 聚合 ──
const ctx = {
  tabs: [
    { id: 't1', projectId: 'pr1', title: '演示', root: leafTree('l1', 'p1') },
    { id: 't2', projectId: 'pr1', title: '演示', root: leafTree('l2', 'p2') },
    { id: 't3', projectId: 'pr1', title: '演示', root: leafTree('l3', 'p3') }
  ],
  frames: [],
  projects: [{ id: 'pr1', name: '演示', path: '/tmp/demo' }]
}

test('3 个终端 2 done 1 running → 项目行是 done、计数 2', () => {
  const r = raw({ attentionPtys: ['p1', 'p2'], runningPtys: ['p3'] })
  const rows = byProject(['p1', 'p2', 'p3'], r, ctx)
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].top, 'done')
  assert.strictEqual(rows[0].count, 2)
})

test('同项目里有 approval 时，项目行显示 approval（比 done 更急）', () => {
  const r = raw({
    attentionPtys: ['p1', 'p2'],
    ptyApproval: { p2: { question: '要删吗' } }
  })
  const rows = byProject(['p1', 'p2'], r, ctx)
  assert.strictEqual(rows[0].top, 'approval')
  assert.strictEqual(rows[0].focusPtyId, 'p2', '点击要落到最紧急的那个终端')
})

test('项目里一个终端都没有 → 不产生行', () => {
  assert.strictEqual(byProject([], raw(), ctx).length, 0)
})

test('清掉一个 done，同项目里另一个 done 不受影响（计数从 2 变 1，行还在）', () => {
  // 规格 §5 点名要测的那条：「聚焦那个终端 → 清；聚焦同项目的**别的**终端 → 不清」。
  // 清除动作本身是 focusTerminal 调 clearAttention(ptyId)——只摘那一个 id。
  // 这里测的是它在聚合层的可见后果：另一个还在。
  const before = byProject(['p1', 'p2'], raw({ attentionPtys: ['p1', 'p2'] }), ctx)
  assert.strictEqual(before[0].count, 2)
  const after = byProject(['p1', 'p2'], raw({ attentionPtys: ['p2'] }), ctx)
  assert.strictEqual(after.length, 1, '另一个还是 done，这一行不该消失')
  assert.strictEqual(after[0].count, 1)
  assert.strictEqual(after[0].focusPtyId, 'p2')
})

test('终端查不到所属项目 → 不产生行，且不抛异常', () => {
  const r = raw({ attentionPtys: ['nope'] })
  assert.doesNotThrow(() => byProject(['nope'], r, ctx))
  assert.strictEqual(byProject(['nope'], r, ctx).length, 0)
})

// ── 排序 ──
test('approval 排在 done 前，done 排在 running 前', () => {
  const rows = [
    { projectId: 'a', top: 'running' as const, count: 1, focusPtyId: 'x', at: 3 },
    { projectId: 'b', top: 'done' as const, count: 1, focusPtyId: 'y', at: 2 },
    { projectId: 'c', top: 'approval' as const, count: 1, focusPtyId: 'z', at: 1 }
  ]
  assert.deepStrictEqual(sortRows(rows).map((r) => r.projectId), ['c', 'b', 'a'])
})

test('同档内新的排前面', () => {
  const rows = [
    { projectId: 'old', top: 'done' as const, count: 1, focusPtyId: 'x', at: 100 },
    { projectId: 'new', top: 'done' as const, count: 1, focusPtyId: 'y', at: 200 }
  ]
  assert.deepStrictEqual(sortRows(rows).map((r) => r.projectId), ['new', 'old'])
})

// ── locate ──
test('locate 解得出 ptyId 落在哪个 tab / 项目', () => {
  const loc = locate('p1', ctx)
  assert.strictEqual(loc?.tabId, 't1')
  assert.strictEqual(loc?.projectId, 'pr1')
  assert.strictEqual(loc?.project, '演示')
})

test('locate 对不存在的 ptyId 返回 null（终端已关）', () => {
  assert.strictEqual(locate('gone', ctx), null)
})

/** 造一棵只有一个终端叶子的布局树 */
function leafTree(leafId: string, ptyId: string): { type: 'leaf'; id: string; pane: { kind: 'terminal'; ptyId: string } } {
  return { type: 'leaf', id: leafId, pane: { kind: 'terminal', ptyId } }
}
