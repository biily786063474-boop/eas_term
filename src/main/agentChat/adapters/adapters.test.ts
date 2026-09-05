import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listAdapters, getAdapter } from './index.ts'
import { ASK_FIRST_PROMPT, OUTPUT_STYLE_PROMPT, safeRoleTools, safeRoleBounds } from '../../../shared/agentChat.ts'

// ============================================================
// 以下到分隔线为止，逐字来自 task-5-brief.md —— 不许改动断言内容。
// ============================================================

test('注册表至少含 claude 与 codex', () => {
  const ids = listAdapters().map((a) => a.id)
  assert.ok(ids.includes('claude'))
  assert.ok(ids.includes('codex'))
})

test('每个 adapter 的能力声明字段齐全', () => {
  for (const a of listAdapters()) {
    assert.equal(typeof a.displayName, 'string')
    assert.ok(a.displayName.length > 0, `${a.id} 缺 displayName`)
    assert.ok(Array.isArray(a.capabilities.approval), `${a.id} 的 approval 必须是数组`)
    assert.equal(typeof a.capabilities.contextUsage, 'boolean')
  }
})

test('Claude 的 effort 取值与 CLI 实测一致', () => {
  const c = getAdapter('claude')!
  const ids = (c.capabilities.effortLevels ?? []).map((e) => e.id)
  assert.deepEqual(ids, ['low', 'medium', 'high', 'xhigh', 'max'])
})

test('Claude 启动参数含实测确认过的那几个必需项', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/WORK/proj' })
  for (const need of [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--include-hook-events'
  ]) {
    assert.ok(args.includes(need), `启动参数缺 ${need}`)
  }
})

test('没给 mcpConfigPath 时仍是零 MCP 工具（opt-out 的人走这条路）', () => {
  // 用户在「扩展能力」里关掉 MCP 接入 → agentMcpConfigPath() 返回 null →
  // 这里拿不到路径。那时 --strict-mcp-config 单独存在，语义是
  // 「只用 --mcp-config 给的，忽略其它一切」= 一个 server 都不加载。
  // **关了就该两边都关**，只关终端那半、AI 对话里还有，比不关更让人困惑。
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/WORK/proj' })
  assert.ok(args.includes('--strict-mcp-config'), '少了它会退回读全局 MCP 配置')
  assert.ok(!args.includes('--mcp-config'), '没给路径就不该凭空冒出这个参数')
})

test('给了 mcpConfigPath 就带上 --mcp-config，且 strict 必须还在', () => {
  // 这条曾经反着写：「加 --mcp-config 会让这条变红，那是有意的」。
  // 2026-08-20 用户明确要求接上（原话「MCP服务在AI对话窗口进行的时候好像也没有连接」），
  // 决定做了，测试跟着翻面。
  //
  // **strict 必须保留**：它现在的作用不再是「屏蔽一切」，而是把工具面**限定成**
  // 我们给的那一份（eas-term + bizone-canvas，见 mcpBridge.agentMcpConfigPath），
  // 不把用户全局装的其它 MCP server 带进 AI 对话。
  // 去掉它也能连上，但工具面就成了用户全局的全集，不可控。
  //
  // 2026-08-23：画板从这份名单里加回来了（此前被排除，导致 skill 声称能生图、
  // 工具却不存在，模型只能回「画板 MCP 没连接」——用户为此报了两次）。
  const { args } = getAdapter('claude')!.buildArgs({
    cwd: '/WORK/proj',
    mcpConfigPath: '/WORK/userData/agent-mcp.json'
  })
  assert.ok(args.includes('--mcp-config'), '给了路径却没传进去')
  assert.equal(args[args.indexOf('--mcp-config') + 1], '/WORK/userData/agent-mcp.json')
  assert.ok(args.includes('--strict-mcp-config'), '**不能因为加了 --mcp-config 就把 strict 拿掉**')
})

test('团队 agent 现在能拿到 team_spawn 工具了 —— 那道硬闸成了唯一防线', () => {
  // 在这之前，「团队成员不能再派活」在 Claude 侧靠的是**它压根没有这个工具**
  // （harness 层直接报 No such tool available）。接上 MCP 之后那层被动保护没了，
  // mcpHandler 里 isTeamOwnedCaller 的硬闸变成唯一防线。
  //
  // 这里锁的是「参数确实会让工具面打开」这个前提 —— 硬闸本身的测试在 mcpHandler 那侧。
  // 好的一面：越权尝试从此**可审计**，以前它只在对方自己的 transcript 里留一行。
  const { args } = getAdapter('claude')!.buildArgs({
    cwd: '/WORK/proj',
    mcpConfigPath: '/WORK/x.json'
  })
  assert.ok(args.includes('--mcp-config'), '工具面打开的前提')
})

