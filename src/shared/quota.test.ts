import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codexQuotaFromLine,
  claudeQuotaFromStatusline,
  clampPercent,
  windowLabel,
  agoLabel,
  claudeQuotaWindowFromEvent,
  shouldReplaceWindow,
  isWindowExpired,
  claudeQuotaFromUsageApi,
  isoToUnixSeconds,
  isHot,
  HOT_FALLBACK_PERCENT,
  type QuotaWindow
} from './quota.ts'

const NOW = 1_700_000_000_000

// 真实样本（2026-08-21 从 ~/.codex/sessions 里取的一行，删掉了无关字段）
const REAL = JSON.stringify({
  timestamp: '2026-08-14T19:19:28.063Z',
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: { total_tokens: 12172 }, model_context_window: 258400 },
    rate_limits: {
      primary: { used_percent: 1.0, window_minutes: 43200, resets_at: 1789322408 },
      secondary: null,
      plan_type: 'free'
    }
  }
})

test('从真实的 token_count 行里抽出额度', () => {
  const q = codexQuotaFromLine(REAL, NOW)
  assert.ok(q)
  assert.equal(q.primary?.percent, 1)
  assert.equal(q.primary?.windowMinutes, 43200)
  assert.equal(q.primary?.resetsAt, 1789322408)
  assert.equal(q.secondary, undefined, 'free 计划没有第二个窗口')
  assert.equal(q.planType, 'free')
})

test('不是 token_count 的行一律 null', () => {
  assert.equal(codexQuotaFromLine(JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } }), NOW), null)
  assert.equal(codexQuotaFromLine('{"type":"response_item"}', NOW), null)
})

test('坏行不抛 —— 这是别人的私有日志格式，随时可能变', () => {
  assert.equal(codexQuotaFromLine('不是 json', NOW), null)
  assert.equal(codexQuotaFromLine('', NOW), null)
  assert.equal(codexQuotaFromLine('{"payload":{"type":"token_count"}}', NOW), null, '没有 rate_limits')
  assert.equal(
    codexQuotaFromLine('{"payload":{"type":"token_count","rate_limits":{"primary":{}}}}', NOW),
    null,
    '有 rate_limits 但没有百分比 —— 不能编一个 0 出来'
  )
})

test('百分比钳制到 0–100，不猜单位', () => {
  assert.equal(clampPercent(1.0), 1)
  assert.equal(clampPercent(68.4), 68)
  assert.equal(clampPercent(-5), 0)
  assert.equal(clampPercent(150), 100)
  assert.equal(clampPercent('68'), undefined, '字符串不认')
  assert.equal(clampPercent(NaN), undefined)
})

test('窗口长度说人话', () => {
  assert.equal(windowLabel(300), '5 小时')
  assert.equal(windowLabel(10080), '本周')
  assert.equal(windowLabel(43200), '30 天')
  assert.equal(windowLabel(60), '60 分钟')
  assert.equal(windowLabel(undefined), '当前窗口')
})

// ── Claude 侧：statusline 转发脚本回传的那份 JSON ──────────────────────────
// **转发脚本发的是驼峰**（resources/agent-hooks/eas-statusline.mjs 里
// `payload = { contextWindow: j.context_window, rateLimits: j.rate_limits }`），
// 不是 Claude Code 原始 statusline JSON 的 snake_case。2026-08-22 的事故正出在这：
// 读取端按原始 JSON 的 `rate_limits` 取，取不到就静默 return —— HTTP 照回 ok:true，
// 数据无声丢弃，额度条上 Claude 那半永远空着，而 Codex 那半（走会话日志、
// 不经这条通道）一切正常，于是表现成「只有 Codex 有数据」。
const STATUSLINE = {
  contextWindow: { used_percentage: 37 },
  rateLimits: {
    five_hour: { used_percentage: 33, resets_at: 1789322408 },
    seven_day: { used_percentage: 66 }
  }
}

test('从 statusline 回传里抽出 Claude 额度（转发脚本发的驼峰字段）', () => {
  const q = claudeQuotaFromStatusline(STATUSLINE, NOW)
  assert.ok(q, '驼峰 rateLimits 必须能解析——转发脚本发过来的就是这个形状')
  assert.equal(q.primary?.percent, 33)
  assert.equal(q.primary?.windowMinutes, 300, '五小时窗口')
  assert.equal(q.primary?.resetsAt, 1789322408)
  assert.equal(q.secondary?.percent, 66)
  assert.equal(q.secondary?.windowMinutes, 10080, '七天窗口')
  assert.equal(q.updatedAt, NOW)
})

