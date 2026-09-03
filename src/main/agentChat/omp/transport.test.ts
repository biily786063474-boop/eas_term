// ACP 传输层的测试：**用一个假 agent 驱动，不起任何进程、不连网**。
//
// 这一层是 omp 接入里唯一「会话真的跑起来」的地方，而它没法靠既有那两个验证脚本兜住
// （一个要真花 Claude 额度、一个的 DOM 判据已经陈旧）。所以它的正确性全靠这里。
//
// 假 agent 就是一个手写的 `AcpProcess`：我们写进去的每一行它都记下来，
// 测试再按剧本把响应喂回去。**它刻意不实现 ACP 的语义** —— 一实现就变成了
// 「我们对协议的理解」在自己跟自己对答，那种测试全绿也说明不了什么。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAcpLive, type AcpDeps, type AcpProcess } from './transport.ts'
import type { ChatEvent } from '../../../shared/agentChat.ts'

interface Fake {
  proc: AcpProcess
  /** 我们发出去的每一行（已解析） */
  sent: Record<string, unknown>[]
  /** 按 method 找我们发出的最后一条请求 */
  last(method: string): Record<string, unknown> | undefined
  /** 喂一条响应给我们某个请求 */
  reply(method: string, result: unknown): void
  replyError(method: string, error: { code?: number; message?: string }): void
  /** 喂一条服务端通知 / 请求 */
  push(obj: Record<string, unknown>): void
  exit(code?: number | null): void
  killed: boolean
}

function fakeProc(): Fake {
  const sent: Record<string, unknown>[] = []
  let onLine: ((l: string) => void) | null = null
  let onExit: ((c: number | null, s: string | null) => void) | null = null
  const f: Fake = {
    sent,
    killed: false,
    proc: {
      write(line) {
        for (const l of line.split('\n')) if (l.trim()) sent.push(JSON.parse(l))
      },
      onLine(cb) {
        onLine = cb
      },
      onStderr() {},
      onExit(cb) {
        onExit = cb
      },
      kill() {
        f.killed = true
      }
    },
    last: (method) => [...sent].reverse().find((m) => m.method === method),
    reply(method, result) {
      const req = f.last(method)
      assert.ok(req, `还没发过 ${method}`)
      onLine?.(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }))
    },
    replyError(method, error) {
      const req = f.last(method)
      assert.ok(req, `还没发过 ${method}`)
      onLine?.(JSON.stringify({ jsonrpc: '2.0', id: req.id, error }))
    },
    push: (obj) => onLine?.(JSON.stringify(obj)),
    exit: (code = 0) => onExit?.(code, null)
  }
  return f
}