test('Claude 绝不能带 --bare 或 --permission-mode manual', () => {
  // 两条都是实测踩过的：--bare 会跳过认证返回 Not logged in；
  // manual 是直接拒绝而非等待审批，会让审批卡片永远等不到人。
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/WORK/proj', model: 'opus' })
  assert.ok(!args.includes('--bare'))
  const i = args.indexOf('--permission-mode')
  if (i >= 0) assert.notEqual(args[i + 1], 'manual')
})

test('传了 resumeId 才出现 --resume', () => {
  const a = getAdapter('claude')!
  assert.ok(!a.buildArgs({ cwd: '/x' }).args.includes('--resume'))
  const withResume = a.buildArgs({ cwd: '/x', resumeId: 'sess-1' }).args
  assert.ok(withResume.includes('--resume'))
  assert.ok(withResume.includes('sess-1'))
})

test('Claude 支持逐次审批；Codex 在 exec 模式下不支持，必须报空数组', () => {
  // 空数组不是"忘了填"，是明确表示"这个 CLI 做不了逐次审批"。
  // UI 据此退回沙箱级别选择——不写任何按 CLI 名字的分支。
  assert.ok(getAdapter('claude')!.capabilities.approval.length > 0)
  assert.deepEqual(getAdapter('codex')!.capabilities.approval, [])
})

test('approval 为空的 adapter 必须给出 sandboxLevels，否则 UI 无从退回', () => {
  // 这条锁死能力声明的自洽性：不能既说"我不支持逐次审批"、又不告诉 UI 该显示什么替代品
  for (const a of listAdapters()) {
    if (a.capabilities.approval.length === 0) {
      assert.ok(
        (a.capabilities.sandboxLevels ?? []).length > 0,
        `${a.id} 报了 approval:[] 却没有 sandboxLevels，UI 会显示一片空白`
      )
    }
  }
})

test('Codex 启动参数走 exec --json 并带沙箱级别', () => {
  const { args } = getAdapter('codex')!.buildArgs({ cwd: '/WORK/proj' })
  assert.ok(args.includes('exec'))
  assert.ok(args.includes('--json'))
  assert.ok(args.includes('--sandbox'), '不给 --sandbox 时 Codex 默认只读，写文件会被静默拒绝')
})

test('未知 id 返回 undefined，不抛', () => {
  assert.equal(getAdapter('不存在的cli'), undefined)
})

// ============================================================
// 以下是补充断言：上面这批题面测试只验证了「字段存在/类型对」或部分取值，
// 没锁住简报里写死的具体字面值与分支行为。按 Ruling 7 的纪律，
// 逐个字段自问「改成一个固定错值，上面的测试会不会失败」——不会的，在这里补上。
// ============================================================

