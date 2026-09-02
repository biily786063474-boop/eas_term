import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nextOmpSnapshot, ompAccountKeyOf, ompQuotaFromUsageJson } from './ompQuota.ts'
import type { CliQuota } from './quota.ts'

const NOW = 1_788_000_000_000
/** omp 的 `window.resetsAt` 是**毫秒**，我们的 `QuotaWindow.resetsAt` 是**秒** */
const RESET_MS = 1_788_300_000_000

interface LimitOpts {
  id: string
  durationMs?: number
  resetsAt?: number
  usedFraction?: number
  used?: number
  limit?: number
  remainingFraction?: number
  unit?: string
  status?: string
  tier?: string
  shared?: boolean
}

const limit = (o: LimitOpts): Record<string, unknown> => ({
  id: o.id,
  label: o.id,
  scope: { ...(o.tier ? { tier: o.tier } : {}), ...(o.shared ? { shared: true } : {}) },
  ...(o.durationMs === undefined ? {} : { window: { durationMs: o.durationMs, resetsAt: o.resetsAt ?? RESET_MS } }),
  amount: {
    ...(o.used === undefined ? {} : { used: o.used }),
    ...(o.limit === undefined ? {} : { limit: o.limit }),
    ...(o.usedFraction === undefined ? {} : { usedFraction: o.usedFraction }),
    ...(o.remainingFraction === undefined ? {} : { remainingFraction: o.remainingFraction }),
    unit: o.unit ?? 'token'
  },
  ...(o.status ? { status: o.status } : {})
})

const HOUR = 3_600_000
const WEEK = 7 * 24 * HOUR

const payload = (provider: string, limits: Record<string, unknown>[], metadata?: unknown): unknown => ({
  generatedAt: NOW,
  reports: [{ provider, fetchedAt: NOW, limits, ...(metadata ? { metadata } : {}) }]
})

// ── 没数就是没数 ───────────────────────────────────────────────────────────

test('reports 为空 → null（**不写 0%**）', () => {
  // 一个永远显示 0% 的格子比空着更糟：它看起来像真数据。
  // API key 模式下 `omp usage --json` 的常态就是空数组、退出码 0。
  assert.equal(ompQuotaFromUsageJson({ reports: [] }, 'zai', NOW), null)
})

test('喂什么垃圾都回 null，不抛', () => {
  for (const bad of [null, undefined, 0, '', [], {}, { reports: 'x' }]) {
    assert.equal(ompQuotaFromUsageJson(bad, 'zai', NOW), null)
  }
})

test('要的那个 provider 没有 report → null，**不退化到别的 provider**', () => {
  // 用户同时配了两家很常见（一家订阅一家 API key）。额度条只有一个位置，
  // 显示的是「哪个账号的额度」必须确定，不能随 reports 的顺序变。
  const p = payload('anthropic', [limit({ id: 'anthropic:5h', durationMs: 5 * HOUR, usedFraction: 0.4 })])
  assert.equal(ompQuotaFromUsageJson(p, 'openai-codex', NOW), null)
})

// ── Anthropic：同一份 report 里有好几条并列的周额度 ─────────────────────────

test('**按 tier 分的子额度不许上条** —— 否则「本周 X%」可能是 Opus 的那份', () => {
  // 上游一次 push 四条以上、durationMs 全是 WEEK：账号级的 7d，
  // 外加 7d:opus / 7d:sonnet 这些按模型族分的。按「窗口最长」挑是并列的，
  // 谁上条取决于数组顺序。本仓库 2026-08-22 已经在 Claude 那侧踩过同一个坑。
  const p = payload('anthropic', [
    limit({ id: 'anthropic:5h', durationMs: 5 * HOUR, usedFraction: 0.4, shared: true }),
    limit({ id: 'anthropic:7d:opus', durationMs: WEEK, usedFraction: 0.95, tier: 'opus' }),
    limit({ id: 'anthropic:7d', durationMs: WEEK, usedFraction: 0.2, shared: true }),
    limit({ id: 'anthropic:7d:sonnet', durationMs: WEEK, usedFraction: 0.88, tier: 'sonnet' })
  ])
  const q = ompQuotaFromUsageJson(p, 'anthropic', NOW)
  assert.ok(q)
  assert.equal(q.primary?.percent, 40)
  assert.equal(q.secondary?.percent, 20, 'secondary 必须是账号级那条 7d，不是 opus 的 95%')
})

