// **隔离基线（下半场）**：Claude / Codex 的「ChatEvent → 界面视图」逐字快照。
// 上半场（「CLI 原始输出 → ChatEvent」）在 `src/main/agentChat/isolationBaseline.test.ts`，
// 那份文件头写了这两个测试为什么存在、为什么拆成两个单层文件、红了怎么办 —— 先读它。
//
// ── 这里有两组用例，缺一组都盖不住 ─────────────────────────────────────────
// **① 真录组**（`fx-` 前缀）：上半场从 2026-08-14 真录的 CLI 输出翻译出来的事件流，
//    原样喂进归约器。它的价值是形状真实（思考流的密度、执行卡片的配对、Codex 每条消息
//    一个新进程），但它只盖到 14 个 `ChatEvent` 变体里的 7 个 ——
//    `error` / `approval.request` / `approval.resolved` / `compacted` / `user.message` /
//    `turn.start` / `text.delta` **翻译器根本不产**，它们由 `session.ts`、审批 hook、
//    手机端另外三条路喂进来。
//
// **② 手写组**（`synth-` 前缀）：把剩下那 7 个变体、以及归约器里几处「注释专门写过、
//    改坏了不报错」的行为逐条钉死。合成事件不如真录可信，但这些路径**没有真录**可用，
//    而它们恰恰是 omp 接入要动的地方：`error.kind` 要从 `'auth'` 放宽成 `'auth' | 'setup'`，
//    审批卡片是 omp 走的既有链路（Claude 那条硬审批今天是休眠的，omp 会是它第一个生产用户）。
//    没有第二组的话，把 `Notice.kind` 改错、把 pending 槽位改成数组，这份基线全绿。
//
// **上半场的 JSON 在这里是「数据」不是「代码」**：用 fs 读，不 import。
// 两个 tsconfig 都是 composite，import 对方的 .ts 会 TS6307；读一份 JSON 不会，
// 也不需要往共享配置里加任何 include。代价是那条路径没有编译期保护 —— 上半场改快照名要同步改这里。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { createChatReducer, MAX_LIVE_TURNS, MAX_NOTICES } from './reduce.ts'
import type { ChatEvent } from '../../../../shared/agentChat.ts'

/** 上半场的产物。它先跑、这里后跑；上半场红了就先修那边，这边的红多半是连带的。 */
const EVENTS = path.join(import.meta.dirname, '../../../../main/agentChat/__fixtures__/isolation-events.json')
const SNAPSHOT = path.join(import.meta.dirname, '__fixtures__/isolation-view.json')

/** 重生成快照。**别顺手用它** —— 见上半场文件头「红了怎么办」第 2 条。 */
const UPDATE = process.env.EAS_BASELINE_UPDATE === '1'

let recorded: Record<string, { kinds: string; events: ChatEvent[] }> = {}
try {
  recorded = JSON.parse(fs.readFileSync(EVENTS, 'utf8')) as typeof recorded
} catch {
  recorded = {}
}

// ── 手写组 ────────────────────────────────────────────────────────────────

const ready: ChatEvent = { k: 'session.ready', sessionId: 's-1', model: 'test-model', cwd: '/w' }
const done = (i = 10, o = 20): ChatEvent => ({ k: 'turn.done', usage: { inputTokens: i, outputTokens: o } })

/** 一样一条，把 14 个变体全走一遍。顺序照真实一轮的样子排：
 *  开场 → 用户说话 → 思考 → 流式吐字 → 工具要审批 → 批准 → 执行 → 收尾 → 额度 → 压缩。 */