test('[补充] 注册表没有重复 id', () => {
  const ids = listAdapters().map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('[补充] getAdapter 与 listAdapters 返回同一份对象，不是各自现造的副本', () => {
  const fromList = listAdapters().find((a) => a.id === 'claude')
  assert.strictEqual(getAdapter('claude'), fromList)
})

test('[补充] detect() 契约：返回 Promise<boolean>（不要求真装了这个 CLI）', async () => {
  for (const a of listAdapters()) {
    const r = await a.detect()
    assert.equal(typeof r, 'boolean')
  }
})

test('[补充] Claude 的 models 列表与实测字面值完全一致（id 与 label 都要对）', () => {
  const models = getAdapter('claude')!.capabilities.models ?? []
  assert.deepEqual(models, [
    { id: 'fable', label: 'Fable' },
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku', label: 'Haiku' }
  ])
})

test('[补充] Claude 的 effort 标签是中文人话，不只是 id 对——原测试只 map(e => e.id)，标签没人锁', () => {
  const levels = getAdapter('claude')!.capabilities.effortLevels ?? []
  assert.deepEqual(levels, [
    { id: 'low', label: '低' },
    { id: 'medium', label: '中' },
    { id: 'high', label: '高' },
    { id: 'xhigh', label: '很高' },
    { id: 'max', label: '最高' }
  ])
})

test('[补充] Claude 的 compact / contextUsage 精确取值（原测试只查 typeof boolean，true/false 都能过）', () => {
  const c = getAdapter('claude')!.capabilities
  assert.equal(c.compact, 'slash')
  assert.equal(c.contextUsage, true)
})

test('[补充] Claude 的 approval 精确覆盖三种审批类型，不是随便一个非空数组', () => {
  assert.deepEqual(getAdapter('claude')!.capabilities.approval, ['exec', 'patch', 'tool'])
})

test('[补充] Claude 带 -p（真正的 prompt 内容由上层通过 stdin 写入，这里只是触发非交互模式的裸标志）', () => {
  const args = getAdapter('claude')!.buildArgs({ cwd: '/x' }).args
  assert.ok(args.includes('-p'))
})

test('[补充] Claude 的 model / effort 分别用 --model / --effort 传，且带上实际取值', () => {
  const args = getAdapter('claude')!.buildArgs({ cwd: '/x', model: 'opus', effort: 'xhigh' }).args
  const mi = args.indexOf('--model')
  assert.ok(mi >= 0, '缺 --model')
  assert.equal(args[mi + 1], 'opus')
  const ei = args.indexOf('--effort')
  assert.ok(ei >= 0, '缺 --effort')
  assert.equal(args[ei + 1], 'xhigh')
})

test('[补充] 不传 model / effort 时，--model / --effort 都不出现（不能给假默认值）', () => {
  const args = getAdapter('claude')!.buildArgs({ cwd: '/x' }).args
  assert.ok(!args.includes('--model'))
  assert.ok(!args.includes('--effort'))
})

test('[补充] Claude 的 buildArgs 返回 bin: "claude"', () => {
  assert.equal(getAdapter('claude')!.buildArgs({ cwd: '/x' }).bin, 'claude')
})

test('[补充] Codex 的 models 明确是空数组（-m 传任意模型名，不预设列表——不是漏填）', () => {
  assert.deepEqual(getAdapter('codex')!.capabilities.models, [])
})

test('[补充] Codex 的 effort 取值只有三档，与 Claude 的五档不同，标签也要对', () => {
  const levels = getAdapter('codex')!.capabilities.effortLevels ?? []
  assert.deepEqual(levels, [
    { id: 'low', label: '低' },
    { id: 'medium', label: '中' },
    { id: 'high', label: '高' }
  ])
})

test('[补充] Codex 的 compact / contextUsage 精确取值', () => {
  const c = getAdapter('codex')!.capabilities
  assert.equal(c.compact, false)
  assert.equal(c.contextUsage, true)
})

test('[补充] Codex 的 sandboxLevels 精确匹配三档（id 与 label 都要对，UI 退回时靠它渲染选项）', () => {
  const levels = getAdapter('codex')!.capabilities.sandboxLevels ?? []
  assert.deepEqual(levels, [
    { id: 'read-only', label: '只读' },
    { id: 'workspace-write', label: '可改工作区' },
    { id: 'danger-full-access', label: '完全放开' }
  ])
})

test('[补充] Codex 不传 sandbox 时默认 workspace-write；传了就原样透传', () => {
  const withoutSandbox = getAdapter('codex')!.buildArgs({ cwd: '/x' }).args
  const i1 = withoutSandbox.indexOf('--sandbox')
  assert.equal(withoutSandbox[i1 + 1], 'workspace-write')

  const withSandbox = getAdapter('codex')!.buildArgs({ cwd: '/x', sandbox: 'read-only' }).args
  const i2 = withSandbox.indexOf('--sandbox')
  assert.equal(withSandbox[i2 + 1], 'read-only')
})

test('[补充] Codex 的 model 用 -m 传，且带上实际取值', () => {
  const args = getAdapter('codex')!.buildArgs({ cwd: '/x', model: 'gpt-5-codex' }).args
  const i = args.indexOf('-m')
  assert.ok(i >= 0, '缺 -m')
  assert.equal(args[i + 1], 'gpt-5-codex')
})

test('[补充] Codex 的 effort 用 -c model_reasoning_effort=<值> 传，不是独立的 --effort 参数', () => {
  const args = getAdapter('codex')!.buildArgs({ cwd: '/x', effort: 'high' }).args
  assert.ok(args.includes('-c'), '缺 -c')
  assert.ok(args.includes('model_reasoning_effort=high'), '格式不对：应是单个 token model_reasoning_effort=high')
  assert.ok(!args.includes('--effort'), 'Codex 不该有 --effort 这个参数——那是 Claude 的传法')
})

test('[补充] Codex 传了 resumeId 用 exec resume <id>，不传就是普通 exec（原测试完全没覆盖 Codex 的 resume 分支）', () => {
  const a = getAdapter('codex')!
  const withoutResume = a.buildArgs({ cwd: '/x' }).args
  assert.ok(!withoutResume.includes('resume'))

  const withResume = a.buildArgs({ cwd: '/x', resumeId: 'thread-1' }).args
  assert.ok(withResume.includes('exec'))
  assert.ok(withResume.includes('resume'))
  assert.ok(withResume.includes('thread-1'))
})

test('[补充] Codex 的 buildArgs 返回 bin: "codex"', () => {
  assert.equal(getAdapter('codex')!.buildArgs({ cwd: '/x' }).bin, 'codex')
})

// ============================================================
// 以下是协调者追加裁定的字段（顾虑 1 修复）：buildArgs 的返回值加 stdin: 'pipe' | 'ignore'。
// 不能只断言字段存在——上一轮的教训就是"存在但值不对"测不出来，这里直接锁精确值。
// ============================================================

test('[追加] Claude 的 stdin 精确是 pipe——stream-json 靠它送用户消息，不能是 ignore', () => {
  assert.equal(getAdapter('claude')!.buildArgs({ cwd: '/x' }).stdin, 'pipe')
})

test('[追加] Codex 的 stdin 精确是 ignore——不关掉会卡在 Reading additional input from stdin...', () => {
  assert.equal(getAdapter('codex')!.buildArgs({ cwd: '/x' }).stdin, 'ignore')
})

// ============================================================
// 以下是 2026-08-14 全分支评审的两条修复：
// I5——Claude 不该再带 --include-partial-messages（flag 开着但 claudeEvents.ts 的
//   default 分支把 stream_event 全丢了，纯成本零收益，先摘掉）。
// I6——translator 与「装哪种审批机制」都要由 adapter 自己声明，不能靠 session.ts
//   按 CLI id 分支或拿 capabilities.approval.length>0 当开关（那样加第三个 CLI 会
//   静默拿到 Claude 的翻译器 / 被错误装上 Claude 的 hook）。
// ============================================================

// 2026-08-17：这条原来锁的是「**不**带 --include-partial-messages」，理由是当时没有
// 消费者（评审 I5：flag 开着、事件全被 default 分支静默丢弃 = 纯成本零收益）。
// 现在消费者写好了（claudeEvents 的 translateStreamEvent → reduce 的 streamingTurn），
// 决定反过来。**但那条理由本身没变**：flag 与消费者必须成对存在。
// 所以这条测试改成同时锁两头 —— 带着 flag，且翻译器真的认得它吐出来的东西。
test('Claude 带 --include-partial-messages，且翻译器真的消费它（flag 与消费者必须成对）', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/x' })
  assert.ok(args.includes('--include-partial-messages'), '流式输出要靠这个 flag')
  const t = getAdapter('claude')!.createTranslator()
  const out = t.push(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你' } },
      session_id: 's1'
    }) + '\n'
  )
  assert.deepEqual(out, [{ k: 'text.delta', text: '你' }], 'flag 开着却没人消费 = 纯成本零收益')
})

