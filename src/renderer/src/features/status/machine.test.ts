import { test } from 'node:test'
import assert from 'node:assert'
import { statusOf, locate, byProject, sortRows, urgencyCmp, attentionKindOf } from './machine.ts'
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
  assert.strictEqual(attentionKindOf('p1', r), null, '通知那一路也认同一个权威')
})

// ── 通知：attentionKindOf 不看 running ──
// 三态讲「终端在干什么」（running 优先），通知讲「agent 举手要你看」，两者正交。
// flagAttention 的三个源里有两个（TerminalView 的 onBell、mcpHandler 的 MCP notify）
// 能在 spinner 还转着的时候触发，MCP notify 甚至是常态——agent 调工具时当然还在跑。
test('还在跑但打了 attention：statusOf 判 running，attentionKindOf 仍给出通知种类', () => {
  const r = raw({ runningPtys: ['p1'], attentionPtys: ['p1'] })
  assert.strictEqual(statusOf('p1', r), 'running')
  assert.strictEqual(attentionKindOf('p1', r), 'done', '灵动岛的通知卡靠这个，不能被 running 吃掉')
})

test('还在跑且解析到问句 → attentionKindOf 是 approval', () => {
  const r = raw({
    runningPtys: ['p1'],
    attentionPtys: ['p1'],
    ptyApproval: { p1: { question: '要删吗' } }
  })
  assert.strictEqual(statusOf('p1', r), 'running')
  assert.strictEqual(attentionKindOf('p1', r), 'approval')
})

