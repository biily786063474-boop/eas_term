import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolbarModel, formatUsage, usesApprovalHookFile } from './toolbarModel.ts'
import type { CliCapabilities } from '../../../../shared/agentChat.ts'

const claudeLike: CliCapabilities = {
  models: [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }],
  effortLevels: [{ id: 'low', label: '低' }, { id: 'high', label: '高' }],
  compact: 'slash',
  contextUsage: true,
  approval: ['exec', 'patch', 'tool']
}

const codexLike: CliCapabilities = {
  models: [],
  effortLevels: [{ id: 'medium', label: '中' }],
  compact: false,
  contextUsage: true,
  approval: [],
  sandboxLevels: [
    { id: 'read-only', label: '只读' },
    { id: 'workspace-write', label: '可改工作区' }
  ]
}

// ============================================================
// 以下到分隔线为止，逐字来自 task-2-brief.md —— 不许改动断言内容。
// ============================================================

test('有 models 就显示模型选择', () => {
  assert.equal(toolbarModel(claudeLike).showModel, true)
  assert.equal(toolbarModel(codexLike).showModel, false, 'models 为空数组时不显示')
})

test('没有 effortLevels 就不渲染 effort 控件', () => {
  const noEffort: CliCapabilities = { ...claudeLike, effortLevels: undefined }
  assert.equal(toolbarModel(noEffort).showEffort, false)
  assert.equal(toolbarModel(claudeLike).showEffort, true)
})

test('compact 为 false 时不显示压缩按钮', () => {
  assert.equal(toolbarModel(claudeLike).showCompact, true)
  assert.equal(toolbarModel(codexLike).showCompact, false)
})

test('approval 为空 → 显示沙箱选择；非空 → 不显示', () => {
  // 判据是「能不能逐次审批」，不是「是不是某个 CLI」
  assert.equal(toolbarModel(codexLike).showSandbox, true)
  assert.deepEqual(toolbarModel(codexLike).sandboxLevels.map((s) => s.id), ['read-only', 'workspace-write'])
  assert.equal(toolbarModel(claudeLike).showSandbox, false)
})

test('approval 为空却没给 sandboxLevels → showSandbox 为 false，不显示空下拉', () => {
  const broken: CliCapabilities = { ...codexLike, sandboxLevels: undefined }
  assert.equal(toolbarModel(broken).showSandbox, false, '宁可不显示，也不要显示一个空选择器')
})

test('用量只显示 token 数与花费，绝不出现百分比', () => {
  // contextRatio 没有分母（turn.done 里没有窗口上限），A 层一律不填。
  // 显示一个看起来精确、实则猜的比例，比不显示更糟。
  const s = formatUsage({ inputTokens: 12, outputTokens: 345, cachedInputTokens: 6789 }, 0.0421)
  assert.ok(s.includes('345'))
  assert.ok(!s.includes('%'), '不允许出现百分号')
})

test('没有 usage 时给一个稳定的空串，不显示 undefined', () => {
  const s = formatUsage(null)
  assert.equal(s.includes('undefined'), false)
  assert.equal(s.includes('NaN'), false)
})

test('没有花费字段时不显示 $0', () => {
  // Codex 不报花费；显示「花了 $0」是错的信息
  const s = formatUsage({ inputTokens: 1, outputTokens: 2 })
  assert.ok(!s.includes('$0'), 'costUsd 缺失时不能显示成花了 0 元')
})

// ============================================================
// 以下是补充断言。题面给的用例只挑了部分字段/场景——比如四条 show* 的正向用例只查了
// 布尔值，从没断言过 models/effortLevels/sandboxLevels 三个数组的实际内容；showUsage
// 全程零覆盖；compact 的 'native' 分支和「整个未声明」分支都没人碰过；formatUsage 只
// 用 .includes() 做子串匹配，没有任何一条锁过完整字符串或分隔符顺序。这些空档意味着
// 一个把数组内容写死、或者把 undefined 与 false 混为一谈的实现，也能让题面测试全绿。
// ============================================================

test('[补充] models 数组内容原样带出，不是随手拼的固定值', () => {
  assert.deepEqual(toolbarModel(claudeLike).models, [
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' }
  ])
})

test('[补充] caps.models 整个字段缺失（不是空数组）时，showModel 为 false 且 models 是空数组', () => {
  const noModelsField: CliCapabilities = {
    effortLevels: [{ id: 'medium', label: '中' }],
    compact: 'native',
    contextUsage: true,
    approval: []
  }
  const m = toolbarModel(noModelsField)
  assert.equal(m.showModel, false)
  assert.deepEqual(m.models, [])
})