test('stream_event 里非 text_delta 的那些不产出事件（分块骨架和思考过程都不是回答正文）', () => {
  const t = getAdapter('claude')!.createTranslator()
  for (const ev of [
    { type: 'message_start', message: { id: 'm1' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '嗯' } }
  ]) {
    const out = t.push(JSON.stringify({ type: 'stream_event', event: ev, session_id: 's1' }) + '\n')
    assert.deepEqual(out, [], `${ev.type} 不该产出事件`)
  }
})

test('[I6] 每个 adapter 都声明了 createTranslator，调用后返回的对象有 push 方法', () => {
  for (const a of listAdapters()) {
    assert.equal(typeof a.createTranslator, 'function', `${a.id} 缺 createTranslator`)
    const t = a.createTranslator()
    assert.equal(typeof t.push, 'function', `${a.id} 的 createTranslator() 返回值缺 push`)
  }
})

test('[I6] Claude 的 createTranslator 产出真的是 Claude 翻译器——喂一行 Claude 的 init 事件能产出 session.ready', () => {
  const t = getAdapter('claude')!.createTranslator()
  const evs = t.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'opus', cwd: '/x' }))
  assert.ok(evs.some((e) => e.k === 'session.ready'), 'Claude 的翻译器应该认得 system:init')
})