test('也认原始 statusline 的 snake_case（有人直接把原 JSON 发过来时）', () => {
  const q = claudeQuotaFromStatusline({ rate_limits: { five_hour: { used_percentage: 12 } } }, NOW)
  assert.equal(q?.primary?.percent, 12)
  assert.equal(q?.secondary, undefined)
})

test('没有可用的额度字段就返回 null', () => {
  assert.equal(claudeQuotaFromStatusline({ contextWindow: { used_percentage: 37 } }, NOW), null)
  assert.equal(claudeQuotaFromStatusline(null, NOW), null)
  assert.equal(claudeQuotaFromStatusline({ rateLimits: { five_hour: {} } }, NOW), null,
    '有窗口对象但没有百分比，等于没数据')
})

test('新鲜度说人话', () => {
  assert.equal(agoLabel(NOW, NOW), '刚刚')
  assert.equal(agoLabel(NOW - 30_000, NOW), '刚刚')
  assert.equal(agoLabel(NOW - 5 * 60_000, NOW), '5 分钟前')
  assert.equal(agoLabel(NOW - 3 * 3_600_000, NOW), '3 小时前')
  assert.equal(agoLabel(NOW - 2 * 86_400_000, NOW), '2 天前')
  // 机器时钟回拨过、或两台机器的时间对不齐时，别显示出「-3 分钟前」这种东西
  assert.equal(agoLabel(NOW + 9_000, NOW), '刚刚', '时间戳在未来也不该出现负数')
})

// ── headless 的 rate_limit_event：只用 AI 对话的人唯一的额度来源 ──────────
test('七天窗口带 utilization → 换算成百分比', () => {
  const r = claudeQuotaWindowFromEvent('seven_day', 0.79, 1786852800, NOW)
  assert.equal(r?.slot, 'secondary')
  assert.equal(r?.w.percent, 79, 'utilization 是 0~1，statusline 是 0~100，口径要换算')
  assert.equal(r?.w.windowMinutes, 10080)
  assert.equal(r?.w.resetsAt, 1786852800)
})

test('五小时窗口实测不带 utilization → 拿不到百分比就返回 null', () => {
  assert.equal(claudeQuotaWindowFromEvent('five_hour', undefined, 1786996800, NOW), null,
    '没带就是没带，不许拿 status 倒推一个数出来')
})

test('五小时窗口若哪天开始报用量，也要能收', () => {
  const r = claudeQuotaWindowFromEvent('five_hour', 0.42, undefined, NOW)
  assert.equal(r?.slot, 'primary')
  assert.equal(r?.w.percent, 42)
  assert.equal(r?.w.windowMinutes, 300)
  assert.equal(r?.w.resetsAt, undefined)
})

test('weekly 是 seven_day 的另一种叫法', () => {
  assert.equal(claudeQuotaWindowFromEvent('weekly', 0.5, undefined, NOW)?.slot, 'secondary')
})

test('不认识的窗口名一律不猜', () => {
  assert.equal(claudeQuotaWindowFromEvent('some_future_window', 0.5, 1, NOW), null,
    '猜错会把用量记到别的窗口上，比不显示更糟')
  assert.equal(claudeQuotaWindowFromEvent('', 0.5, 1, NOW), null)
})

// ── 两条来源并存时谁说了算 ────────────────────────────────────────────────
// 2026-08-22 对抗性审查实测出来的两个真 bug 就守在这里：
//   · statusline 只带一个窗口时把另一格抹掉（它的 payload 是条件展开的）
//   · 两条来源对同一格差 1（statusline 79 / 事件流 0.796×100→80），谁后到谁赢 → 无限横跳
const STALE = 10 * 60_000
const W = (percent: number, src: QuotaWindow['src'], at: number, resetsAt?: number): QuotaWindow => ({
  percent,
  at,
  src,
  ...(resetsAt !== undefined ? { resetsAt } : {})
})

test('没有旧值时，谁都能写进去', () => {
  assert.equal(shouldReplaceWindow(undefined, W(80, 'event', 100), STALE), true)
  assert.equal(shouldReplaceWindow(undefined, W(79, 'statusline', 100), STALE), true)
})

test('statusline 是精确来源，无条件覆盖', () => {
  assert.equal(shouldReplaceWindow(W(80, 'event', 200), W(79, 'statusline', 100), STALE), true,
    '哪怕 statusline 这条还更旧，也该以它为准——事件流那个是四舍五入出来的')
})

test('事件流不许盖掉还新鲜的 statusline 值 —— 这就是 79/80 横跳的来源', () => {
  const prev = W(79, 'statusline', 1_000_000)
  assert.equal(shouldReplaceWindow(prev, W(80, 'event', 1_000_000 + 60_000), STALE), false,
    '相差 1 分钟，远没到 statusline 失效的程度')
})