test('[补充] effortLevels 数组内容原样带出（claude 与 codex 两边分别核对）', () => {
  assert.deepEqual(toolbarModel(claudeLike).effortLevels, [
    { id: 'low', label: '低' },
    { id: 'high', label: '高' }
  ])
  assert.deepEqual(toolbarModel(codexLike).effortLevels, [{ id: 'medium', label: '中' }])
})

test('[补充] sandboxLevels 完整对象（含 label）原样带出，不只是题面查过的 id', () => {
  assert.deepEqual(toolbarModel(codexLike).sandboxLevels, [
    { id: 'read-only', label: '只读' },
    { id: 'workspace-write', label: '可改工作区' }
  ])
})

test('[补充] compact 为 native 时也显示压缩按钮，不是只认 slash 这一种取值', () => {
  const native: CliCapabilities = { ...claudeLike, compact: 'native' }
  assert.equal(toolbarModel(native).showCompact, true)
})

test('[补充] compact 字段整个未声明（undefined，不是显式 false）时不显示压缩按钮', () => {
  // Step 3 公式是 compact !== false && compact !== undefined——两个条件缺一个都不对。
  // claudeLike 给的是 'slash'，codexLike 给的是显式 false，两边都测不到「整个没声明」
  // 这一支；一个只写 `compact !== false`（漏掉 undefined 判断）的实现会在这里显示压缩
  // 按钮，但那是错的——没声明等于「这个 CLI 没告诉我们能不能压缩」，该当不显示处理。
  const noCompactField: CliCapabilities = {
    models: [],
    contextUsage: true,
    approval: []
  }
  assert.equal(toolbarModel(noCompactField).showCompact, false)
})

test('[补充] approval 非空时，即使给了 sandboxLevels 也不显示沙箱选择', () => {
  // 判据是「能不能逐次审批」——如果实现偷懒只看 sandboxLevels 存在与否、
  // 完全不管 approval，这条数据能戳穿它。
  const hasBoth: CliCapabilities = {
    models: [],
    contextUsage: true,
    approval: ['exec'],
    sandboxLevels: [{ id: 'read-only', label: '只读' }]
  }
  assert.equal(toolbarModel(hasBoth).showSandbox, false)
})

test('[补充] sandboxLevels 为显式空数组（不是 undefined）时同样不显示沙箱选择', () => {
  const emptySandbox: CliCapabilities = { ...codexLike, sandboxLevels: [] }
  assert.equal(toolbarModel(emptySandbox).showSandbox, false)
})

test('[补充] showUsage 跟随 contextUsage——题面测试从未断言过这个字段', () => {
  assert.equal(toolbarModel(claudeLike).showUsage, true)
  const noUsage: CliCapabilities = { ...claudeLike, contextUsage: false }
  assert.equal(toolbarModel(noUsage).showUsage, false)
})

test('[补充] formatUsage 完整字符串精确匹配 Step 3 给的示例格式，不只是子串命中', () => {
  // 题面只用 .includes('345') 验证，一个把字段顺序打乱、或用错分隔符的实现也能通过；
  // 这里锁死完整字符串，同时把 inputTokens(12) / cachedInputTokens(6789) 也纳入断言
  // ——题面从未检查过这两个数字真的出现在输出里。
  //
  // **例值从 0.0421 换成 1.2345**（2026-08-17 全分支最终评审 M1 点名的撞车）：
  // 原来这条锁 '$0.0421'、下面那条只用 includes('$0')，一个把花费硬编码成 '$0.0421'
  // 的实现能让两条同时绿——'$0.0421'.includes('$0') 为真，两道防线一起失效。
  // 换成不含 '$0' 前缀的值之后，硬编码任何一边都会打破另一边。
  const s = formatUsage({ inputTokens: 12, outputTokens: 345, cachedInputTokens: 6789 }, 1.2345)
  assert.equal(s, '输入 12 · 输出 345 · 缓存 6789 · $1.2345')
})

test('[补充] 没有 cachedInputTokens 时该分段整段省略，字符串精确匹配（不是显示 0 或 undefined）', () => {
  const s = formatUsage({ inputTokens: 1, outputTokens: 2 })
  assert.equal(s, '输入 1 · 输出 2')
})