test('[I6] Codex 的 createTranslator 产出真的是 Codex 翻译器——喂一行 Codex 的 thread.started 事件能产出 session.ready', () => {
  const t = getAdapter('codex')!.createTranslator()
  const evs = t.push(JSON.stringify({ type: 'thread.started', thread_id: 't1' }))
  assert.ok(evs.some((e) => e.k === 'session.ready'), 'Codex 的翻译器应该认得 thread.started')
})

test('[I6] 两个 adapter 的 createTranslator 互不认识对方的原生事件——不是共用同一个翻译器', () => {
  // Claude 的翻译器喂 Codex 的事件、反过来也一样，都不该产出 session.ready。
  // 这条锁住"没有静默拿到另一个 CLI 的翻译器"，比单独验证各自认得自己的事件更严格。
  const claudeT = getAdapter('claude')!.createTranslator()
  const codexEvs = claudeT.push(JSON.stringify({ type: 'thread.started', thread_id: 't1' }))
  assert.equal(codexEvs.length, 0, 'Claude 的翻译器不该认得 Codex 的 thread.started')

  const codexT = getAdapter('codex')!.createTranslator()
  const claudeEvs = codexT.push(
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'opus', cwd: '/x' })
  )
  assert.equal(claudeEvs.length, 0, 'Codex 的翻译器不该认得 Claude 的 system:init')
})

test('[I6] createTranslator 每次调用返回独立实例，不共享内部状态（节流/去重这类状态不能跨会话串）', () => {
  const a = getAdapter('claude')!.createTranslator()
  const b = getAdapter('claude')!.createTranslator()
  assert.notStrictEqual(a, b)
})

test('[I6] Claude 声明 approvalHook 为 "claude-pretooluse"；Codex 不声明（undefined）', () => {
  assert.equal(getAdapter('claude')!.approvalHook, 'claude-pretooluse')
  assert.equal(getAdapter('codex')!.approvalHook, undefined)
})

// ── 输出格式约定（2026-08-17）────────────────────────────────────
// 终端里跑 Claude Code 看不到 emoji，走 headless 这条路却会冒出来。
// 与其在渲染层事后替换（改模型说的话，而且 ✅/❌ 有时在表达成败），不如让它别输出。

test('Claude 把输出格式约定作为系统提示传下去（不是塞进用户消息）', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/x' })
  const i = args.indexOf('--append-system-prompt')
  assert.ok(i >= 0, '要用系统提示注入，别在用户消息后面加后缀')
  assert.equal(args[i + 1], OUTPUT_STYLE_PROMPT, '传下去的必须是那份共享规范本身')
})

test('输出格式约定里明确写着不要 emoji（这是它存在的首要理由）', () => {
  assert.ok(OUTPUT_STYLE_PROMPT.includes('emoji'))
})

test('Codex 不注入格式约定——它的 exec 没有系统提示开关，硬塞只能污染用户消息', () => {
  const { args } = getAdapter('codex')!.buildArgs({ cwd: '/x' })
  assert.ok(!args.includes('--append-system-prompt'))
  assert.ok(!args.some((a) => a.includes('emoji')), '不能把规范混进 Codex 的位置参数里')
})

// ── 会话内改参数的能力声明（2026-08-17）────────────────────────
// 用户要求：改模型/effort 要和 CLI 本身一致，用 /model、/effort 命令改。
// 实测确认 headless 下这两条命令真的生效（发完 CLI 会重推 init，model 是新值）。

test('Claude 声明 paramChange:"slash"——会话内改模型不必重启进程', () => {
  assert.equal(getAdapter('claude')!.paramChange, 'slash')
})

test('Codex 不声明 paramChange——exec 是一次性的，没有会话内命令', () => {
  assert.equal(getAdapter('codex')!.paramChange, undefined)
})

