import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createCodexTranslator } from './codexEvents.ts'
import type { ChatEvent } from '../../shared/agentChat.ts'

function runAll(): ChatEvent[] {
  const t = createCodexTranslator()
  return fs
    .readFileSync(path.join(import.meta.dirname, '__fixtures__', 'codex-exec-write.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => t.push(l))
}

test('thread.started 产出 session.ready，sessionId 取 thread_id', () => {
  const evs = runAll()
  const ready = evs.filter((e) => e.k === 'session.ready')
  assert.equal(ready.length, 1)
  assert.ok(ready[0].k === 'session.ready' && ready[0].sessionId.length > 0)
})

test('agent_message 类型的 item.completed 产出 text.done', () => {
  const evs = runAll()
  const texts = evs.filter((e) => e.k === 'text.done')
  assert.ok(texts.length >= 1, '夹具里有 agent_message，必须翻出文字')
  assert.ok(texts[0].k === 'text.done' && texts[0].text.length > 0)
})

test('turn.completed 产出 turn.done，usage 字段名被正确映射', () => {
  const evs = runAll()
  const done = evs.filter((e) => e.k === 'turn.done')
  assert.equal(done.length, 1)
  // Codex 用 input_tokens / output_tokens / cached_input_tokens
  assert.ok(done[0].k === 'turn.done' && done[0].usage.inputTokens > 0)
  assert.ok(done[0].k === 'turn.done' && done[0].usage.outputTokens > 0)
  assert.ok(done[0].k === 'turn.done' && (done[0].usage.cachedInputTokens ?? 0) > 0)
})

test('Codex 没有花费字段，costUsd 必须是 undefined 而不是 0', () => {
  // 0 会在 UI 上显示成「花了 $0」，那是错的信息；undefined 才表示「这个 CLI 不报花费」
  const evs = runAll()
  const done = evs.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done' && done.costUsd === undefined)
})

test('contextRatio 一律不填——算法还没定，不许猜', () => {
  const evs = runAll()
  const done = evs.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done' && done.usage.contextRatio === undefined)
})

test('产出的事件里不含任何 Codex 特有字段名', () => {
  // 中间模型的意义就在这里：加第三个 CLI 时 UI 不用改
  const evs = runAll()
  const s = JSON.stringify(evs)
  assert.ok(!s.includes('thread_id'), '中间事件里不该出现 thread_id')
  assert.ok(!s.includes('reasoning_output_tokens'), '中间事件里不该出现 Codex 特有的 usage 字段名')
})

test('坏行不抛异常，产出空数组', () => {
  const t = createCodexTranslator()
  assert.deepEqual(t.push('不是 JSON'), [])
  assert.deepEqual(t.push('{"type":"没见过"}'), [])
})