test('[补充] costUsd 显式为 0（不是 undefined）时应显示，0 是真实数据，不是缺失', () => {
  // 与题面「没有花费字段时不显示 $0」互补：那条测的是「缺失」，这条测的是「明确为零」。
  // 如果实现把判据写成 `if (costUsd)`（真值判断）而不是 `costUsd !== undefined`，
  // 两条测试会互相矛盾——只有把「未定义」和「数值零」分开判断的实现能同时满足。
  // 判据从 includes('$0') 收紧成完整字符串（M1 撞车的另一半：子串匹配太松，
  // 上面那条锁的例值只要以 $0 开头就能同时蒙混过关）。
  const s = formatUsage({ inputTokens: 1, outputTokens: 2 }, 0)
  assert.equal(s, '输入 1 · 输出 2 · $0.0000')
})

test('[M1] 累计花费的浮点尾数不许原样印到常驻可见的用量行上', () => {
  // Claude 的 costUsd 取自 total_cost_usd（累计值），多轮相加必然出这种数。
  // 修复前直接 `${costUsd}`，界面上就是 $0.030700000000000002。
  const s = formatUsage({ inputTokens: 1, outputTokens: 2 }, 0.030700000000000002)
  assert.equal(s, '输入 1 · 输出 2 · $0.0307')
})

test('[M1] 花费固定 4 位小数——不会因为数值"正好很短"就变成另一种格式', () => {
  assert.equal(formatUsage({ inputTokens: 1, outputTokens: 2 }, 0.5), '输入 1 · 输出 2 · $0.5000')
})

test('[补充] inputTokens/outputTokens 为 0 时仍然显示 0，这两个必有字段不能被当成「缺失」省略', () => {
  const s = formatUsage({ inputTokens: 0, outputTokens: 0 })
  assert.equal(s, '输入 0 · 输出 0')
})

// ============================================================
// 2026-08-17 全分支最终评审 I2/I3：工具栏那个「审批保护 已开启/未开启」chip 与它旁边的
// 「卸载」按钮，判据必须是 CLI 自己声明的审批机制（approvalHook），不是 approval 非空
// 那个碰巧重合的替身，更不是 CLI 名字。
// ============================================================

test('[I2] 声明 claude-pretooluse 的 CLI 才显示审批 hook chip', () => {
  assert.equal(toolbarModel(claudeLike, 'claude-pretooluse').showApprovalHook, true)
})

test('[I2] 没声明审批机制的 CLI 不显示 chip——那个 chip 读的是 Claude 的 settings.json，对它是错的信息', () => {
  // Codex 走 exec --json、approval 是空数组、根本没有逐次审批，权限完全由沙箱决定。
  // chip 在它身上显示「已开启」时，工具栏另一侧同时还在显示沙箱级别，两条信息互相矛盾；
  // 那个「卸载」点下去删的还是 Claude 的 hook。
  assert.equal(toolbarModel(codexLike, undefined).showApprovalHook, false)
})

test('[I3] approval 非空但不走这套 hook 机制的 CLI（第三个 CLI 的形状）同样不显示 chip', () => {
  // 判据如果还是 approval.length>0，这条会错判成 true——这正是 I3 描述的分叉点。
  const thirdCli: CliCapabilities = { models: [], contextUsage: true, approval: ['exec'], compact: 'native' }
  assert.equal(toolbarModel(thirdCli, undefined).showApprovalHook, false)
  assert.equal(thirdCli.approval.length > 0, true, '数据本身确实是 approval 非空——判据变了，不是数据变了')
})

test('[I2] 不传 approvalHook 时按"没声明"处理（宁可不显示，也不要显示一个与这个 CLI 无关的开关）', () => {
  assert.equal(toolbarModel(claudeLike).showApprovalHook, false)
})

test('[I2/I3] usesApprovalHookFile 是三处判据共用的唯一函数，只认 claude-pretooluse 这一个取值', () => {
  assert.equal(usesApprovalHookFile('claude-pretooluse'), true)
  assert.equal(usesApprovalHookFile(undefined), false)
  // 将来出现别的审批机制取值时，默认不该被当成"要装 Claude 那份 hook"
  assert.equal(usesApprovalHookFile('codex-app-server' as never), false)
})

test('[补充] 两份能力声明互不干扰——claudeLike 和 codexLike 交替调用不会互相污染结果', () => {
  // toolbarModel 是纯函数，不应该有跨调用的隐藏状态。
  const first = toolbarModel(claudeLike)
  const second = toolbarModel(codexLike)
  const firstAgain = toolbarModel(claudeLike)
  assert.deepEqual(first, firstAgain)
  assert.notEqual(first.showSandbox, second.showSandbox)
})