test('statusOf 与 attentionKindOf 只有 running 这一处分歧', () => {
  // 锁「statusOf = running 优先 + attentionKindOf」这条结构关系：
  // 谁把 approval/done 的判据在 statusOf 里再写一遍，这条就会失败。
  for (const r of [
    raw({ attentionPtys: ['p1'] }),
    raw({ attentionPtys: ['p1'], ptyApproval: { p1: { question: 'q' } } }),
    raw(),
    raw({ ptyApproval: { p1: { question: '残留' } } })
  ]) {
    assert.strictEqual(statusOf('p1', r), attentionKindOf('p1', r))
  }
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

// ── attn：与 top 正交的「有几个在等你」 ──
//
// 为什么这条能成立、而不会让「陈旧标记」复活：进 runningPtys 的唯一入口是
// uiSlice 的 setPtyRunning(ptyId, true)，而它在同一次 set 里就把该 pty 从
// attentionPtys 摘掉、连 ptyApproval / approvalSentAt 一起删。早退判据
// `if (has === running) return s` 排在那段清除**之前**，所以清除只发生在
// 「非运行 → 运行」那一次跃迁上，跑动期间反复调不会再清。
// 于是：**一个 pty 在 runningPtys 里还带着 attention，只可能是它跑起来之后
// 才被打上的** —— 那正是 onBell / MCP notify 两个源（TerminalView:580 那个源
// 打标记时必然已经 setPtyRunning(false)，构造不出这个组合）。
test('还在跑但叫了你：top 仍是 running，但 attn 数到它', () => {
  const r = raw({ runningPtys: ['p1'], attentionPtys: ['p1'] })
  const rows = byProject(['p1'], r, ctx)
  assert.strictEqual(rows[0].top, 'running', '它确实还在跑，执行状态不能撒谎')
  assert.strictEqual(rows[0].count, 1)
  assert.strictEqual(rows[0].attn, 1, '「要不要显示提醒」判的是这个')
  assert.strictEqual(rows[0].focusPtyId, 'p1')
})

test('纯 running（没人叫你）→ attn 为 0', () => {
  const rows = byProject(['p1', 'p2'], raw({ runningPtys: ['p1', 'p2'] }), ctx)
  assert.strictEqual(rows[0].top, 'running')
  assert.strictEqual(rows[0].attn, 0, '这才是「不该打扰」的那种 running')
})

test('两个都在跑、只有一个叫了你 → 点这一行落到叫你的那个', () => {
  // p2 的 at 更近，按旧规则（top 档里最近的那个）会落到 p2；
  // 但在等你的是 p1，落点必须是 p1——否则点过去看到的是一个没什么要你处理的终端。
  const r = raw({
    runningPtys: ['p1', 'p2'],
    attentionPtys: ['p1'],
    ptyTiming: { p1: { roundStart: 100 }, p2: { roundStart: 200 } }
  })
  const rows = byProject(['p1', 'p2'], r, ctx)
  assert.strictEqual(rows[0].top, 'running')
  assert.strictEqual(rows[0].count, 2)
  assert.strictEqual(rows[0].attn, 1)
  assert.strictEqual(rows[0].focusPtyId, 'p1')
})

test('attn 跨档累加：approval 一个 + 还在跑但叫了你一个 → top 是 approval、attn 是 2', () => {
  // 顺序特意让 running 那个先进来，逼出「出现更急的档位时 attn 不能被重置」这条
  const r = raw({
    runningPtys: ['p1'],
    attentionPtys: ['p1', 'p2'],
    ptyApproval: { p2: { question: '要删吗' } }
  })
  const rows = byProject(['p1', 'p2'], r, ctx)
  assert.strictEqual(rows[0].top, 'approval')
  assert.strictEqual(rows[0].count, 1, 'count 只数 top 这一档')
  assert.strictEqual(rows[0].attn, 2, 'attn 数的是「在等你的」，跨档累加')
  assert.strictEqual(rows[0].focusPtyId, 'p2', '两个都在等你时先去最急的')
})

test('attn 与 top 的关系不是「top !== running」的换皮：有 running 也有 done 时两者都对', () => {
  const r = raw({ runningPtys: ['p3'], attentionPtys: ['p1', 'p2'] })
  const rows = byProject(['p1', 'p2', 'p3'], r, ctx)
  assert.strictEqual(rows[0].top, 'done')
  assert.strictEqual(rows[0].count, 2)
  assert.strictEqual(rows[0].attn, 2, 'p3 只是在跑、没叫你，不算进 attn')
})

test('终端查不到所属项目 → 不产生行，且不抛异常', () => {
  const r = raw({ attentionPtys: ['nope'] })
  assert.doesNotThrow(() => byProject(['nope'], r, ctx))
  assert.strictEqual(byProject(['nope'], r, ctx).length, 0)
})

test('同档两个终端，focusPtyId 跟最近的 at 走，且与遍历顺序无关（修复轮 1）', () => {
  const r = raw({
    attentionPtys: ['p1', 'p2'],
    ptyTiming: { p1: { lastDoneAt: 100 }, p2: { lastDoneAt: 200 } }
  })
  const forward = byProject(['p1', 'p2'], r, ctx)
  assert.strictEqual(forward[0].at, 200)
  assert.strictEqual(forward[0].focusPtyId, 'p2', '这一行的 at 是 200，点下去该去 200 那个终端')
  // 数组顺序倒过来，结果必须不变——focusPtyId 不能是「遍历顺序里第一个撞进这一档的」
  const backward = byProject(['p2', 'p1'], r, ctx)
  assert.strictEqual(backward[0].at, 200)
  assert.strictEqual(backward[0].focusPtyId, 'p2')
})

test('同档两个终端，at 都是 0 时结果确定（修复轮 1）', () => {
  const r = raw({ attentionPtys: ['p1', 'p2'] })
  const first = byProject(['p1', 'p2'], r, ctx)
  const second = byProject(['p1', 'p2'], r, ctx)
  assert.strictEqual(first[0].focusPtyId, second[0].focusPtyId, '同样的输入跑两次必须一样')
  assert.strictEqual(first[0].focusPtyId, 'p1', '都是 0（不满足严格大于）→ 保留先到的那个')
  // 「先到」由数组顺序决定，不是恒等于某个 ptyId——倒过来先到的就是 p2
  const reversed = byProject(['p2', 'p1'], r, ctx)
  assert.strictEqual(reversed[0].focusPtyId, 'p2')
})

// ── 排序 ──
test('approval 排在 done 前，done 排在 running 前', () => {
  const rows = [
    { projectId: 'a', top: 'running' as const, count: 1, attn: 0, focusPtyId: 'x', at: 3 },
    { projectId: 'b', top: 'done' as const, count: 1, attn: 1, focusPtyId: 'y', at: 2 },
    { projectId: 'c', top: 'approval' as const, count: 1, attn: 1, focusPtyId: 'z', at: 1 }
  ]
  assert.deepStrictEqual(sortRows(rows).map((r) => r.projectId), ['c', 'b', 'a'])
})

test('同档内新的排前面', () => {
  const rows = [
    { projectId: 'old', top: 'done' as const, count: 1, attn: 1, focusPtyId: 'x', at: 100 },
    { projectId: 'new', top: 'done' as const, count: 1, attn: 1, focusPtyId: 'y', at: 200 }
  ]
  assert.deepStrictEqual(sortRows(rows).map((r) => r.projectId), ['new', 'old'])
})

// urgencyCmp 是排序的唯一口径：项目行、右上角待处理列表、灵动岛通知队列共用它。
// 谁把它复制成第二份，下面这几条不会失败——但那正是要防的事，所以这里锁的是
// 「这一份的行为」，任何自称等价的第二份都得能过同样的期望。
test('urgencyCmp：approval 排在 done 前，跨档时不看时间', () => {
  // done 更新（at 大）也不能排到 approval 前面
  assert.ok(urgencyCmp('approval', 1, 'done', 999) < 0)
  assert.ok(urgencyCmp('done', 999, 'approval', 1) > 0)
})

test('urgencyCmp：done 排在 running 前', () => {
  assert.ok(urgencyCmp('done', 0, 'running', 999) < 0)
})

test('urgencyCmp：同档内新的在前，完全相同判为等价（稳定排序保留原序）', () => {
  assert.ok(urgencyCmp('done', 200, 'done', 100) < 0)
  assert.strictEqual(urgencyCmp('done', 100, 'done', 100), 0)
})

test('urgencyCmp 排一列待处理终端：两个 approval 在前且新的更前，done 在后', () => {
  // 右上角待处理列表就是这个形状（PendingRow: state + at），这里锁的是它的可见顺序：
  // approval 全部排在 done 前面——规格 §1.1「approval 在任何排序里都排最前」。
  const list = [
    { id: 'done-new', state: 'done' as const, at: 500 },
    { id: 'ap-old', state: 'approval' as const, at: 100 },
    { id: 'done-old', state: 'done' as const, at: 400 },
    { id: 'ap-new', state: 'approval' as const, at: 300 }
  ]
  const sorted = [...list].sort((a, b) => urgencyCmp(a.state, a.at, b.state, b.at))
  assert.deepStrictEqual(sorted.map((r) => r.id), ['ap-new', 'ap-old', 'done-new', 'done-old'])
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

// 上面那个 ctx 的 frames 恒为 []，locate 解析 frameId/nodeId 的那半段一直零覆盖——
// 而 focusTerminal 正是靠 `loc.frameId && loc.nodeId` 分两支走的：
// 有画布节点 → 切画布 + focusCanvasNode；没有 → 切分屏 + setActiveLeaf。
// 分错支的后果就是本轮最严重那条 Critical（跳转看不见、提醒却已经清了）。
const ctxOnCanvas = {
  tabs: [
    { id: 't1', projectId: 'pr1', title: '标签标题', root: leafTree('l1', 'p1') },
    { id: 't2', projectId: 'pr1', title: '标签标题', root: leafTree('l2', 'p2') }
  ],
  // f1 只收了 l1；l2 是 ⌘T / 侧栏开出来的普通终端，没有画布节点
  frames: [
    {
      id: 'f1',
      nodes: [
        { id: 'n-other', leafId: 'l9', name: '别人的节点' },
        { id: 'n1', leafId: 'l1', name: '⠹ 节点名' }
      ]
    }
  ],
  projects: [{ id: 'pr1', name: '演示', path: '/tmp/demo' }]
}

test('终端有画布节点 → locate 解出 frameId / nodeId', () => {
  const loc = locate('p1', ctxOnCanvas)
  assert.strictEqual(loc?.frameId, 'f1')
  assert.strictEqual(loc?.nodeId, 'n1', '要落到 leafId 对得上的那个节点，不是 Frame 里第一个')
  assert.strictEqual(loc?.leafId, 'l1')
})

test('有画布节点时终端名取节点名（并剥掉 spinner），而不是标签标题', () => {
  assert.strictEqual(locate('p1', ctxOnCanvas)?.term, '节点名')
})

test('同一份 ctx 里没上画布的终端：frameId / nodeId 是 undefined', () => {
  // focusTerminal 的另一支。openTerminal（⌘T / 侧栏 / 抽屉双击）只建 tab 不建节点，
  // 所以这才是主流情况，两支都得有用例压着。
  const loc = locate('p2', ctxOnCanvas)
  assert.strictEqual(loc?.tabId, 't2')
  assert.strictEqual(loc?.frameId, undefined)
  assert.strictEqual(loc?.nodeId, undefined)
  assert.strictEqual(loc?.term, '标签标题', '没有节点名就退回标签标题')
})

/** 造一棵只有一个终端叶子的布局树 */
function leafTree(leafId: string, ptyId: string): { type: 'leaf'; id: string; pane: { kind: 'terminal'; ptyId: string } } {
  return { type: 'leaf', id: leafId, pane: { kind: 'terminal', ptyId } }
}

// ── AI 对话节点接入通知系统（2026-08-17）──────────────────────
// 在这之前 locate 里一句 `if (leaf.pane.kind !== 'terminal') continue` 让整套
// 运行监视 / 待处理列表 / 灵动岛 / 提示音 对 AI 对话节点结构性失明 ——
// 用了新前端反而收不到任何完成通知。

test('locate 认得 AI 对话节点（按它的会话 id）', () => {
  const ctx = {
    tabs: [
      {
        id: 't1',
        projectId: 'p1',
        title: '笔纵画板',
        root: { type: 'leaf', id: 'l1', pane: { kind: 'agent', cwd: '/w', sessionId: 'ac-1' } }
      }
    ],
    frames: [],
    projects: [{ id: 'p1', name: '笔纵画板' }]
  }
  const loc = locate('ac-1', ctx as never)
  assert.ok(loc, 'AI 对话节点必须能被定位到，否则通知系统看不见它')
  assert.equal(loc!.leafId, 'l1')
  assert.equal(loc!.projectId, 'p1')
})

test('还没起会话的 AI 对话节点（sessionId 未定）不会被误配', () => {
  const ctx = {
    tabs: [
      { id: 't1', projectId: 'p1', title: 'x', root: { type: 'leaf', id: 'l1', pane: { kind: 'agent', cwd: '/w' } } }
    ],
    frames: [],
    projects: [{ id: 'p1', name: 'x' }]
  }
  // 传 undefined 进去不该匹配上这个 pane（两个 undefined 相等会误配）
  assert.equal(locate(undefined as never, ctx as never), null)
})

test('终端与 AI 对话共存时各自定位到自己那个 leaf', () => {
  const ctx = {
    tabs: [
      {
        id: 't1',
        projectId: 'p1',
        title: 'x',
        root: {
          type: 'split',
          id: 's',
          dir: 'row',
          ratio: 0.5,
          children: [
            { type: 'leaf', id: 'lt', pane: { kind: 'terminal', ptyId: 'pty-9' } },
            { type: 'leaf', id: 'la', pane: { kind: 'agent', cwd: '/w', sessionId: 'ac-9' } }
          ]
        }
      }
    ],
    frames: [],
    projects: [{ id: 'p1', name: 'x' }]
  }
  assert.equal(locate('pty-9', ctx as never)?.leafId, 'lt')
  assert.equal(locate('ac-9', ctx as never)?.leafId, 'la')
})

test('AI 对话节点没有名字时兜底成「AI 对话」，不是「终端」', () => {
  const ctx = {
    tabs: [{ id: 't1', projectId: 'p1', title: '', root: { type: 'leaf', id: 'l1', pane: { kind: 'agent', cwd: '/w', sessionId: 'ac-1' } } }],
    frames: [],
    projects: [{ id: 'p1', name: 'x' }]
  }
  assert.equal(locate('ac-1', ctx as never)?.term, 'AI 对话')
})