test('effort 取值与 `claude --help` 声明的一字不差（low, medium, high, xhigh, max）', () => {
  // help 原文：--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)
  // 这条锁的是「别自己发明一套」——列表跟 CLI 对不上时，用户选了个 CLI 不认的值，
  // 表现是命令静默无效，界面上却显示已经切过去了。
  const ids = (getAdapter('claude')!.capabilities.effortLevels ?? []).map((e) => e.id)
  assert.deepEqual(ids, ['low', 'medium', 'high', 'xhigh', 'max'])
})

// ── 伪无头审批（2026-08-17）────────────────────────────────
// 不装 hook、不阻塞进程，靠系统提示让模型先说打算。取舍见 ASK_FIRST_PROMPT。

test('askFirst 关着时系统提示只有输出格式约定', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/x' })
  const i = args.indexOf('--append-system-prompt')
  assert.equal(args[i + 1], OUTPUT_STYLE_PROMPT, '没开就不该塞进「先问再做」')
})

test('askFirst 开着时把「先问再做」拼进同一条系统提示', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/x', askFirst: true })
  const i = args.indexOf('--append-system-prompt')
  const v = args[i + 1]
  assert.ok(v.includes(OUTPUT_STYLE_PROMPT), '输出格式约定不能被挤掉')
  assert.ok(v.includes(ASK_FIRST_PROMPT), '缺了「先问再做」')
  // 拼一条而不是传两次 --append-system-prompt：那个 flag 传两次的行为没实测过
  assert.equal(args.filter((a) => a === '--append-system-prompt').length, 1)
})

test('「先问再做」明确豁免只读操作——不然查个文件都要问一遍，没法用', () => {
  assert.ok(ASK_FIRST_PROMPT.includes('只读'))
})

test('askFirst 不改动任何与 hook 相关的启动参数（两条路互不相干）', () => {
  const a = getAdapter('claude')!.buildArgs({ cwd: '/x', askFirst: true }).args
  const b = getAdapter('claude')!.buildArgs({ cwd: '/x' }).args
  assert.equal(a.length, b.length, '只该换掉系统提示的内容，不该多出参数')
})

// ── omp 接入时补的两条（2026-09-02）。**只新增，不改上面任何既有断言** ──────────

test('随包的 adapter 必须排在需要用户自己装的后面', () => {
  // 三条路都取「第一个可用的 CLI」（空态默认 / 手机端 / 团队派活），而随包的
  // `available` 恒真 —— 排前面就会把只登了 Claude 的老用户的默认选择换掉。
  // 判据是 `bundled` 能力位，不是 id：以后再来一个随包的 CLI 同样受这条约束。
  const ids = listAdapters().map((a) => a.id)
  const firstBundled = listAdapters().findIndex((a) => a.bundled === true)
  const lastPlain = listAdapters().map((a) => a.bundled === true).lastIndexOf(false)
  if (firstBundled === -1) return // 没有随包的就没什么要钉的
  assert.ok(
    firstBundled > lastPlain,
    `随包的 adapter 排到了前面：${ids.join(' → ')}（第 ${firstBundled} 个是随包的，而第 ${lastPlain} 个不是）`
  )
})

test('走独立传输的 adapter，buildArgs 不是它的启动依据——但也不许假装接了 mcpConfigPath', () => {
  // omp 的进程由 `omp/launch.ts` 组参数、`omp/transport.ts` 收发，`buildArgs()` 只为
  // 满足接口而存在。**这条断言锁的是语义不是实现**：MCP 配置不进它的 args，
  // 是因为 ACP 在 `session/new` 的握手里收 `mcpServers`，不是因为被丢掉了。
  // 没有这条，后人很容易把「不带」固化成「丢掉」，重演 Claude 那次
  // 「AI 对话窗口里一个 MCP 工具都没有」的回归。
  for (const a of listAdapters()) {
    if (!a.transport) continue
    const built = a.buildArgs({ cwd: '/w', mcpConfigPath: '/tmp/should-not-appear.json' })
    assert.ok(
      !built.args.some((x) => x.includes('should-not-appear')),
      `${a.id} 把 mcpConfigPath 塞进了命令行，而它声明走 ${a.transport} —— 两处会各带一份配置`
    )
  }
})