const ALL_VARIANTS: ChatEvent[] = [
  ready,
  { k: 'user.message', text: '从手机发进来的一句' },
  { k: 'turn.start' },
  { k: 'thinking', tokens: 42 },
  { k: 'text.delta', text: '半' },
  { k: 'text.delta', text: '半句话' },
  { k: 'approval.request', approvalId: 'a-1', kind: 'exec', title: '运行 echo hi', detail: '{"command":"echo hi"}', cwd: '/w' },
  { k: 'approval.resolved', approvalId: 'a-1', decision: 'allow' },
  { k: 'exec.start', execId: 'e-1', label: 'Bash', detail: 'echo hi' },
  { k: 'exec.done', execId: 'e-1', ok: true, output: 'hi' },
  { k: 'text.done', text: '半句话说完了' },
  { k: 'turn.done', usage: { inputTokens: 100, outputTokens: 30, cachedInputTokens: 7, contextRatio: 0.25 }, costUsd: 0.5 },
  { k: 'quota', window: 'five_hour', status: 'allowed', resetsAt: 1786996800 },
  { k: 'quota', window: 'seven_day', status: 'allowed_warning', resetsAt: 1787996800, utilization: 0.79 },
  { k: 'compacted', trigger: 'auto', preTokens: 120_000, postTokens: 8_000 }
]

/** notice 的规矩，全在 reduce.ts 的注释里写死过：
 *  ① 内容相同的合并计数、**位置不动**（不把命中的那条挪到末尾）
 *  ② `kind` 原样透传 —— **那正是 omp 要从 `'auth'` 放宽成 `'auth' | 'setup'` 的字段**
 *  ③ fatal 收掉这一轮（否则界面一直转）
 *
 *  **溢出单独一个用例，不跟这里合并**：MAX_NOTICES 是 8，挤一次就会把前面几条冲掉 ——
 *  第一版把两件事写在一个序列里，带 `kind:'auth'` 的那条正好被挤没了，
 *  于是「归约器丢掉 e.kind」这个变异**没被抓住**（实测过）。 */
const NOTICES: ChatEvent[] = [
  ready,
  { k: 'turn.start' },
  { k: 'error', message: '重复的提醒', fatal: false },
  { k: 'error', message: '另一条', fatal: false },
  { k: 'error', message: '重复的提醒', fatal: false },
  { k: 'error', message: '重复的提醒', fatal: false },
  { k: 'error', message: '没登录', fatal: false, kind: 'auth' },
  { k: 'error', message: '这条是致命的', fatal: true }
]

/** 满 MAX_NOTICES 之后丢最旧的那条。单独一个用例，理由见上。 */
const NOTICE_OVERFLOW: ChatEvent[] = [
  ready,
  ...Array.from({ length: MAX_NOTICES + 3 }, (_, i): ChatEvent => ({ k: 'error', message: `第 ${i} 条`, fatal: false }))
]

/** 审批槽位是**单槽**（reduce.ts 的 `pending: ApprovalPending | null`）。
 *  omp 并发发起两条审批时后一条会顶掉前一条 —— 这条基线把「今天就是这个行为」钉住，
 *  免得 transport 那边按「能并发」写。最后留一条**未决**的，锁住 pending 不为 null 的形状。 */
const APPROVAL: ChatEvent[] = [
  ready,
  { k: 'turn.start' },
  { k: 'approval.request', approvalId: 'a-1', kind: 'patch', title: '修改 a.ts', detail: '{"file_path":"/w/a.ts"}', cwd: '/w' },
  { k: 'approval.request', approvalId: 'a-2', kind: 'tool', title: 'WebFetch', detail: '{}', cwd: '/w' },
  { k: 'approval.resolved', approvalId: 'a-2', decision: 'deny' },
  { k: 'exec.start', execId: 'e-1', label: 'Write', detail: '/w/a.ts' },
  { k: 'exec.done', execId: 'e-1', ok: false, output: '被拒了' },
  done(),
  { k: 'approval.request', approvalId: 'a-3', kind: 'exec', title: '运行 rm', detail: '{"command":"rm -rf x"}', cwd: '/w' }
]

/** 头部裁剪的算术。`trimmedFromHead` 是「用户自己发的消息按绝对下标定位」的修正量
 *  （13-所有权矩阵点名过：漏了它就是「自己发的话成批消失」）。
 *  这里跑满 MAX_LIVE_TURNS 再多几轮，然后压缩一次 —— 压缩会 unshift 一个标记抵掉 1，
 *  正是那条最容易算错的规则。文本刻意极短，免得快照被撑大。 */
