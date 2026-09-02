import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createOmpTranslator,
  fromConfigOptions,
  turnDoneOf,
  type AcpReply,
  type ApprovalAsk,
  type ApprovalDecider
} from './ompEvents.ts'
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

// **回话现在是等来的**：审批要问用户，push() 只能先把「要回什么」的 Promise 交出来。
// 所以 replies 收的是 Promise，读 result 的测试要自己 await。
// 延后产出的事件（approval.resolved）同理，从 onEvent 出口来，不在 push() 的返回值里。
function runAll(name: string, decide: ApprovalDecider = ALLOW): {
  events: ChatEvent[]
  replies: (AcpReply | Promise<AcpReply>)[]
} {
  const t = createOmpTranslator(decide)
  const events: ChatEvent[] = []
  const replies: (AcpReply | Promise<AcpReply>)[] = []
  t.onEvent((e) => events.push(e))
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

test('允许时回 allow_once —— **不用 allow_always**，那等于替用户改了他的配置', async () => {
  const { replies } = runAll('omp-acp-bash.jsonl', ALLOW)
  const perm = (await Promise.all(replies)).map((r) => r.result as Record<string, Record<string, string>>)
    .find((r) => r.outcome)
  assert.equal(perm?.outcome.outcome, 'selected')
  assert.equal(perm?.outcome.optionId, 'allow_once')
})

test('拒绝时回 reject_once', async () => {
  const { replies } = runAll('omp-acp-bash.jsonl', DENY)
  const perm = (await Promise.all(replies)).map((r) => r.result as Record<string, Record<string, string>>)
    .find((r) => r.outcome)
  assert.equal(perm?.outcome.optionId, 'reject_once')
})

test('**elicitation/create 是第二条通道**，形状完全不同，也必须答', async () => {
  const { replies } = runAll('omp-acp-bash.jsonl', ALLOW)
  const eli = (await Promise.all(replies)).map((r) => r.result as Record<string, unknown>).find((r) => r.action)
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

test('**approval.resolved 不在 push() 的返回值里**，它从 onEvent 出口延后到，id 对得上', async () => {
  // 卡片必须**立刻**出现（push 的返回值里），决定却要等用户 —— 两件事之间隔着几分钟。
  // 早先那版把两条一起同步产出，等于翻译器替用户点了同意。
  const { events, replies } = runAll('omp-acp-bash.jsonl')
  const req = events.find((e) => e.k === 'approval.request')
  assert.ok(req && req.k === 'approval.request')
  assert.equal(
    events.filter((e) => e.k === 'approval.resolved').length,
    0,
    'push() 同步返回时决定还没作出，不该有 resolved'
  )
  await Promise.all(replies)
  const res = events.find((e) => e.k === 'approval.resolved')
  assert.ok(res && res.k === 'approval.resolved')
  assert.equal(res.approvalId, req.approvalId)
})

test('**turn.start 不由翻译器产**——会话层推，翻译器再合成一个就是两条', () => {
  // 原来这里钉的是「要自己合成」，**那条推翻了**：deliverMessage 在投递消息时就已经推
  // turn.start（三条消息入口的汇合点），翻译器再合成一次界面上就是两轮。
  // 而且它那个 turnOpen 标志一旦置起就不复位，第二条消息起也永远不会再产 ——
  // 「只在第一轮多一条」这种错最难被看见。
  const { events } = runAll('omp-acp-bash.jsonl')
  assert.equal(kinds(events).filter((k) => k === 'turn.start').length, 0)
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
  const iReq = seq.indexOf('approval.request')
  const iStart = seq.indexOf('exec.start')
  const iDone = seq.indexOf('exec.done')
  assert.ok(iReq >= 0 && iStart > iReq, '审批必须在执行之前')
  assert.ok(iDone > iStart, '完成必须在开始之后')
})

// ══ 以下是 omp 真接进运行路径之后新增的契约（spec §六 E.1 / E.2） ══════════
//
// 上面那批钉的是「一行 ACP 报文翻成什么」，跑 fixture 就够。下面这批钉的是
// **等用户**这件事带来的全部后果：卡片先出、决定后到、等不到怎么办、被打断怎么办。

const permLine = (
  id: number,
  tc: { toolCallId?: string; kind?: string; title?: string; command?: string }
): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'session/request_permission',
    params: {
      sessionId: 's',
      toolCall: {
        ...(tc.toolCallId ? { toolCallId: tc.toolCallId } : {}),
        ...(tc.kind ? { kind: tc.kind } : {}),
        title: tc.title ?? '',
        ...(tc.command ? { rawInput: { command: tc.command } } : {}),
        status: 'pending'
      },
      options: []
    }
  })

const elicitLine = (id: number, message: string): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'elicitation/create',
    params: { mode: 'form', sessionId: 's', message, requestedSchema: {} }
  })

