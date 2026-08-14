import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listAdapters, getAdapter } from './index.ts'

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
    '--include-hook-events',
    '--include-partial-messages'
  ]) {
    assert.ok(args.includes(need), `启动参数缺 ${need}`)
  }
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