test('statusline 值旧到没参考意义了，事件流才顶上', () => {
  const prev = W(79, 'statusline', 1_000_000)
  assert.equal(shouldReplaceWindow(prev, W(94, 'event', 1_000_000 + STALE + 1), STALE), true,
    '只用 AI 对话的人全靠这条——statusline 那边永远不会再来了')
})

test('同为事件流时，新的盖旧的', () => {
  assert.equal(shouldReplaceWindow(W(80, 'event', 100), W(94, 'event', 200), STALE), true)
  assert.equal(shouldReplaceWindow(W(94, 'event', 200), W(80, 'event', 100), STALE), false, '乱序到达不该倒退')
})

test('过了重置时刻的那一格要作废', () => {
  const now = 1_700_000_000_000
  assert.equal(isWindowExpired(W(91, 'event', 0, Math.floor(now / 1000) - 60), now), true)
  assert.equal(isWindowExpired(W(91, 'event', 0, Math.floor(now / 1000) + 60), now), false)
  assert.equal(isWindowExpired(W(91, 'event', 0), now), false, '不带 resetsAt 的无从判断，不能瞎作废')
  assert.equal(isWindowExpired(undefined, now), false)
})

// ── 直连 /api/oauth/usage ──────────────────────────────────────────────────
// **真实响应**（2026-08-23 实测 HTTP 200，删掉了与额度无关的 spend/limits 细节，
// 但**原样保留那批 null 的代号窗口** —— 它们正是这条通道最容易踩的坑）。
const API_REAL = {
  five_hour: {
    utilization: 4.0,
    resets_at: '2026-08-23T16:39:59.856192+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null
  },
  seven_day: {
    utilization: 3.0,
    resets_at: '2026-08-30T03:59:59.856221+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null
  },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  seven_day_cowork: null,
  seven_day_omelette: null,
  tangelo: null,
  iguana_necktie: null,
  omelette_promotional: null,
  nimbus_quill: { utilization: 0.0, resets_at: null, limit_dollars: null },
  cinder_cove: null,
  amber_ladder: null,
  // **原样保留 weekly_scoped**：它和 weekly_all 的 group 都是 "weekly"，
  // 按 group 认会串台，这条就是防串台的哨兵
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 4,
      severity: 'normal',
      resets_at: '2026-08-23T16:39:59.856192+00:00',
      scope: null,
      is_active: true
    },
    {
      kind: 'weekly_all',
      group: 'weekly',
      percent: 3,
      severity: 'normal',
      resets_at: '2026-08-30T03:59:59.856221+00:00',
      scope: null,
      is_active: false
    },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 0,
      severity: 'normal',
      resets_at: null,
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      is_active: false
    }
  ]
}

test('从 /api/oauth/usage 抽出两个窗口，ISO 时间换算成 Unix 秒', () => {
  const q = claudeQuotaFromUsageApi(API_REAL, NOW)
  assert.ok(q)
  assert.equal(q.primary?.percent, 4)
  assert.equal(q.secondary?.percent, 3)
  assert.equal(q.primary?.windowMinutes, 300)
  assert.equal(q.secondary?.windowMinutes, 10080)
  assert.equal(q.primary?.src, 'api')
  // **resets_at 是 ISO 字符串**，不换算就是 NaN
  assert.equal(q.primary?.resetsAt, Math.floor(Date.parse('2026-08-23T16:39:59.856192+00:00') / 1000))
  assert.equal(typeof q.secondary?.resetsAt, 'number')
})

test('utilization 是 0–100 而不是 0–1：4.0 就是 4%，不是 400%', () => {
  const q = claudeQuotaFromUsageApi(API_REAL, NOW)
  assert.equal(q?.primary?.percent, 4, '当成 0–1 去乘 100 会得到 400 再被钳到 100')
})

test('那批 null 的代号窗口一个都不许影响结果', () => {
  const q = claudeQuotaFromUsageApi(API_REAL, NOW)
  // nimbus_quill 有值且 utilization=0，但它不是 five_hour/seven_day，不该被当成任何一格
  assert.equal(q?.primary?.percent, 4)
  assert.equal(q?.secondary?.percent, 3)
})

test('只有代号窗口、两个正经窗口都缺席时返回 null', () => {
  assert.equal(claudeQuotaFromUsageApi({ tangelo: null, nimbus_quill: { utilization: 5 } }, NOW), null)
  assert.equal(claudeQuotaFromUsageApi({}, NOW), null)
  assert.equal(claudeQuotaFromUsageApi(null, NOW), null)
})

test('isoToUnixSeconds 认不出就给 undefined，绝不给 NaN', () => {
  // NaN 会一路漂到倒计时和 isWindowExpired，表现成「空白 + 永不过期」
  assert.equal(isoToUnixSeconds('不是时间'), undefined)
  assert.equal(isoToUnixSeconds(null), undefined)
  assert.equal(isoToUnixSeconds(1787503200), undefined, '已经是 Unix 秒的数字不归它管')
  assert.equal(isoToUnixSeconds('2026-08-23T16:39:59.856192+00:00'), 1787503199)
})

