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
  const t = createOmpTranslator(ALLOW)
  for (const k of ['available_commands_update', 'session_info_update', 'usage_update']) {
    const r = t.push(
      JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: k } } })
    )
    assert.deepEqual(r.events, [], `${k} 不该产出事件`)
  }
})

// ── turn.done ────────────────────────────────────────────────────────────

test('prompt 的响应翻成 turn.done，缓存命中要落到 cachedInputTokens', () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '__fixtures__', 'omp-acp-handshake.json'), 'utf8')
  ) as { promptResult: Record<string, unknown> }
  const e = turnDoneOf(raw.promptResult)
  assert.ok(e.k === 'turn.done')
  assert.ok(e.usage.inputTokens >= 0 && e.usage.outputTokens > 0)
  assert.equal(e.costUsd, undefined, 'omp 不报花费 —— 必须缺省，显示 $0 是错的信息')
})

test('usage 缺字段时补 0，不给 undefined（下游会渲染成字面的 undefined）', () => {
  const e = turnDoneOf({})
  assert.ok(e.k === 'turn.done')
  assert.equal(e.usage.inputTokens, 0)
  assert.equal(e.usage.outputTokens, 0)
})

test('**contextRatio 一律不填** —— omp 的 usage 里没有窗口上限这个分母', () => {
  const e = turnDoneOf({ usage: { inputTokens: 100, outputTokens: 5 } })
  assert.ok(e.k === 'turn.done')
  assert.equal(e.usage.contextRatio, undefined)
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