/** 配好 provider 的 `session/new` 响应。没有 `model` 那一项就是「还没配」—— 见 §T.3 */
const NEW_OK = (sessionId = 's-1'): Record<string, unknown> => ({
  sessionId,
  configOptions: [
    { id: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default' }] },
    {
      id: 'model',
      currentValue: 'p/m1',
      options: [
        { value: 'p/m1', name: 'M1' },
        { value: 'p/m2', name: 'M2' }
      ]
    },
    { id: 'thinking', currentValue: 'off', options: [{ value: 'off', name: 'Off' }, { value: 'auto', name: 'Auto' }] }
  ]
})

interface Harness {
  live: ReturnType<typeof createAcpLive>
  f: Fake
  events: ChatEvent[]
  kinds(): string[]
  opened: number
}

function harness(
  o: {
    model?: string
    effort?: string
    resumeId?: string
    mcpServers?: AcpDeps extends { mcpServers(): infer R } ? R : never
    openFails?: { message: string; setup: boolean }
  } = {}
): Harness {
  const f = fakeProc()
  const events: ChatEvent[] = []
  const h = { opened: 0 } as Harness
  const deps: AcpDeps = {
    open() {
      if (o.openFails) return { ok: false, ...o.openFails }
      h.opened += 1
      return { ok: true, proc: f.proc }
    },
    emit: (e) => events.push(e),
    log: () => {},
    clientVersion: '9.9.9',
    mcpServers: () => o.mcpServers ?? [],
    now: () => 1_000_000
  }
  h.live = createAcpLive(deps, '/w', {
    idPrefix: 'ac-1:',
    model: o.model,
    effort: o.effort,
    resumeId: o.resumeId
  })
  h.f = f
  h.events = events
  h.kinds = () => events.map((e) => e.k)
  return h
}

/** 让所有已排队的微任务跑完。transport 的握手是一串 await，测试要等它推进 */
const tick = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

/** 走完握手，停在 ready */
async function open(h: Harness, newResult: Record<string, unknown> = NEW_OK()): Promise<void> {
  h.live.deliver('你好')
  await tick()
  h.f.reply('initialize', { protocolVersion: 1 })
  await tick()
  h.f.reply('session/new', newResult)
  await tick()
}

// ── 握手 ──────────────────────────────────────────────────────────────────

test('握手顺序：initialize → session/new，且声明了 elicitation.form', async () => {
  const h = harness()
  h.live.deliver('你好')
  await tick()
  const init = h.f.last('initialize')
  assert.ok(init, '第一条必须是 initialize')
  const caps = (init.params as Record<string, Record<string, unknown>>).clientCapabilities
  // **不声明 elicitation.form 的后果不是「省掉第二条通道」**，是 omp 直接拒掉
  // 需要问用户的工具 —— 那样审批卡片一张都不会出现。
  assert.deepEqual(caps.elicitation, { form: true })
  assert.equal(h.f.last('session/new'), undefined, 'initialize 还没回话就不该发 session/new')
})

test('**没配 provider（configOptions 里没有 model）→ kind:setup**，不是普通报错也不是 auth', async () => {
  const h = harness()
  h.live.deliver('你好')
  await tick()
  h.f.reply('initialize', {})
  await tick()
  h.f.reply('session/new', { sessionId: 's-1', configOptions: [{ id: 'mode' }, { id: 'thinking' }] })
  await tick()
  const err = h.events.find((e) => e.k === 'error')
  assert.ok(err && err.k === 'error')
  // 'auth' 会让工具栏摆出「去登录」，那条路只认 claude/codex，点下去是死路。
  assert.equal(err.kind, 'setup')
})

test('握手完要报 capabilities 与 session.ready，模型取服务端当前值', async () => {
  const h = harness()
  await open(h)
  const cap = h.events.find((e) => e.k === 'capabilities')
  assert.ok(cap && cap.k === 'capabilities')
  assert.deepEqual(cap.models?.map((m) => m.id), ['p/m1', 'p/m2'])
  const ready = h.events.find((e) => e.k === 'session.ready')
  assert.ok(ready && ready.k === 'session.ready' && ready.sessionId === 's-1' && ready.model === 'p/m1')
})

test('**start 带 model → 第一条 prompt 之前必须先发 set_config_option**', async () => {
  // session/new 收不了 model 参数、spawn 也不带 --model。少这一步的症状很隐蔽：
  // 用户选了 A、实际跑的是服务端默认的 B，而工具栏显示的是回读的 B —— 看不出错。
  const h = harness({ model: 'p/m2' })
  await open(h)
  const cfg = h.f.last('session/set_config_option')
  assert.ok(cfg, '没发 set_config_option')
  assert.deepEqual(cfg.params, { sessionId: 's-1', configId: 'model', value: 'p/m2' })
  assert.equal(h.f.last('session/prompt'), undefined, 'set_config_option 还没回话就发了 prompt')
})

test('模型与服务端当前值相同就不必多发一次', async () => {
  const h = harness({ model: 'p/m1' })
  await open(h)
  assert.equal(h.f.last('session/set_config_option'), undefined)
})

test('**恢复走 session/resume 不走 session/load**（后者按协议要重放整段历史）', async () => {
  const h = harness({ resumeId: 's-old' })
  h.live.deliver('接着说')
  await tick()
  h.f.reply('initialize', {})
  await tick()
  assert.ok(h.f.last('session/resume'), '应该发 resume')
  assert.equal(h.f.last('session/load'), undefined, 'load 会把历史重播一遍')
  assert.equal(h.f.last('session/new'), undefined)
})

test('resume 的响应没有 sessionId —— 要沿用请求里那个，否则 resumeId 从此写不回去', async () => {
  const h = harness({ resumeId: 's-old' })
  h.live.deliver('接着说')
  await tick()
  h.f.reply('initialize', {})
  await tick()
  // 上游的 ResumeSessionResponse 只有 configOptions 与 modes
  h.f.reply('session/resume', { configOptions: NEW_OK().configOptions })
  await tick()
  const ready = h.events.find((e) => e.k === 'session.ready')
  assert.ok(ready && ready.k === 'session.ready')
  assert.equal(ready.sessionId, 's-old')
})

test('resume 撞到「找不到会话」→ 退回 session/new 并明说上下文丢了，不能卡死', async () => {
  const h = harness({ resumeId: 's-gone' })
  h.live.deliver('接着说')
  await tick()
  h.f.reply('initialize', {})
  await tick()
  h.f.replyError('session/resume', { message: 'ACP session not found: s-gone' })
  await tick()
  assert.ok(h.f.last('session/new'), '应该改发 session/new')
  h.f.reply('session/new', NEW_OK('s-new'))
  await tick()
  const notice = h.events.find((e) => e.k === 'error' && !e.fatal)
  assert.ok(notice, '上下文丢了要告诉用户')
  assert.equal(h.live.phase(), 'prompting')
})

test('握手期到达的服务端更新一律不产事件（万一哪天换回会重放的那条路，这是兜底）', async () => {
  const h = harness()
  h.live.deliver('你好')
  await tick()
  h.f.reply('initialize', {})
  // 还没回 session/new，phase 仍是 opening
  h.f.push({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '旧的' } } }
  })
  await tick()
  assert.equal(h.kinds().filter((k) => k === 'text.delta').length, 0)
})

