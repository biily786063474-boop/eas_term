import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createOmpTranslator, turnDoneOf, type ApprovalDecider } from './ompEvents.ts'
import type { ChatEvent } from '../../shared/agentChat.ts'

// fixture 是**真跑出来的**：omp 18.0.11 走 ACP，模型智谱 glm-5.3-flash，
// 一条 `echo hi-from-omp` 从审批到执行完整走完。思考流原本 117 条，抽稀到 3 条。
const fixture = (name: string): string[] =>
  fs
    .readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8')
    .split('\n')
    .filter(Boolean)

const ALLOW: ApprovalDecider = () => 'allow'
const DENY: ApprovalDecider = () => 'deny'

function runAll(name: string, decide: ApprovalDecider = ALLOW): {
  events: ChatEvent[]
  replies: { id: number | string; result: unknown }[]
} {
  const t = createOmpTranslator(decide)
  const events: ChatEvent[] = []
  const replies: { id: number | string; result: unknown }[] = []
  for (const l of fixture(name)) {
    const r = t.push(l)
    events.push(...r.events)
    if (r.reply) replies.push(r.reply)
  }
  return { events, replies }
}

const kinds = (evs: ChatEvent[]): string[] => evs.map((e) => e.k)

// ── 契约：绝不抛 ───────────────────────────────────────────────────────────

test('喂什么垃圾都不抛，只返回空', () => {
  const t = createOmpTranslator(ALLOW)
  for (const bad of ['', '   ', 'not json', '{', '[]', 'null', '{"a":1}', '{"method":"nope"}']) {
    const r = t.push(bad)
    assert.deepEqual(r.events, [], `"${bad}" 不该产出事件`)
    assert.equal(r.reply, null)
  }
})

// ── 双向：审批那两条通道 ──────────────────────────────────────────────────

test('**session/request_permission 必须回话**，不回整轮会挂死', () => {
  const { replies } = runAll('omp-acp-bash.jsonl')
  assert.ok(replies.length >= 2, `至少要回两条（两个通道），实际 ${replies.length}`)
})

test('允许时回 allow_once —— **不用 allow_always**，那等于替用户改了他的配置', () => {
  const { replies } = runAll('omp-acp-bash.jsonl', ALLOW)
  const perm = replies.map((r) => r.result as Record<string, Record<string, string>>)
    .find((r) => r.outcome)
  assert.equal(perm?.outcome.outcome, 'selected')
  assert.equal(perm?.outcome.optionId, 'allow_once')
})

test('拒绝时回 reject_once', () => {
  const { replies } = runAll('omp-acp-bash.jsonl', DENY)
  const perm = replies.map((r) => r.result as Record<string, Record<string, string>>)
    .find((r) => r.outcome)
  assert.equal(perm?.outcome.optionId, 'reject_once')
})

test('**elicitation/create 是第二条通道**，形状完全不同，也必须答', () => {
  const { replies } = runAll('omp-acp-bash.jsonl', ALLOW)
  const eli = replies.map((r) => r.result as Record<string, unknown>).find((r) => r.action)
  assert.equal(eli?.action, 'accept')
  assert.deepEqual(eli?.content, { value: 'Approve' })
})

test('**第二条通道不重复产出 approval.request** —— 否则一次 bash 弹两张卡', () => {
  const { events } = runAll('omp-acp-bash.jsonl')
  assert.equal(kinds(events).filter((k) => k === 'approval.request').length, 1)
})

// ── 事件翻译 ──────────────────────────────────────────────────────────────

test('审批请求带得出 kind / title / detail', () => {
  const { events } = runAll('omp-acp-bash.jsonl')
  const req = events.find((e) => e.k === 'approval.request')
  assert.ok(req && req.k === 'approval.request')
  assert.equal(req.kind, 'exec', 'ACP 的 execute 要落到我们的 exec')
  assert.ok(req.title.length > 0, 'title 不能是空的')
  assert.ok(req.detail.includes('echo'), `detail 该带上命令本身，实际 "${req.detail}"`)
})

test('approval.request 后面紧跟 approval.resolved，id 对得上', () => {
  const { events } = runAll('omp-acp-bash.jsonl')
  const i = events.findIndex((e) => e.k === 'approval.request')
  const req = events[i]
  const res = events[i + 1]
  assert.ok(req.k === 'approval.request' && res?.k === 'approval.resolved')
  assert.equal(res.approvalId, req.approvalId)
})

test('**ACP 没有 turn_start，要自己合成**，否则界面上「正在处理」永远不出现', () => {
  const { events } = runAll('omp-acp-bash.jsonl')
  assert.equal(events[0].k, 'turn.start')
  assert.equal(kinds(events).filter((k) => k === 'turn.start').length, 1, 'turn.start 只许有一个')
})

test('文字增量翻成 text.delta，思考流翻成 thinking', () => {
  const { events } = runAll('omp-acp-bash.jsonl')
  assert.ok(kinds(events).includes('text.delta'))
  assert.ok(kinds(events).includes('thinking'))
  const think = events.find((e) => e.k === 'thinking')
  assert.ok(think && think.k === 'thinking' && think.tokens >= 1, 'token 数至少是 1，不能是 0')
})

test('工具调用：exec.start / exec.done 配得上对', () => {
  const { events } = runAll('omp-acp-bash.jsonl')
  const start = events.find((e) => e.k === 'exec.start')
  const done = events.find((e) => e.k === 'exec.done')
  assert.ok(start && start.k === 'exec.start' && done && done.k === 'exec.done')
  assert.equal(done.execId, start.execId, 'execId 必须配对，否则界面上那张卡片永远转不完')
  assert.equal(done.ok, true)
})