const chunkLine = (text: string, messageId: string, kind = 'agent_message_chunk'): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { update: { sessionUpdate: kind, content: { type: 'text', text }, messageId } }
  })

/** 一个「问了但先不答」的决定器，模拟真正的用户：卡片摆出来，人还没点。 */
function deferred(): {
  decide: ApprovalDecider
  asked: ApprovalAsk[]
  answer: (i: number, d: 'allow' | 'deny') => void
} {
  const asked: ApprovalAsk[] = []
  const answers: ((d: 'allow' | 'deny') => void)[] = []
  return {
    asked,
    decide: (req) => {
      asked.push(req)
      return new Promise((r) => answers.push(r))
    },
    answer: (i, d) => answers[i](d)
  }
}

test('**卡片立刻出，回话等用户** —— 人没点之前一个字都不许写回 stdin', async () => {
  // 早先那版同步 decide，等于翻译器替用户点了同意；真接进 UI 后这条是唯一的安全线。
  const d = deferred()
  const t = createOmpTranslator(d.decide, '/w')
  const r = t.push(permLine(0, { toolCallId: 'c1', kind: 'execute', title: 'ls', command: 'ls' }))
  assert.equal(r.events[0]?.k, 'approval.request')
  let written = false
  void Promise.resolve(r.reply).then(() => {
    written = true
  })
  await Promise.resolve()
  assert.equal(written, false, '决定还没作出就写回话 = 替用户点了')
  d.answer(0, 'allow')
  const reply = (await r.reply) as AcpReply
  assert.deepEqual(reply.result, { outcome: { outcome: 'selected', optionId: 'allow_once' } })
})

test('approval.request.cwd 填的是会话目录 —— 卡片上「在哪跑」那一行不能是空的', () => {
  const t = createOmpTranslator(ALLOW, '/repo/x')
  const e = t.push(permLine(0, { toolCallId: 'c1', kind: 'execute', title: 'ls', command: 'ls' })).events[0]
  assert.ok(e && e.k === 'approval.request')
  assert.equal(e.cwd, '/repo/x')
})

test('approvalId 三种形态都带会话前缀 —— 两个会话的卡片不能撞在一起', async () => {
  const t = createOmpTranslator(ALLOW, '', { idPrefix: 'live7:' })
  const ids = (line: string): string => {
    const e = t.push(line).events.find((x) => x.k === 'approval.request')
    assert.ok(e && e.k === 'approval.request')
    return e.approvalId
  }
  assert.equal(ids(permLine(0, { toolCallId: 'c1', kind: 'execute', command: 'ls' })), 'live7:c1')
  // toolCallId 缺席（协议允许）时退回 rpc id，卡片总得有个身份键
  assert.equal(ids(permLine(1, { kind: 'execute', command: 'ls' })), 'live7:rpc-1')
  // 单独弹卡的 elicitation 是第三种：它压根没有 toolCallId
  assert.equal(ids(elicitLine(2, 'Allow tool: write\nPath: a.txt')), 'live7:elic-2')
})

test('**两条通道配上对就只弹一张卡**，靠的是「上一个决定 + 命令原文」，不是 id', async () => {
  // elicitation/create 的 params 里没有 toolCallId（fixture 第 10 行），
  // 外层那条的 toolName 又在 acp-client-bridge.ts:120-128 被丢掉了 —— 没有共同的键可用。
  const t = createOmpTranslator(ALLOW)
  const a = t.push(permLine(0, { toolCallId: 'c1', kind: 'execute', title: 'echo hi', command: 'echo hi' }))
  await a.reply
  const b = t.push(elicitLine(1, 'Allow tool: bash\nCommand: echo hi'))
  assert.deepEqual(b.events, [], '第二条通道不该再弹一张卡')
  assert.deepEqual((await b.reply)?.result, { action: 'accept', content: { value: 'Approve' } })
})

