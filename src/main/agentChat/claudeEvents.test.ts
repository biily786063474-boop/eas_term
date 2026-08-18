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

// 这条原来是「contextRatio 一律不填——算法还没定，不许猜」（spec §九 第 4 条：
// 「result 事件里有 usage，但没有上下文窗口上限」）。**那个前提 2026-08-17 被实测推翻**：
// 分母就在同一个 result 事件里 —— modelUsage[<model>].contextWindow（夹具里是 200000）。
// 于是改成填。**但原约束的核心一条不动**：拿不到分母时绝不用猜的窗口顶上，见下一条。
test('contextRatio 按 modelUsage.contextWindow 算出来（夹具窗口 200000）', () => {
  const evs = runAll('claude-hook-approved.jsonl')
  const done = evs.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done')
  const r = done.usage.contextRatio
  assert.equal(typeof r, 'number')
  assert.ok(r! > 0 && r! <= 1, `比例要落在 (0,1]，拿到 ${r}`)
  // 别只验「是个数」：分子必须是 input + cache_read + cache_creation 三项之和，
  // 只取 input_tokens 的话会算出一个接近 0 的假占用（缓存命中时 input 往往只有个位数）
  const line = fixture('claude-hook-approved.jsonl')
    .map((l) => JSON.parse(l) as Record<string, any>)
    .find((j) => j.type === 'result')!
  const u = line.usage as Record<string, number | undefined>
  const win = (Object.values(line.modelUsage as Record<string, { contextWindow: number }>)[0]).contextWindow
  const expect =
    ((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)) / win
  assert.ok(Math.abs(r! - expect) < 1e-9, `期望 ${expect}，拿到 ${r}`)
})

test('**拿不到分母就不填** —— 绝不用一个猜的窗口大小顶上（原约束的核心）', () => {
  const t = createClaudeTranslator()
  // 有 usage、没有 modelUsage：这是原来那条约束设想的情况
  const out = t.push(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 10, cache_read_input_tokens: 5000, output_tokens: 3 },
      total_cost_usd: 0.01,
      session_id: 's1'
    }) + '\n'
  )
  const done = out.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done')
  assert.equal(done.usage.contextRatio, undefined, '没有 contextWindow 时宁可不显示，也不许猜一个')
})

test('contextWindow 是 0 / 不是数字时也当作拿不到分母', () => {
  const t = createClaudeTranslator()
  for (const win of [0, -1, 'big', null]) {
    const out = t.push(
      JSON.stringify({
        type: 'result',
        usage: { input_tokens: 10, cache_read_input_tokens: 5000 },
        modelUsage: { m: { contextWindow: win } },
        session_id: 's1'
      }) + '\n'
    )
    const done = out.find((e) => e.k === 'turn.done')
    assert.ok(done && done.k === 'turn.done')
    assert.equal(done.usage.contextRatio, undefined, `contextWindow=${win} 不该算出比例`)
  }
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

// ── 订阅额度（2026-08-17）────────────────────────────────────
// 实测 payload：{ type:'rate_limit_event', rate_limit_info:{ status:'allowed',
//   resetsAt:1786996800, rateLimitType:'five_hour', overageStatus:'rejected', ... } }

test('rate_limit_event 翻成 quota，窗口/状态/重置时刻原样带出', () => {
  const t = createClaudeTranslator()
  const out = t.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', resetsAt: 1786996800, rateLimitType: 'five_hour' },
      session_id: 's1'
    }) + '\n'
  )
  assert.deepEqual(out, [
    { k: 'quota', window: 'five_hour', status: 'allowed', resetsAt: 1786996800, utilization: undefined }
  ])
})

test('**窗口类型不做枚举映射** —— 漏掉一种新窗口会被静默丢掉，而那正是用户最想知道的那次', () => {
  const t = createClaudeTranslator()
  const out = t.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', rateLimitType: 'some_future_window' }
    }) + '\n'
  )
  assert.equal(out.length, 1)
  assert.ok(out[0].k === 'quota' && out[0].window === 'some_future_window')
})

test('rate_limit_info 缺失/畸形不抛，也不产出空事件', () => {
  const t = createClaudeTranslator()
  assert.deepEqual(t.push(JSON.stringify({ type: 'rate_limit_event' }) + '\n'), [])
  assert.deepEqual(t.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: 'x' }) + '\n'), [])
  // 窗口和状态都没有 = 这条事件没有任何可显示的内容
  assert.deepEqual(
    t.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { resetsAt: 1 } }) + '\n'),
    []
  )
})

test('resetsAt 不是数字时不带出来（不许让界面拿一个坏值去算倒计时）', () => {
  const t = createClaudeTranslator()
  const out = t.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'weekly', resetsAt: 'soon' }
    }) + '\n'
  )
  assert.ok(out[0].k === 'quota' && out[0].resetsAt === undefined)
})

test('**七天窗口带 utilization，五小时不带** —— 按需出现，不能假设都在', () => {
  const t = createClaudeTranslator()
  const week = t.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning', resetsAt: 1786852800, rateLimitType: 'seven_day',
        utilization: 0.79, surpassedThreshold: 0.75
      }
    }) + '\n'
  )
  assert.ok(week[0].k === 'quota' && week[0].utilization === 0.79)
  const five = t.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', resetsAt: 1786996800, rateLimitType: 'five_hour' }
    }) + '\n'
  )
  assert.ok(five[0].k === 'quota' && five[0].utilization === undefined, '没带就是没带，不许倒推')
})

test('utilization 是坏值时夹回合法区间或丢弃（别让进度条冲出容器）', () => {
  const t = createClaudeTranslator()
  const mk = (u: unknown): unknown => {
    const o = t.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'w', utilization: u } }) + '\n')[0]
    return o.k === 'quota' ? o.utilization : 'NOT_QUOTA'
  }
  assert.equal(mk(1.7), 1)
  assert.equal(mk(-0.2), 0)
  assert.equal(mk(NaN), undefined)
  assert.equal(mk('0.5'), undefined)
})

