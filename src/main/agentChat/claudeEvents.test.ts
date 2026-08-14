import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createClaudeTranslator } from './claudeEvents.ts'
import type { ChatEvent } from '../../shared/agentChat.ts'

const fixture = (name: string): string[] =>
  fs
    .readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8')
    .split('\n')
    .filter(Boolean)

/** 把整份夹具喂进翻译器，收集全部中间事件 */
function runAll(name: string, opts?: { thinkingThrottleMs?: number }): ChatEvent[] {
  const t = createClaudeTranslator(opts)
  return fixture(name).flatMap((l) => t.push(l))
}

test('init 事件产出 session.ready，带 sessionId / model / cwd', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  const ready = evs.filter((e) => e.k === 'session.ready')
  assert.equal(ready.length, 1)
  assert.ok(ready[0].k === 'session.ready' && ready[0].sessionId.length > 0)
  assert.ok(ready[0].k === 'session.ready' && ready[0].model.includes('haiku'))
})

test('SessionStart 的 hook 噪音全部被丢掉——12 对 hook 事件里只有 1 对是 PreToolUse', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  // 审批相关事件最多来自那唯一一对 PreToolUse，绝不能有 11 对噪音漏进来
  const approvalish = evs.filter((e) => e.k === 'approval.request' || e.k === 'approval.resolved')
  assert.ok(approvalish.length <= 2, `审批事件应 ≤2，实际 ${approvalish.length}——噪音漏进来了`)
})

test('PreToolUse 的 hook_response 产出 approval.resolved(allow)', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  const resolved = evs.filter((e) => e.k === 'approval.resolved')
  assert.equal(resolved.length, 1)
  assert.ok(resolved[0].k === 'approval.resolved' && resolved[0].decision === 'allow')
})

test('thinking_tokens 被节流——28 条原始事件不该产出 28 个 thinking', () => {
  const evs = runAll('claude-hook-approved.jsonl', { thinkingThrottleMs: 200 })
  const thinking = evs.filter((e) => e.k === 'thinking')
  assert.ok(thinking.length < 28, `应被节流，实际产出 ${thinking.length} 个`)
  assert.ok(thinking.length > 0, '不能一个都不产出')
})

test('tool_use 产出 exec.start，label 是一句人话', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  const starts = evs.filter((e) => e.k === 'exec.start')
  assert.ok(starts.length >= 1)
  assert.ok(starts[0].k === 'exec.start' && starts[0].label.length > 0)
  assert.ok(starts[0].k === 'exec.start' && !starts[0].label.includes('{'), 'label 不该是裸 JSON')
})

test('tool_result 产出 exec.done，与 exec.start 用同一个 execId 配对', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  const start = evs.find((e) => e.k === 'exec.start')
  const done = evs.find((e) => e.k === 'exec.done')
  assert.ok(start && done)
  assert.equal(
    start.k === 'exec.start' ? start.execId : 'a',
    done.k === 'exec.done' ? done.execId : 'b'
  )
  assert.ok(done.k === 'exec.done' && done.ok === true)
})

test('permission_denied 产出 exec.done{ok:false}——被拒必须留下失败痕迹', () => {
  // 这条是硬要求：实测模型在 Write 被拒后仍会说「已创建完成」，
  // 如果内核不产出失败事件，UI 上看到的就只有那句谎话。
  const evs = runAll('claude-permission-denied.jsonl')
  const failed = evs.filter((e) => e.k === 'exec.done' && e.ok === false)
  assert.equal(failed.length, 1, '被拒的那次工具调用必须产出一个失败的 exec.done')
})

test('result 事件产出 turn.done，带 usage 与花费', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  const done = evs.filter((e) => e.k === 'turn.done')
  assert.equal(done.length, 1)
  assert.ok(done[0].k === 'turn.done' && done[0].usage.outputTokens > 0)
  assert.ok(done[0].k === 'turn.done' && typeof done[0].costUsd === 'number')
})

test('contextRatio 一律不填——算法还没定，不许猜', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  const done = evs.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done' && done.usage.contextRatio === undefined)
})

test('坏行不抛异常，产出空数组', () => {
  const t = createClaudeTranslator()
  assert.deepEqual(t.push('这不是 JSON'), [])
  assert.deepEqual(t.push(''), [])
  assert.deepEqual(t.push('{"type":"没见过的类型"}'), [])
})