test('**没有 window 的那条不许上条**（anthropic:extra 是美元超支额度，不是百分比）', () => {
  const p = payload('anthropic', [
    limit({ id: 'anthropic:extra', usedFraction: 0.99, unit: 'usd' }),
    limit({ id: 'anthropic:5h', durationMs: 5 * HOUR, usedFraction: 0.1, shared: true })
  ])
  const q = ompQuotaFromUsageJson(p, 'anthropic', NOW)
  assert.ok(q)
  assert.equal(q.primary?.percent, 10)
  assert.equal(q.secondary, undefined, '只有一条合格就只填一格，不拿不合格的去凑')
})

// ── 单位 ──────────────────────────────────────────────────────────────────

test('**resetsAt 要从毫秒换成秒** —— 不换的话这一格永远不过期', () => {
  // `isWindowExpired` 是 `resetsAt * 1000 < now`。喂毫秒进去等于再乘一次 1000，
  // 显示出来的重置时间在几万天以后。
  const p = payload('anthropic', [limit({ id: 'a', durationMs: 5 * HOUR, resetsAt: RESET_MS, usedFraction: 0.5 })])
  const q = ompQuotaFromUsageJson(p, 'anthropic', NOW)
  assert.equal(q?.primary?.resetsAt, Math.floor(RESET_MS / 1000))
})

test('windowMinutes 由 durationMs 换算', () => {
  const p = payload('anthropic', [limit({ id: 'a', durationMs: 5 * HOUR, usedFraction: 0.5 })])
  assert.equal(ompQuotaFromUsageJson(p, 'anthropic', NOW)?.primary?.windowMinutes, 300)
})

// ── 用量比例的四级优先 ────────────────────────────────────────────────────

test('显式 usedFraction 优先', () => {
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR, usedFraction: 0.42, used: 1, limit: 100 })])
  assert.equal(ompQuotaFromUsageJson(p, 'x', NOW)?.primary?.percent, 42)
})

test('没有 usedFraction 就用 used/limit —— 自定义 provider 常只填这两个', () => {
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR, used: 30, limit: 60 })])
  assert.equal(ompQuotaFromUsageJson(p, 'x', NOW)?.primary?.percent, 50)
})

test('unit 是 percent 时 used 本身就是百分数', () => {
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR, used: 73, unit: 'percent' })])
  assert.equal(ompQuotaFromUsageJson(p, 'x', NOW)?.primary?.percent, 73)
})

test('都没有就用 1 - remainingFraction', () => {
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR, remainingFraction: 0.25 })])
  assert.equal(ompQuotaFromUsageJson(p, 'x', NOW)?.primary?.percent, 75)
})

test('四样都没有 → 这一条不算数（**不猜一个百分比**）', () => {
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR })])
  assert.equal(ompQuotaFromUsageJson(p, 'x', NOW), null)
})

// ── 告警判定 ──────────────────────────────────────────────────────────────

test("status 'ok' 要映射成 'normal' —— **原样写进去会让每一格都标红**", () => {
  // `isHot` 是 `severity !== 'normal'`。omp 的正常值是 'ok'，不是我们的 'normal'。
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR, usedFraction: 0.1, status: 'ok' })])
  assert.equal(ompQuotaFromUsageJson(p, 'x', NOW)?.primary?.severity, 'normal')
})

test('warning / exhausted 原样透传（provider 自己判的比我们的阈值准）', () => {
  for (const st of ['warning', 'exhausted']) {
    const p = payload('x', [limit({ id: 'a', durationMs: HOUR, usedFraction: 0.5, status: st })])
    assert.equal(ompQuotaFromUsageJson(p, 'x', NOW)?.primary?.severity, st)
  }
})

test("status 缺失或 'unknown' → 不写 severity，回退百分比阈值", () => {
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR, usedFraction: 0.5, status: 'unknown' })])
  assert.equal(ompQuotaFromUsageJson(p, 'x', NOW)?.primary?.severity, undefined)
})

// ── 其余字段 ──────────────────────────────────────────────────────────────