// ── 一轮的收尾 ────────────────────────────────────────────────────────────

test('prompt 拿到响应 → turn.done', async () => {
  const h = harness()
  await open(h)
  h.f.reply('session/prompt', { stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 7 } })
  await tick()
  const done = h.events.find((e) => e.k === 'turn.done')
  assert.ok(done && done.k === 'turn.done' && done.usage.outputTokens === 7)
  assert.equal(h.live.phase(), 'ready')
})

test('**prompt 回 JSON-RPC error 也必须产 turn.done**，否则界面永远转下去', async () => {
  // 配错 key / baseUrl 时最常见的就是这条路。reduce 的 busy 有三支判据，
  // 一次放倒三支的只有 turn.done。
  const h = harness()
  await open(h)
  h.f.replyError('session/prompt', { code: -32000, message: 'invalid api key' })
  await tick()
  assert.ok(h.kinds().includes('turn.done'))
  const err = h.events.filter((e) => e.k === 'error').at(-1)
  assert.ok(err && err.k === 'error' && err.fatal === false && /invalid api key/.test(err.message))
})

test('**进程在 prompt 途中没了 → 也要补 turn.done**', async () => {
  const h = harness()
  await open(h)
  h.f.exit(1)
  await tick()
  assert.ok(h.kinds().includes('turn.done'))
  assert.equal(h.live.phase(), 'dead')
})

// ── 排队 ──────────────────────────────────────────────────────────────────

test('**跑一轮时再发一句要排队、不拒收** —— Claude 那条路在忙时也是照收的', async () => {
  const h = harness()
  await open(h)
  h.live.deliver('第二句')
  await tick()
  // 同一时刻只许一个 prompt 在飞（turn.done 的配对与单槽 pending 都靠这个）
  assert.equal(h.f.sent.filter((m) => m.method === 'session/prompt').length, 1)
  h.f.reply('session/prompt', { usage: {} })
  await tick()
  const prompts = h.f.sent.filter((m) => m.method === 'session/prompt')
  assert.equal(prompts.length, 2, '第一条回话后队列要放行下一条')
  assert.deepEqual((prompts[1].params as { prompt: { text: string }[] }).prompt[0].text, '第二句')
})

test('握手期改模型不产生 pending 重启，握手完合并成一次发出去', async () => {
  const h = harness()
  h.live.deliver('你好')
  await tick()
  h.live.setParams({ model: 'p/m2' })
  h.f.reply('initialize', {})
  await tick()
  h.f.reply('session/new', NEW_OK())
  await tick()
  const cfgs = h.f.sent.filter((m) => m.method === 'session/set_config_option')
  assert.equal(cfgs.length, 1, '应该只发一次')
  assert.equal((cfgs[0].params as { value: string }).value, 'p/m2')
})