const TRIM: ChatEvent[] = [
  ready,
  ...Array.from({ length: MAX_LIVE_TURNS + 4 }, (_, i): ChatEvent[] => [
    { k: 'turn.start' },
    { k: 'text.done', text: `t${i}` },
    done(1, 1)
  ]).flat(),
  { k: 'compacted', trigger: 'manual', preTokens: 0, postTokens: 0 },
  { k: 'turn.start' },
  { k: 'text.done', text: '压缩之后' },
  done(1, 1)
]

const SYNTH: Record<string, ChatEvent[]> = {
  'synth-all-variants': ALL_VARIANTS,
  'synth-notices': NOTICES,
  'synth-notice-overflow': NOTICE_OVERFLOW,
  'synth-approval': APPROVAL,
  'synth-trim': TRIM
}

// ── 跑与断言 ──────────────────────────────────────────────────────────────

/** 归约器吃完整条事件流之后的视图 —— 渲染层侧的契约，也是用户真正看见的东西。 */
function viewOf(events: ChatEvent[]): unknown {
  const r = createChatReducer()
  for (const e of events) r.push(e)
  return JSON.parse(JSON.stringify(r.view()))
}

const CASES: { name: string; events: ChatEvent[] }[] = [
  ...Object.keys(recorded).sort().map((n) => ({ name: `fx-${n}`, events: recorded[n].events })),
  ...Object.keys(SYNTH).sort().map((n) => ({ name: n, events: SYNTH[n] }))
]

if (UPDATE) {
  const next: Record<string, unknown> = {}
  for (const c of CASES) next[c.name] = viewOf(c.events)
  fs.writeFileSync(SNAPSHOT, JSON.stringify(next, null, 1) + '\n')
  console.log(`[isolationBaseline] 已重生成 ${SNAPSHOT}（${CASES.length} 个用例）`)
}

let snap: Record<string, unknown> = {}
try {
  snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as Record<string, unknown>
} catch {
  snap = {}
}

// 上半场的事件文件读不到（被删了 / 改名了 / 没跑过），真录组会一条不剩地消失，
// 而手写组照样全绿 —— 整份基线**静默缩水一半**。这两条断言就是为了不让那种情况过去。
test('两组用例都在，且与快照覆盖同一批', () => {
  const fx = CASES.filter((c) => c.name.startsWith('fx-'))
  assert.ok(fx.length > 0, `读不到上半场的事件基线：${EVENTS}`)
  assert.equal(Object.keys(SYNTH).length, 5, '手写组少了用例')
  assert.deepEqual(Object.keys(snap).sort(), CASES.map((c) => c.name).sort())
})

// 手写组的存在意义就是「盖住真录组盖不到的变体」。这条断言把那个意义本身钉住：
// 以后谁精简手写组，这里当场红。
//
// **写成 `Record<ChatEvent['k'], true>` 而不是字符串数组是有意的**：给 `ChatEvent` 加一个
// 新变体时，这张表少一个键就**编译不过** —— 于是「加了事件却忘了补覆盖」在 typecheck
// 阶段就被拦住，而不是等到某天有人发现基线其实没盖到它。
const ALL_KINDS: Record<ChatEvent['k'], true> = {
  'session.ready': true, 'turn.start': true, 'text.delta': true, 'text.done': true,
  thinking: true, 'exec.start': true, 'exec.done': true, 'approval.request': true,
  'approval.resolved': true, 'turn.done': true, quota: true, compacted: true,
  'user.message': true, error: true
}

test('两组合起来必须盖到 ChatEvent 的每一个变体', () => {
  const seen = new Set<string>(CASES.flatMap((c) => c.events.map((e) => e.k)))
  assert.deepEqual(Object.keys(ALL_KINDS).filter((k) => !seen.has(k)), [], '有变体没被任何用例覆盖')
})

for (const c of CASES) {
  test(`${c.name}：归约出的视图逐字不变`, () => {
    assert.deepEqual(viewOf(c.events), snap[c.name], '视图变了 —— 归约器（reduce.ts）对既有事件的处理被改动了')
  })
}