// ── 2026-09-03：角色契约要能注入 AI 对话会话 ────────────────────────────────
//
// 此前这 8 个角色只对终端里 ▶ 启动的 agent 生效（CanvasAgentBar 拼进启动命令），
// AI 对话会话完全不吃。用户：「转移到 AI 对话中的合适位置进行角色的注入这个 session」。

test('**角色契约拼进 --append-system-prompt**，和输出规范同一条 flag', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/p', roleContract: '你是工匠，只写代码。' })
  const i = args.indexOf('--append-system-prompt')
  assert.ok(i >= 0)
  const prompt = args[i + 1]
  assert.ok(prompt.includes('你是工匠，只写代码。'), '契约没进去')
  assert.ok(prompt.includes(OUTPUT_STYLE_PROMPT), '**输出规范不能被挤掉** —— 两者是并存的')
})

test('没有角色时，args 与今天逐字节相同（老路径一点不动）', () => {
  const withRole = getAdapter('claude')!.buildArgs({ cwd: '/p', roleContract: '   ' }).args
  const without = getAdapter('claude')!.buildArgs({ cwd: '/p' }).args
  // 全空白的契约等于没有 —— 拼进去只会在系统提示里留一段空行
  assert.deepEqual(withRole, without)
})

test('角色契约与「先问再做」能同时存在，三段都在', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/p', askFirst: true, roleContract: '契约正文' })
  const prompt = args[args.indexOf('--append-system-prompt') + 1]
  assert.ok(prompt.includes(OUTPUT_STYLE_PROMPT))
  assert.ok(prompt.includes(ASK_FIRST_PROMPT))
  assert.ok(prompt.includes('契约正文'))
})

test('**只传一次 --append-system-prompt** —— 传两次的行为没实测过', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/p', askFirst: true, roleContract: 'x' })
  assert.equal(args.filter((a) => a === '--append-system-prompt').length, 1)
})

test('Codex 的角色契约走 `-c instructions=`（它没有 --append-system-prompt）', () => {
  const { args } = getAdapter('codex')!.buildArgs({ cwd: '/p', roleContract: '你是验官，禁改代码。' })
  const i = args.findIndex((a) => a.startsWith('instructions='))
  assert.ok(i > 0, '没拼进去')
  assert.equal(args[i - 1], '-c')
  assert.ok(args[i].includes('你是验官，禁改代码。'))
})

test('**Codex 的契约要压成单行** —— 多行会把 -c 的取值解析弄乱', () => {
  const { args } = getAdapter('codex')!.buildArgs({ cwd: '/p', roleContract: '第一行\n\n  第二行' })
  const v = args.find((a) => a.startsWith('instructions=')) ?? ''
  assert.ok(!v.includes('\n'), '还有换行')
  assert.ok(v.includes('第一行 第二行'))
})

test('Codex 没角色时 args 与今天逐字节相同', () => {
  assert.deepEqual(
    getAdapter('codex')!.buildArgs({ cwd: '/p', roleContract: '  ' }).args,
    getAdapter('codex')!.buildArgs({ cwd: '/p' }).args
  )
})

// ── 2026-09-03 · D4：角色的工具边界 ─────────────────────────────────────────
//
// 这一块是图纸 01 红线 5 点名的东西（`roles.ts` 的 illustrator 用 tools.deny
// 通配符挡图像类 MCP）。把它接进对话会话 = 把一条现有的安全边界搬到新链路上，
// 所以断言写得比别处密。

test('Claude：caps 走 --disallowedTools，denyServers 展开成 mcp__<名>__*', () => {
  const { args } = getAdapter('claude')!.buildArgs({
    cwd: '/p',
    roleBounds: { caps: { shell: false, mcp: { denyServers: ['bizone-canvas'] } } }
  })
  const i = args.indexOf('--disallowedTools')
  assert.ok(i >= 0)
  const rest = args.slice(i + 1)
  assert.ok(rest.includes('Bash'))
  assert.ok(rest.includes('mcp__bizone-canvas__*'), 'server 名没展开成通配')
  assert.ok(!args.includes('--allowedTools'), 'allow 已删，不该再出现')
})