test('命令对不上就**单独弹卡**，绝不拿上一个决定去放行另一件事', async () => {
  const t = createOmpTranslator(ALLOW)
  await t.push(permLine(0, { toolCallId: 'c1', kind: 'execute', command: 'echo hi' })).reply
  const b = t.push(elicitLine(1, 'Allow tool: bash\nCommand: rm -rf /'))
  const req = b.events.find((e) => e.k === 'approval.request')
  assert.ok(req && req.k === 'approval.request', '命令不同 = 另一件事，必须单独问')
})

test('`write` 这类工具**只来 elicitation 一条**，那是常态不是乱序 —— 照样弹卡', async () => {
  // PERMISSION_REQUIRED_TOOLS 只有 bash/edit/delete/move（acp-permission-gate.ts:8-13），
  // write 不在里面，外层那条永远不来。把它当「配不上」丢掉的话，写文件就成了静默放行。
  const t = createOmpTranslator(ALLOW)
  const r = t.push(elicitLine(1, 'Allow tool: write\nPath: a.txt\nContent:\nhi'))
  const req = r.events.find((e) => e.k === 'approval.request')
  assert.ok(req && req.k === 'approval.request')
  assert.equal(req.kind, 'tool')
  assert.equal(req.title, 'Allow tool: write', 'title 取首行，detail 是整段')
  assert.ok(req.detail.includes('Content:'))
})

test('隔了 30 秒以上不再复用旧决定 —— 陈年的「同意」不能放行新来的一件事', async () => {
  let clock = 1_000_000
  const t = createOmpTranslator(ALLOW, '', { now: () => clock })
  await t.push(permLine(0, { toolCallId: 'c1', kind: 'execute', command: 'echo hi' })).reply
  clock += 31_000
  const b = t.push(elicitLine(1, 'Allow tool: bash\nCommand: echo hi'))
  assert.ok(
    b.events.some((e) => e.k === 'approval.request'),
    '过期就当没配上，重新问一遍'
  )
})

test('**拒绝之后第二条通道不来**，卡片照样收口 —— 完成判据是「决定已作出」', async () => {
  // session-tools.ts:837-839 在 reject 分支直接 throw ToolError，内层根本不执行。
  // 拿「两条都回了」当完成判据的话，被拒的那张卡永远挂在界面上。
  const t = createOmpTranslator(DENY)
  const seen: string[] = []
  t.onEvent((e) => seen.push(e.k))
  await t.push(permLine(0, { toolCallId: 'c1', kind: 'execute', command: 'rm -rf /' })).reply
  assert.deepEqual(seen, ['approval.resolved'])
})

test('**abort 要对每个未决审批产 deny** —— 不产的话中断后卡片永远挂着', async () => {
  // reduce.ts:126 的 pending 是单槽位，清它的唯一入口就是 approval.resolved（:323）。
  const d = deferred()
  const t = createOmpTranslator(d.decide)
  const got: { approvalId: string; decision: string }[] = []
  t.onEvent((e) => {
    if (e.k === 'approval.resolved') got.push({ approvalId: e.approvalId, decision: e.decision })
  })
  t.push(permLine(0, { toolCallId: 'c1', kind: 'execute', command: 'ls' }))
  t.push(elicitLine(1, 'Allow tool: write\nPath: a.txt'))
  t.abort()
  assert.deepEqual(got, [
    { approvalId: 'c1', decision: 'deny' },
    { approvalId: 'elic-1', decision: 'deny' }
  ])
  // 用户事后才点的那一下不能再产第二条：单槽 pending 被清两遍会误清下一张卡
  d.answer(0, 'allow')
  await Promise.resolve()
  assert.equal(got.length, 2)
})

test('abort 丢掉半句话，**不产 text.done** —— 那是被打断的，不是它说完了', () => {
  const t = createOmpTranslator(ALLOW)
  const out: string[] = []
  t.onEvent((e) => out.push(e.k))
  t.push(chunkLine('半句', 'm1'))
  t.abort()
  assert.deepEqual(out, [])
  assert.deepEqual(t.endTurn({ result: {} }).map((e) => e.k), ['turn.done'], '缓冲已经丢了')
})

