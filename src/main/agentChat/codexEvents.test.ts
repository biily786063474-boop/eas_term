import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createCodexTranslator } from './codexEvents.ts'
import type { ChatEvent } from '../../shared/agentChat.ts'

const fixture = (name: string): string[] =>
  fs
    .readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8')
    .split('\n')
    .filter(Boolean)

function runAll(name: string): ChatEvent[] {
  const t = createCodexTranslator()
  return fixture(name).flatMap((l) => t.push(l))
}

test('thread.started 产出 session.ready，sessionId 取 thread_id', () => {
  const evs = runAll('codex-exec-write.jsonl')
  const ready = evs.filter((e) => e.k === 'session.ready')
  assert.equal(ready.length, 1)
  assert.ok(ready[0].k === 'session.ready' && ready[0].sessionId.length > 0)
})

test('agent_message 类型的 item.completed 产出 text.done', () => {
  const evs = runAll('codex-exec-write.jsonl')
  const texts = evs.filter((e) => e.k === 'text.done')
  assert.ok(texts.length >= 1, '夹具里有 agent_message，必须翻出文字')
  assert.ok(texts[0].k === 'text.done' && texts[0].text.length > 0)
})

test('turn.completed 产出 turn.done，usage 字段名被正确映射', () => {
  const evs = runAll('codex-exec-write.jsonl')
  const done = evs.filter((e) => e.k === 'turn.done')
  assert.equal(done.length, 1)
  // Codex 用 input_tokens / output_tokens / cached_input_tokens
  assert.ok(done[0].k === 'turn.done' && done[0].usage.inputTokens > 0)
  assert.ok(done[0].k === 'turn.done' && done[0].usage.outputTokens > 0)
  assert.ok(done[0].k === 'turn.done' && (done[0].usage.cachedInputTokens ?? 0) > 0)
})

test('Codex 没有花费字段，costUsd 必须是 undefined 而不是 0', () => {
  // 0 会在 UI 上显示成「花了 $0」，那是错的信息；undefined 才表示「这个 CLI 不报花费」
  const evs = runAll('codex-exec-write.jsonl')
  const done = evs.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done' && done.costUsd === undefined)
})

test('contextRatio 一律不填——算法还没定，不许猜', () => {
  const evs = runAll('codex-exec-write.jsonl')
  const done = evs.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done' && done.usage.contextRatio === undefined)
})

test('产出的事件里不含任何 Codex 特有字段名', () => {
  // 中间模型的意义就在这里：加第三个 CLI 时 UI 不用改
  const evs = runAll('codex-exec-write.jsonl')
  const s = JSON.stringify(evs)
  assert.ok(!s.includes('thread_id'), '中间事件里不该出现 thread_id')
  assert.ok(!s.includes('reasoning_output_tokens'), '中间事件里不该出现 Codex 特有的 usage 字段名')
})

test('坏行不抛异常，产出空数组', () => {
  const t = createCodexTranslator()
  assert.deepEqual(t.push('不是 JSON'), [])
  assert.deepEqual(t.push('{"type":"没见过"}'), [])
})

// ---- codex-exec-fail.jsonl：真实抓的失败命令回放，command_execution 用 status 判定，不用 error 字段 ----

test('命令失败时 exec.done.ok 必须是 false——判据是 status 不是 error 字段', () => {
  // 实测：codex 的失败 item 长这样，**没有 error 字段**：
  // {type:'command_execution', aggregated_output:'...', exit_code:1, status:'failed'}
  // 按 error 判会把失败当成功，那正是「执行结果只信事件」要防的
  const evs = runAll('codex-exec-fail.jsonl')
  const done = evs.filter((e) => e.k === 'exec.done')
  assert.ok(done.length >= 1, '失败的命令必须产出 exec.done')
  assert.ok(done.some((e) => e.k === 'exec.done' && e.ok === false), '失败必须判成 ok:false')
})

test('exec.done.output 精确等于 aggregated_output + exit_code，不是退回整条 item 的 JSON dump（2026-08-14 全分支评审：原断言只用 .includes 间接命中，把 outputTextOf 换成无条件 JSON dump 时这条测试照样绿）', () => {
  const evs = runAll('codex-exec-fail.jsonl')
  const done = evs.find((e) => e.k === 'exec.done' && e.ok === false)
  assert.ok(done && done.k === 'exec.done')
  assert.equal(
    (done as { output: string }).output,
    'ls: /这个目录一定不存在xyz123: No such file or directory\n\n(exit code 1)'
  )
  // 双保险：确认不是退回到整条 item 的 JSON dump——那样的话 output 里会带上 "status" 这个键名
  assert.ok(!(done as { output: string }).output.includes('"status"'))
})

test('item.started 只产出 exec.start，不产出 exec.done', () => {
  // in_progress 的那条不能被当成"完成了"
  const evs = runAll('codex-exec-fail.jsonl')
  const starts = evs.filter((e) => e.k === 'exec.start')
  assert.ok(starts.length >= 1)
  assert.ok(starts[0].k === 'exec.start' && starts[0].label.includes('ls'), 'label 该是那条命令')
})