test('**变长参数必须排在最后** —— 夹在中间会把后面的选项一起吞掉', () => {
  const { args } = getAdapter('claude')!.buildArgs({
    cwd: '/p',
    model: 'opus',
    resumeId: 'r1',
    mcpConfigPath: '/tmp/m.json',
    roleBounds: { caps: { shell: false } }
  })
  const i = args.indexOf('--disallowedTools')
  const after = args.slice(i + 1)
  for (const flag of ['--model', '--resume', '--mcp-config']) {
    assert.ok(!after.includes(flag), `${flag} 排在变长参数后面，会被吞掉`)
  }
})

test('**能力边界在恢复会话时也要拼** —— 它是 CLI 强制规则，不是系统提示', () => {
  const { args } = getAdapter('claude')!.buildArgs({
    cwd: '/p',
    resumeId: 'r1',
    roleBounds: { caps: { mcp: { denyServers: ['bizone-canvas'] } } }
  })
  assert.ok(args.includes('--disallowedTools'))
  assert.ok(args.includes('mcp__bizone-canvas__*'))
})

test('Claude：write:false → Write Edit NotebookEdit 三个都进 deny', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/p', roleBounds: { caps: { write: false } } })
  const rest = args.slice(args.indexOf('--disallowedTools') + 1)
  assert.deepEqual(rest, ['Write', 'Edit', 'NotebookEdit'])
})

test('Claude：没有角色边界时，一个相关参数都不加', () => {
  const { args } = getAdapter('claude')!.buildArgs({ cwd: '/p', roleBounds: undefined })
  assert.ok(!args.includes('--disallowedTools'))
  assert.ok(!args.includes('--allowedTools'))
})

test('Codex：只能整个关 MCP server（它没有工具级开关）', () => {
  const { args } = getAdapter('codex')!.buildArgs({
    cwd: '/p',
    roleTools: { deny: ['Bash'], denyServers: ['bizone-canvas'] }
  })
  assert.ok(args.includes('mcp_servers.bizone-canvas.enabled=false'))
  // deny 的工具名在 Codex 上**无处可去**，不能假装接了
  assert.ok(!args.some((a) => a.includes('Bash')), 'Codex 没有工具级 deny，别硬塞')
})

// ── safeRoleTools：IPC 边界上的清洗。**它直接决定安全边界** ──────────────────

test('不是对象 → undefined（当没给）', () => {
  for (const v of [null, undefined, 'x', 42, ['a']]) assert.equal(safeRoleTools(v), undefined)
})

test('**数组里混进非字符串 → 那一条整个丢掉**，不做部分接受', () => {
  // 「过滤掉坏元素、留下好的」在安全边界上最危险：调用方以为限制生效了，
  // 实际上少了几条，而没有任何报错。
  assert.equal(safeRoleTools({ deny: ['Bash', 123] }), undefined)
  assert.deepEqual(safeRoleTools({ deny: ['Bash'], denyServers: [null] })?.denyServers, undefined)
})

test('正常形状原样通过', () => {
  const got = safeRoleTools({ deny: ['Bash'], denyServers: ['x'], allow: ['Read'] })
  assert.deepEqual(got, { allow: ['Read'], deny: ['Bash'], denyServers: ['x'] })
})

test('空数组等于没有那一条；三条都空 → undefined', () => {
  assert.equal(safeRoleTools({ deny: [], denyServers: [], allow: [] }), undefined)
})

// ── safeRoleBounds：v2 的 IPC 清洗，规矩与 safeRoleTools 相同 ──────────────────
test('safeRoleBounds：不是对象 → undefined', () => {
  for (const v of [null, undefined, 'x', 42, ['a']]) assert.equal(safeRoleBounds(v), undefined)
})

test('safeRoleBounds：caps 只认 false；混进非字符串的清单整条丢', () => {
  const got = safeRoleBounds({ caps: { write: false, shell: true, mcp: { denyServers: ['s', 1], denyTools: ['*x*'] } } })
  assert.deepEqual(got, { caps: { write: false, mcp: { denyTools: ['*x*'] } } })
})

test('safeRoleBounds：raw 按家收', () => {
  const got = safeRoleBounds({ raw: { claude: { deny: ['A'] }, codex: { disable: [] }, omp: { removeTools: ['bash'] } } })
  assert.deepEqual(got, { raw: { claude: { deny: ['A'] }, omp: { removeTools: ['bash'] } } })
})

test('safeRoleBounds：什么都没剩 → undefined', () => {
  assert.equal(safeRoleBounds({ caps: { write: true }, raw: {} }), undefined)
})