test('**text.done 只按 agent_message_chunk 的 messageId 收口**，思考流是另一个 id', () => {
  const t = createOmpTranslator(ALLOW)
  // fixture 里思考流 messageId 86da…、正文 f820… —— 两条交错时按「来了别的更新就收口」
  // 会把半句话当成完整回答盖上去
  t.push(chunkLine('想', 'think-1', 'agent_thought_chunk'))
  t.push(chunkLine('你', 'm1'))
  t.push(chunkLine('想', 'think-1', 'agent_thought_chunk'))
  const mid = t.push(chunkLine('好', 'm1'))
  assert.deepEqual(mid.events.map((e) => e.k), ['text.delta'], '同一条 message 中途不收口')
  const next = t.push(chunkLine('第二段', 'm2'))
  const done = next.events.find((e) => e.k === 'text.done')
  assert.ok(done && done.k === 'text.done')
  assert.equal(done.text, '你好', '换 messageId 才收口，收的是整段不是最后一块')
})

test('endTurn 先收口正文再产 turn.done', () => {
  const t = createOmpTranslator(ALLOW)
  t.push(chunkLine('答案', 'm1'))
  const evs = t.endTurn({ result: { usage: { inputTokens: 3, outputTokens: 4 } } })
  assert.deepEqual(evs.map((e) => e.k), ['text.done', 'turn.done'])
  const done = evs[1]
  assert.ok(done.k === 'turn.done' && done.usage.outputTokens === 4)
})

test('**prompt 回 JSON-RPC error 时也必须产 turn.done**，否则界面一直转', () => {
  // busy 的三支判据全靠 turn.done 放倒；只推一条 error 的话「正在处理」永远不消失。
  const t = createOmpTranslator(ALLOW)
  const evs = t.endTurn({ error: { code: -32603, message: 'model provider not configured' } })
  assert.deepEqual(evs.map((e) => e.k), ['error', 'turn.done'])
  const err = evs[0]
  assert.ok(err.k === 'error' && err.fatal === false && err.message.includes('provider'))
  const done = evs[1]
  assert.ok(done.k === 'turn.done' && done.usage.inputTokens === 0, '失败的一轮用量算 0，不编')
})

test('sessionStats 给数据层：**有 currency、没有 costUsd**（花费的唯一出口是 tally）', () => {
  const t = createOmpTranslator(ALLOW)
  t.push(usageLine({ size: 128000, used: 12289, cost: { amount: 0.0123, currency: 'USD' } }))
  assert.deepEqual(t.sessionStats(), { contextWindow: 128000, contextUsed: 12289, currency: 'USD' })
  assert.equal(t.stats().costUsd, 0.0123, 'turnDoneOf 要的那份仍然带花费')
})

// ── session/new 的 configOptions ─────────────────────────────────────────

test('**没有 model 那一项 = 还没配 provider**，这是引导用户去设置的唯一判据', () => {
  // 2026-09-02 在 18.1.2 上实测：没配 provider 时 configOptions 只有 mode 与 thinking。
  const caps = fromConfigOptions([
    { id: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default' }] },
    { id: 'thinking', currentValue: 'medium', options: [{ value: 'medium', name: 'Medium' }] }
  ])
  assert.equal(caps.hasModel, false)
  assert.equal(caps.models, undefined)
})

test('configOptions 是**数组**，取项靠 id；mode 显式忽略，不许混进模型下拉', () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '__fixtures__', 'omp-acp-handshake.json'), 'utf8')
  ) as { sessionNew: { configOptions?: unknown } }
  const caps = fromConfigOptions(raw.sessionNew.configOptions)
  assert.equal(caps.hasModel, true)
  assert.ok((caps.models ?? []).length > 0, '真录里 model 项是有选项的')
  assert.ok(caps.model && caps.model.includes('/'), 'value 是 <provider>/<model>')
  assert.ok(!(caps.models ?? []).some((m) => m.id === 'plan'), 'mode 的选项不能混进来')
})

test('configOptions 给的是垃圾也不抛', () => {
  for (const bad of [undefined, null, 42, {}, [null, 'x', { id: 'model' }]]) {
    const caps = fromConfigOptions(bad)
    assert.equal(typeof caps.hasModel, 'boolean')
  }
})