// ── 中断 ──────────────────────────────────────────────────────────────────

test('**按停发 session/cancel、不 kill 进程**', async () => {
  // kill 会打断 omp 后台那 5 秒收尾；收尾没做完，下一条消息 resume 会「找不到会话」，
  // 用户看到的是「只是停了一下，整段对话没了」。
  const h = harness()
  await open(h)
  h.live.interrupt()
  await tick()
  assert.ok(h.f.last('session/cancel'), '没发 cancel')
  assert.equal(h.f.killed, false, '不该 kill')
  // 上游收到 cancel 会立刻用 cancelled 回掉在飞的 prompt
  h.f.reply('session/prompt', { stopReason: 'cancelled', usage: {} })
  await tick()
  assert.ok(h.kinds().includes('turn.done'))
  assert.equal(h.live.phase(), 'ready', '进程与会话都还在')
})

test('close 发 session/close（通知，不等回话）', async () => {
  const h = harness()
  await open(h)
  h.live.close()
  const c = h.f.last('session/close')
  assert.ok(c && c.id === undefined, 'close 是通知，不该带 id')
})

// ── 起不来 ────────────────────────────────────────────────────────────────

test('起不来且原因是「还没配好」→ 报成 kind:setup（界面据此摆设置入口）', async () => {
  const h = harness({ openFails: { message: '还没选模型服务商', setup: true } })
  h.live.deliver('你好')
  await tick()
  const err = h.events.find((e) => e.k === 'error')
  assert.ok(err && err.k === 'error' && err.fatal && err.kind === 'setup')
})

test('起不来且是包坏了 → 普通致命错误，不摆设置入口', async () => {
  const h = harness({ openFails: { message: '包里没有 omp', setup: false } })
  h.live.deliver('你好')
  await tick()
  const err = h.events.find((e) => e.k === 'error')
  assert.ok(err && err.k === 'error' && err.fatal && err.kind === undefined)
})

// ── 别的 ──────────────────────────────────────────────────────────────────

test('不认识的服务端**请求**要回 -32601，不能不理（对方可能一直等）', async () => {
  const h = harness()
  await open(h)
  h.f.push({ jsonrpc: '2.0', id: 99, method: 'fs/read_text_file', params: {} })
  await tick()
  const rep = h.f.sent.find((m) => m.id === 99)
  assert.ok(rep, '没回话')
  assert.equal((rep.error as { code: number }).code, -32601)
})

test('不认识的服务端**通知**不用回话（回了反而是协议错误）', async () => {
  const h = harness()
  await open(h)
  const before = h.f.sent.length
  h.f.push({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'session_info_update' } } })
  await tick()
  assert.equal(h.f.sent.length, before)
})

test('**进程重开时翻译器不重建** —— stats 里的累计不许归零', async () => {
  // 重建的后果：一个被空闲回收又唤醒的会话，团队面板同一行上 tally.costUsd 还是 $1.2，
  // 而 stats 变成空 —— 两个花费数字自相矛盾，还没人报错。
  const h = harness()
  await open(h)
  h.f.push({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { update: { sessionUpdate: 'usage_update', size: 128000, used: 4096 } }
  })
  await tick()
  assert.equal(h.live.stats().contextWindow, 128000)
  h.f.exit(0)
  await tick()
  assert.equal(h.live.stats().contextWindow, 128000, '进程没了不该把会话累计一起清掉')
})

test('stats() 是给数据层那份——**不含花费**（花费的唯一出口是 turn.done → tally）', async () => {
  const h = harness()
  await open(h)
  h.f.push({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { update: { sessionUpdate: 'usage_update', size: 1000, used: 10, cost: { amount: 0.5, currency: 'USD' } } }
  })
  await tick()
  const s = h.live.stats() as Record<string, unknown>
  assert.equal(s.costUsd, undefined, '两处都放同一个数，跨会话求和就会加两遍')
  assert.equal(s.currency, 'USD')
})

