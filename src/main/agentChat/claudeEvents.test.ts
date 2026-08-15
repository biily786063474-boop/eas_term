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
  // 12 对 hook 事件（1 对 PreToolUse + 11 对 SessionStart 噪音）全都不该变成中间事件。
  // 这条测试与下一条合起来锁死：hook 事件这一路整体不产出 approval。
  const approvalish = evs.filter((e) => e.k === 'approval.request' || e.k === 'approval.resolved')
  assert.equal(approvalish.length, 0, `hook 事件不该产出 approval，实际 ${approvalish.length} 个`)
})

test('流里的 hook 事件一律不产出 approval 事件——审批由 hook 路单独驱动', () => {
  // 2026-08-14 实测：流里的 hook_started/hook_response **只有 hook_id**，
  // 而 hook 脚本那一路的 payload 里是 tool_use_id，两者对不上，缝不了。
  // 所以审批完全由 hook 路驱动（见 Task 3），这里一个 approval 事件都不该产出。
  const evs = runAll('claude-hook-approved.jsonl')
  const approvalish = evs.filter((e) => e.k === 'approval.request' || e.k === 'approval.resolved')
  assert.equal(approvalish.length, 0, '翻译器不该产出任何 approval 事件')
})

test('合成一条「非 PreToolUse 但 output 里有 permissionDecision」的噪音——照样不产出 approval', () => {
  // 夹具里恰好没有这种行，而它正是最容易漏的那一类：
  // 别的 hook（PostToolUse/Stop/UserPromptSubmit）的返回里如果碰巧带了这个字段，
  // 只靠「解析得出 permissionDecision」当判据的实现就会误放行。
  const t = createClaudeTranslator()
  const evs = t.push(JSON.stringify({
    type: 'system',
    subtype: 'hook_response',
    hook_event: 'PostToolUse',
    hook_name: 'PostToolUse:Write',
    hook_id: 'h1',
    output: JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', permissionDecision: 'allow' }
    })
  }))
  assert.equal(evs.filter((e) => e.k === 'approval.resolved').length, 0)
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

test('[2026-08-14 全分支评审] 空字符串的 text block 不产出 text.done——空气泡是噪音，与 codexEvents.ts 的处理对齐（修复前 Claude 只要求是字符串，空串也会产出）', () => {
  const t = createClaudeTranslator()
  const evs = t.push(
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } })
  )
  assert.deepEqual(evs, [])
})

test('[2026-08-14 全分支评审] 非空字符串的 text block 仍然正常产出 text.done——上一条修复没有连带把正常路径也堵死', () => {
  const t = createClaudeTranslator()
  const evs = t.push(
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '你好' }] } })
  )
  assert.equal(evs.length, 1)
  assert.ok(evs[0].k === 'text.done' && evs[0].text === '你好')
})