test('src 是 omp，采样时刻用传进来的 now', () => {
  const p = payload('x', [limit({ id: 'a', durationMs: HOUR, usedFraction: 0.5 })])
  const q = ompQuotaFromUsageJson(p, 'x', NOW)
  assert.equal(q?.primary?.src, 'omp')
  assert.equal(q?.primary?.at, NOW)
  assert.equal(q?.updatedAt, NOW)
})

test('段名带上 provider —— 额度条上要分得清这是谁的额度', () => {
  const p = payload('anthropic', [limit({ id: 'a', durationMs: HOUR, usedFraction: 0.5 })])
  assert.equal(ompQuotaFromUsageJson(p, 'anthropic', NOW)?.label, 'omp · anthropic')
})

test('短窗口上 primary、长窗口上 secondary', () => {
  const p = payload('x', [
    limit({ id: 'long', durationMs: WEEK, usedFraction: 0.2 }),
    limit({ id: 'short', durationMs: HOUR, usedFraction: 0.8 })
  ])
  const q = ompQuotaFromUsageJson(p, 'x', NOW)
  assert.equal(q?.primary?.percent, 80)
  assert.equal(q?.secondary?.percent, 20)
})

// ── 落盘取舍：换账号要丢掉旧数据、同值不广播 ───────────────────────────────

const q = (percent: number, at = NOW): CliQuota => ({
  primary: { percent, at, src: 'omp' },
  updatedAt: at,
  label: 'omp · x'
})

test('账号 key 从 metadata 取，**不含明文邮箱**', () => {
  // 这份东西会落盘。metadata 里带 email / accountId / orgId，
  // 原样存等于把账号身份写进用户磁盘上的一个普通 JSON。
  const key = ompAccountKeyOf({ reports: [{ provider: 'x', metadata: { accountId: 'acc-1', email: 'a@b.c' } }] }, 'x')
  assert.ok(key)
  assert.ok(!key.includes('a@b.c'), '邮箱不许出现在 key 里')
  assert.ok(!key.includes('acc-1'), '账号 id 也不许原样出现')
})

test('同一个账号算出同一个 key，换了账号就变', () => {
  const p = (id: string): unknown => ({ reports: [{ provider: 'x', metadata: { accountId: id } }] })
  assert.equal(ompAccountKeyOf(p('a'), 'x'), ompAccountKeyOf(p('a'), 'x'))
  assert.notEqual(ompAccountKeyOf(p('a'), 'x'), ompAccountKeyOf(p('b'), 'x'))
})

test('metadata 里什么都没有 → key 为 undefined（不比对，宁可不比）', () => {
  assert.equal(ompAccountKeyOf({ reports: [{ provider: 'x' }] }, 'x'), undefined)
})

test('**换了账号：旧数据整个丢掉**，不能拿别人的额度接着显示', () => {
  const prev = { omp: q(90), ompAccountKey: 'k-old' }
  const next = nextOmpSnapshot(prev, q(3), 'k-new')
  assert.ok(next)
  assert.equal(next.omp?.primary?.percent, 3)
  assert.equal(next.ompAccountKey, 'k-new')
})

test('同一个账号、数字变了 → 更新', () => {
  const next = nextOmpSnapshot({ omp: q(10), ompAccountKey: 'k' }, q(20), 'k')
  assert.equal(next?.omp?.primary?.percent, 20)
})

test('**同一个账号、数字与重置时刻都没变 → 返回 null（不广播）**', () => {
  // 每轮对话跑完都会来一次。值没变还广播的话，界面上的「上次更新于」会每次都跳，
  // 而它其实什么都没变。
  const same = q(10)
  assert.equal(nextOmpSnapshot({ omp: same, ompAccountKey: 'k' }, q(10, NOW + 5000), 'k'), null)
})

test('新数据为 null（读失败 / reports 空）→ 返回 null，**保住旧值不清空**', () => {
  // 网络抖一下就把额度条清掉，比显示一个稍旧的数字糟。
  assert.equal(nextOmpSnapshot({ omp: q(10), ompAccountKey: 'k' }, null, 'k'), null)
})

test('第一次拿到数据（之前是空的）→ 写进去', () => {
  const next = nextOmpSnapshot({}, q(42), 'k')
  assert.equal(next?.omp?.primary?.percent, 42)
  assert.equal(next?.ompAccountKey, 'k')
})