// ── 来源优先级：api > statusline > event/log ───────────────────────────────
const mk = (src: QuotaWindow['src'], percent: number, at: number): QuotaWindow => ({
  percent,
  at,
  src
})

test('api 无条件盖掉 statusline —— 它两个窗口永远都在，且是服务端原始口径', () => {
  assert.equal(shouldReplaceWindow(mk('statusline', 79, NOW), mk('api', 4, NOW), 600_000), true)
})

test('statusline 不许盖掉「还新鲜的」api 值', () => {
  // 否则每轮对话刚从接口拿到的准确值，会被几秒后回传的 statusline 顶掉，两者来回横跳
  assert.equal(shouldReplaceWindow(mk('api', 4, NOW), mk('statusline', 79, NOW + 1000), 600_000), false)
})

test('api 值旧到没有参考意义之后，statusline 可以顶上', () => {
  // 只用终端不开 AI 对话的人：接口那条路不会再被触发，不能让旧值永远焊死在那儿
  assert.equal(
    shouldReplaceWindow(mk('api', 4, NOW), mk('statusline', 79, NOW + 600_001), 600_000),
    true
  )
})

test('事件流依旧盖不掉新鲜的 statusline（旧行为不能被这次改动破坏）', () => {
  assert.equal(shouldReplaceWindow(mk('statusline', 79, NOW), mk('event', 80, NOW + 1000), 600_000), false)
})

test('同级来源新的赢，旧的不许倒着盖回去', () => {
  assert.equal(shouldReplaceWindow(mk('api', 4, NOW + 1000), mk('api', 9, NOW), 600_000), false)
  assert.equal(shouldReplaceWindow(mk('api', 4, NOW), mk('api', 9, NOW + 1000), 600_000), true)
})

// ── 告警判定：服务端 severity 优先，拿不到才回退百分比 ─────────────────────
test('从 limits[] 按 kind 认回两个窗口的 severity', () => {
  const q = claudeQuotaFromUsageApi(API_REAL, NOW)
  assert.equal(q?.primary?.severity, 'normal', 'session ↔ five_hour')
  assert.equal(q?.secondary?.severity, 'normal', 'weekly_all ↔ seven_day')
})

test('必须按 kind 认而不是 group —— weekly_scoped 不许冒充周额度', () => {
  // 把 weekly_all 那条的 severity 改掉，weekly_scoped 保持 normal。
  // 按 group 认的话两条都是 "weekly"，会取到错的那条
  const data = {
    ...API_REAL,
    limits: API_REAL.limits.map((l) =>
      l.kind === 'weekly_all' ? { ...l, severity: 'warning' } : l
    )
  }
  const q = claudeQuotaFromUsageApi(data, NOW)
  assert.equal(q?.secondary?.severity, 'warning', '取串了就会是 normal')
})

test('没有 limits[] 时不编造 severity —— 让 isHot 回退到阈值', () => {
  const { limits: _drop, ...noLimits } = API_REAL
  const q = claudeQuotaFromUsageApi(noLimits, NOW)
  assert.equal(q?.primary?.severity, undefined)
  assert.ok(q?.primary?.percent === 4, '没有 limits 不影响百分比本身')
})

test('isHot：服务端说 normal 就不告警，哪怕百分比很高', () => {
  // 这正是接 severity 的意义 —— 80 那个坎是我们自己拍的，服务端没说过
  assert.equal(isHot({ percent: 95, at: NOW, src: 'api', severity: 'normal' }), false)
})

test('isHot：不是 normal 就告警，哪怕百分比很低', () => {
  assert.equal(isHot({ percent: 1, at: NOW, src: 'api', severity: 'warning' }), true)
})

test('isHot：没见过的新档位也算告警 —— 这就是不枚举的理由', () => {
  // 枚举 warning/critical 的写法撞上没列到的值会「静默不告警」
  assert.equal(isHot({ percent: 1, at: NOW, src: 'api', severity: 'apocalyptic' }), true)
})

test('isHot：拿不到 severity 的通道回退到百分比阈值', () => {
  assert.equal(isHot({ percent: HOT_FALLBACK_PERCENT - 1, at: NOW, src: 'statusline' }), false)
  assert.equal(isHot({ percent: HOT_FALLBACK_PERCENT, at: NOW, src: 'statusline' }), true)
  assert.equal(isHot({ percent: 100, at: NOW, src: 'event' }), true)
  assert.equal(isHot({ percent: 3, at: NOW, src: 'log' }), false)
})
