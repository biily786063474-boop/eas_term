import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCliList } from './cliList.ts'
import type { CliAdapter } from '../../shared/agentChat.ts'

const fake = (
  id: string,
  displayName: string,
  over: Partial<CliAdapter['capabilities']> = {},
  approvalHook?: CliAdapter['approvalHook']
) =>
  ({
    id,
    displayName,
    capabilities: {
      models: [{ id: 'm1', label: 'M1' }],
      effortLevels: [{ id: 'low', label: '低' }],
      compact: 'slash' as const,
      contextUsage: true,
      approval: ['exec' as const],
      ...over
    },
    ...(approvalHook ? { approvalHook } : {})
  }) as unknown as CliAdapter

// ============================================================
// 以下到分隔线为止，逐字来自 task-0-brief.md —— 不许改动断言内容。
// ============================================================

test('把 adapter 与探测结果合成 CliInfo', () => {
  const list = buildCliList([fake('claude', 'Claude Code'), fake('codex', 'Codex')], { claude: true, codex: false })
  assert.equal(list.length, 2)
  assert.equal(list[0].id, 'claude')
  assert.equal(list[0].available, true)
  assert.equal(list[1].available, false)
})

test('capabilities 原样带出，UI 才能据此渲染控件', () => {
  const list = buildCliList([fake('codex', 'Codex', { approval: [], sandboxLevels: [{ id: 'ro', label: '只读' }] })], { codex: true })
  assert.deepEqual(list[0].capabilities.approval, [])
  assert.equal(list[0].capabilities.sandboxLevels?.length, 1)
})

test('探测结果缺失时当作不可用，不是当作可用', () => {
  // 宁可少显示一个选项，也不要让用户选一个装不上的 CLI 然后报错
  const list = buildCliList([fake('gemini', 'Gemini')], {})
  assert.equal(list[0].available, false)
})

test('displayName 原样带出，不做任何加工', () => {
  const list = buildCliList([fake('claude', 'Claude Code')], { claude: true })
  assert.equal(list[0].displayName, 'Claude Code')
})

test('空注册表返回空数组，不抛', () => {
  assert.deepEqual(buildCliList([], {}), [])
})

// ============================================================
// 以下是补充断言：题面测试只挑了部分字段——list[0].id 断言了但 list[1].id 没人查；
// capabilities 只验证过 approval/sandboxLevels 两个子字段，models/effortLevels/
// compact/contextUsage 没被单独锁过；available 的精确判据"=== true"没人用非布尔
// 真值验证过。按纪律逐个字段自问「改成一个固定错值，题面测试会不会失败」——
// 不会的，在这里补上（做法沿用 adapters/adapters.test.ts 已有的补充断言惯例）。
// ============================================================

test('[补充] 第二个 adapter 的 id 也要原样带出（题面只断言了 list[0].id）', () => {
  const list = buildCliList([fake('claude', 'Claude Code'), fake('codex', 'Codex')], { claude: true, codex: false })
  assert.equal(list[1].id, 'codex')
})

test('[补充] capabilities 是整个对象原样透传，不是挑字段重新拼装（models/effortLevels/compact/contextUsage 没被题面单独断言过）', () => {
  const list = buildCliList([fake('claude', 'Claude Code')], { claude: true })
  assert.deepEqual(list[0].capabilities, {
    models: [{ id: 'm1', label: 'M1' }],
    effortLevels: [{ id: 'low', label: '低' }],
    compact: 'slash',
    contextUsage: true,
    approval: ['exec']
  })
})

test('[补充] capabilities 与源 adapter 是同一个引用，不是重新拷贝出的副本（对齐 adapters.test.ts 里 getAdapter/listAdapters 同一惯例）', () => {
  const a = fake('claude', 'Claude Code')
  const list = buildCliList([a], { claude: true })
  assert.strictEqual(list[0].capabilities, a.capabilities)
})

test('[补充] available 的判据精确是 "=== true"——非布尔的真值不能蒙混过关（防止实现偷懒写成 Boolean(v) 或 !!v）', () => {
  const list = buildCliList([fake('claude', 'Claude Code')], { claude: 1 as unknown as boolean })
  assert.equal(list[0].available, false)
})

test('[补充] available 显式为 false（不是缺失键）时同样是不可用，两种情况结果一致', () => {
  const list = buildCliList([fake('claude', 'Claude Code')], { claude: false })
  assert.equal(list[0].available, false)
})

test('[补充] 三个 adapter 时，id 与 available 逐一对应，不会整体错位或调换', () => {
  const list = buildCliList(
    [fake('claude', 'Claude Code'), fake('codex', 'Codex'), fake('gemini', 'Gemini')],
    { codex: true, gemini: true }
  )
  assert.deepEqual(
    list.map((c) => [c.id, c.available]),
    [
      ['claude', false],
      ['codex', true],
      ['gemini', true]
    ]
  )
})

test('[补充] 空 adapters 但 availability 里有多余的 key，不影响结果仍是空数组（不会凭空造出条目）', () => {
  assert.deepEqual(buildCliList([], { claude: true, codex: true }), [])
})