// ── 2026-09-03 · 用户实拍：omp 卡在「正在处理」，点停止也停不下来 ────────────
//
// 日志最后一行是 `[omp] omp 进程已结束`，比截图早 4 分钟 —— 进程早死了，
// 界面却一直转。根因两条叠在一起：
//   ① `interrupt()` 第一行 `if (phase !== 'prompting') return` —— 进程死了
//      phase 是 'dead'，这一下**什么都没做**；
//   ② `session.ts` 的 ACP 分支只推一条 `fatal:false` 的提醒，**没有 turn.done**，
//      它指望 transport 拿到 cancelled 响应时产出 —— 而那条响应永远不会来。
//
// 「能一次放倒三支 busy 判据的只有 turn.done」这条结论，非 ACP 分支的注释里
// 早就写着（那边为此修过一次），ACP 分支漏了。

test('**进程死了之后按停止：interrupt 要如实说「我没接手」**', async () => {
  const h = harness()
  await open(h)
  h.live.deliver('干活')
  await tick()
  h.f.exit() // 进程没了
  await tick()
  assert.equal(h.live.interrupt(), false, '没接手就要返回 false，让调用方自己补 turn.done')
})

test('正常在跑时按停止：interrupt 接手，返回 true', async () => {
  const h = harness()
  await open(h)
  await tick()
  assert.equal(h.live.interrupt(), true)
})

test('还没起会话时按停止：返回 false（没有轮次可停）', () => {
  const h = harness()
  assert.equal(h.live.interrupt(), false)
})

test('**进程在有排队消息时死掉，也要把那一轮收掉** —— 否则界面一直转', async () => {
  const h = harness()
  await open(h)
  h.live.deliver('第一条')
  await tick()
  h.live.deliver('第二条') // 上一轮在飞，这条进队列
  await tick()
  const before = h.kinds().filter((k) => k === 'turn.done').length
  h.f.exit()
  await tick()
  const after = h.kinds().filter((k) => k === 'turn.done').length
  assert.ok(after > before, '进程死了却没有 turn.done，busy 三支判据一支都放不倒')
})

// ── 2026-09-03 · 真根因：**会话空闲时发的消息永远发不出去** ──────────────────
//
// 用户实拍那次，翻 omp 自己的会话记录发现：整段会话里**只有一条**用户消息。
// 助手答完进入空闲之后，用户又发的两条根本没进会话 —— 界面上显示着（乐观插入），
// omp 那侧一个字都没收到。
//
// `pump()` 只有两个调用点：`prompt()` 的 finally（一轮结束时泵下一条），
// 和 `ensureAndSend` 里**只有 phase==='dead' 才走到**的那一处。
// 于是：
//   · 上一轮还在跑时发 → 排队 → finally 泵它 ✓
//   · 会话已经死了再发 → 重开 → 泵它 ✓
//   · **会话活着且空闲时发 → 排队 → 没有任何东西泵它 ✗**
// 第三条正是「答完话之后再问一句」这个最普通的用法。

test('**会话空闲时发消息要立刻送出去**（不是排队等一个不会来的泵）', async () => {
  const h = harness()
  await open(h)
  // 第一轮跑完 → phase 回到 ready
  h.f.reply('session/prompt', { stopReason: 'end_turn' })
  await tick()
  const before = h.f.sent.filter((m) => m.method === 'session/prompt').length
  // 现在是空闲态，再发一条
  h.live.deliver('答完了我再问一句')
  await tick()
  assert.equal(
    h.f.sent.filter((m) => m.method === 'session/prompt').length,
    before + 1,
    '空闲时发的消息没有送出去 —— 它排在队列里，而没有任何东西会去泵它'
  )
})

test('上一轮还在跑时发的，仍然按原样排队、由那一轮结束时泵出去', async () => {
  const h = harness()
  await open(h)
  const before = h.f.sent.filter((m) => m.method === 'session/prompt').length
  h.live.deliver('插队的第二条')
  await tick()
  assert.equal(h.f.sent.filter((m) => m.method === 'session/prompt').length, before, '上一轮没结束就抢跑了')
  h.f.reply('session/prompt', { stopReason: 'end_turn' })
  await tick()
  assert.equal(h.f.sent.filter((m) => m.method === 'session/prompt').length, before + 1, '上一轮结束了却没泵出排队的那条')
})