test('**in_progress 不算完成** —— 实测一次 bash 来了两条，每条都当完成会让卡片来回跳', () => {
  const t = createOmpTranslator(ALLOW)
  const line = (status: string): string =>
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'x', status } }
    })
  assert.deepEqual(t.push(line('in_progress')).events, [])
  assert.deepEqual(t.push(line('pending')).events, [])
  assert.equal(t.push(line('completed')).events[0]?.k, 'exec.done')
})

test('failed 状态要翻成 ok:false，不能一律当成功', () => {
  const t = createOmpTranslator(ALLOW)
  const e = t.push(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'x', status: 'failed' } }
    })
  ).events[0]
  assert.ok(e && e.k === 'exec.done' && e.ok === false)
})

test('元信息事件一律丢弃，不产出任何东西', () => {
  // **usage_update 不在这个名单里**，它有自己的一组测试 ——
  // 它曾经被当成「元信息」丢掉过，而它装着花费和上下文分母。别再把它加回来。
  const t = createOmpTranslator(ALLOW)
  for (const k of ['available_commands_update', 'session_info_update']) {
    const r = t.push(
      JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: k } } })
    )
    assert.deepEqual(r.events, [], `${k} 不该产出事件`)
  }
})

// ── usage_update：花费与上下文的唯一来源 ─────────────────────────────────
//
// 这个事件一度被整个丢掉过（理由写成了「那是上下文占用不是计费」——说反了，两样都在里面）。
// 下面几条就是为了不让它再被丢一次。

const usageLine = (o: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'usage_update', ...o } } })

test('**usage_update 装着三样：分母 size、分子 used、累计 cost**', () => {
  const t = createOmpTranslator(ALLOW)
  t.push(usageLine({ size: 128000, used: 12289, cost: { amount: 0.0123, currency: 'USD' } }))
  assert.deepEqual(t.stats(), { contextWindow: 128000, contextUsed: 12289, costUsd: 0.0123 })
})

test('usage_update 不产出事件 —— 我们没有轮中用量这一档，攒着并进 turn.done', () => {
  const t = createOmpTranslator(ALLOW)
  assert.deepEqual(t.push(usageLine({ size: 1000, used: 10 })).events, [])
})

test('**免费模型没有 cost 字段** —— omp 只在 > 0 时报，此时必须是「没有」不是 0', () => {
  const t = createOmpTranslator(ALLOW)
  t.push(usageLine({ size: 128000, used: 100 }))
  assert.equal(t.stats().costUsd, undefined, 'costUsd 缺省不能被补成 0')
  assert.equal(turnDoneOf({}, t.stats()).costUsd, undefined)
})

test('stats() 返回的是副本，外部改不动内部状态', () => {
  const t = createOmpTranslator(ALLOW)
  t.push(usageLine({ size: 1000, used: 10 }))
  const a = t.stats()
  a.contextWindow = 999
  assert.equal(t.stats().contextWindow, 1000)
})

// ── turn.done ────────────────────────────────────────────────────────────

test('prompt 的响应翻成 turn.done，缓存命中要落到 cachedInputTokens', () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '__fixtures__', 'omp-acp-handshake.json'), 'utf8')
  ) as { promptResult: Record<string, unknown> }
  const e = turnDoneOf(raw.promptResult)
  assert.ok(e.usage.inputTokens >= 0 && e.usage.outputTokens > 0)
  assert.ok((e.usage.cachedInputTokens ?? 0) > 0, 'fixture 里缓存命中过一万多 token')
})

test('usage 缺字段时补 0，不给 undefined（下游会渲染成字面的 undefined）', () => {
  const e = turnDoneOf({})
  assert.equal(e.usage.inputTokens, 0)
  assert.equal(e.usage.outputTokens, 0)
})

test('**拿到分母才填 contextRatio** —— 拿不到就不填，绝不猜一个', () => {
  assert.equal(turnDoneOf({}).usage.contextRatio, undefined, '没有 stats 就没有比例')
  assert.equal(turnDoneOf({}, { contextUsed: 100 }).usage.contextRatio, undefined, '只有分子也不填')
  assert.equal(turnDoneOf({}, { contextWindow: 0, contextUsed: 100 }).usage.contextRatio, undefined, '分母是 0 不填')
  const r = turnDoneOf({}, { contextWindow: 1000, contextUsed: 250 }).usage.contextRatio
  assert.equal(r, 0.25)
})

test('比例封顶在 1 —— 压缩前的瞬间可能超窗，显示 120% 是在吓人', () => {
  assert.equal(turnDoneOf({}, { contextWindow: 100, contextUsed: 150 }).usage.contextRatio, 1)
})

test('**costUsd 是会话累计不是单轮** —— 与 Claude 的 total_cost_usd 同语义，不会倒退', () => {
  const t = createOmpTranslator(ALLOW)
  t.push(usageLine({ size: 1000, used: 10, cost: { amount: 0.01, currency: 'USD' } }))
  assert.equal(turnDoneOf({}, t.stats()).costUsd, 0.01)
  t.push(usageLine({ size: 1000, used: 20, cost: { amount: 0.03, currency: 'USD' } }))
  assert.equal(turnDoneOf({}, t.stats()).costUsd, 0.03, '累计值应该只增不减')
})

// ── 整体形状 ─────────────────────────────────────────────────────────────

test('整份 fixture 走完，事件顺序合乎一次真实的轮次', () => {
  const { events } = runAll('omp-acp-bash.jsonl')
  const seq = kinds(events)
  assert.equal(seq[0], 'turn.start')
  const iReq = seq.indexOf('approval.request')
  const iStart = seq.indexOf('exec.start')
  const iDone = seq.indexOf('exec.done')
  assert.ok(iReq >= 0 && iStart > iReq, '审批必须在执行之前')
  assert.ok(iDone > iStart, '完成必须在开始之后')
})