// ============================================================
// 2026-08-17 全分支最终评审 I2/I3：approvalHook 必须跨 IPC 带给渲染层——它是 UI 判断
// 「审批那一块该不该出现」唯一正确的依据，跟 capabilities.approval 不是一回事。
// ============================================================

test('[I2/I3] adapter 声明的 approvalHook 原样带出——渲染层的询问卡片/chip/卸载按钮全靠它', () => {
  const list = buildCliList([fake('claude', 'Claude Code', {}, 'claude-pretooluse')], { claude: true })
  assert.equal(list[0].approvalHook, 'claude-pretooluse')
})

test('[I2/I3] 没声明 approvalHook 的 adapter 带出 undefined，不是编造一个值', () => {
  const list = buildCliList([fake('codex', 'Codex', { approval: [] })], { codex: true })
  assert.equal(list[0].approvalHook, undefined)
})

test('[I2/I3] approvalHook 与 capabilities.approval 各走各的——approval 非空不代表用那份 hook 文件', () => {
  // 这正是 I3 说的"第三个 CLI 一接进来就分叉"的形状：有细粒度审批能力（approval 非空），
  // 但审批握手走自己的协议、不装 Claude 那份 PreToolUse hook。渲染层若继续拿
  // approval.length>0 当替身，就会对它弹一张"要不要装审批钩子"的卡片，而主进程
  // 那个分支对它从不进入——用户以为自己拒绝了什么，实际什么都没发生。
  const list = buildCliList([fake('futurecli', 'Future CLI', { approval: ['exec'] })], { futurecli: true })
  assert.deepEqual(list[0].capabilities.approval, ['exec'])
  assert.equal(list[0].approvalHook, undefined, 'approval 非空不能被推断成"要装 hook"')
})

// ── 「没装的也要显示」这一组（2026-08-18 用户提的：第一次打开软件时一个 CLI 都没装，
//     那时候最需要看见有哪些可选。原来渲染层把没装的过滤掉了，只剩一句干巴巴的提示）──

test('没装的 CLI 照样在列表里，用 available 标出来而不是删掉', () => {
  const out = buildCliList([fake('claude', 'Claude Code'), fake('codex', 'Codex')], { claude: false, codex: false })
  assert.equal(out.length, 2, '一个都没装时列表不能是空的')
  assert.deepEqual(out.map((c) => c.available), [false, false])
})

test('没装的带上安装命令，已装的不带 —— 免得界面上「已经装了还劝你装」', () => {
  const out = buildCliList(
    [fake('claude', 'Claude Code'), fake('codex', 'Codex')],
    { claude: true, codex: false },
    { claude: 'brew install claude', codex: 'npm i -g @openai/codex' }
  )
  assert.equal(out[0].installCmd, undefined, '已装的不该给安装命令')
  assert.equal(out[1].installCmd, 'npm i -g @openai/codex')
})

// available=false 是「装上就能用」，chatSupported=false 是「装了也不能用在这儿」。
// 混成一个布尔的话，用户会照着提示去装一个装了也选不了的东西。
test('仅终端可用的 CLI：chatSupported=false，但仍然出现在列表里', () => {
  const out = buildCliList([fake('claude', 'Claude Code')], { claude: true, 'term-only-cli': true }, {}, [
    { id: 'term-only-cli', displayName: '某个仅终端 CLI', scopeNote: '只能在终端里用', installCmd: 'npm i -g x' }
  ])
  assert.equal(out.length, 2)
  const t = out[1]
  assert.equal(t.available, true, '装了就是装了')
  assert.equal(t.chatSupported, false, '但不能用于会话')
  assert.equal(t.scopeNote, '只能在终端里用')
  assert.equal(t.installCmd, undefined, '已装的不给安装命令')
})

test('有 adapter 的排在前面，仅终端的排后面', () => {
  const out = buildCliList([fake('claude', 'Claude Code')], {}, {}, [
    { id: 'term-only-cli', displayName: '某个仅终端 CLI', scopeNote: 'x', installCmd: 'y' }
  ])
  assert.deepEqual(out.map((c) => c.id), ['claude', 'term-only-cli'])
})

// 不能用于会话 → 不该为它渲染任何模型/强度/审批控件
test('仅终端的 CLI 能力一律为空', () => {
  const out = buildCliList([], {}, {}, [{ id: 'term-only-cli', displayName: 'D', scopeNote: 'x', installCmd: 'y' }])
  const c = out[0].capabilities
  assert.deepEqual(c.models, [])
  assert.deepEqual(c.effortLevels, [])
  assert.deepEqual(c.approval, [])
  assert.equal(c.compact, false)
  assert.equal(c.contextUsage, false)
  assert.equal(out[0].approvalHook, undefined)
})

test('有 adapter 的 chatSupported 恒为 true', () => {
  const out = buildCliList([fake('claude', 'Claude Code')], { claude: false })
  assert.equal(out[0].chatSupported, true, '没装不代表不支持 —— 那是 available 管的事')
})
