// `omp usage --json` → 我们的 `CliQuota`。
//
// ── 为什么单独一个文件、不并进 quota.ts ─────────────────────────────────────
// `quota.ts` 是 Claude 与 Codex 那两条路的地盘（statusline / 事件流 / 会话日志）。
// omp 这条的取数方式（起一个短命进程问它）与那两条都不一样，映射规则也全是
// omp 自己的形状。放进去只会让那个文件里三套口径互相打架 ——
// 而「不影响 CC 和 codex 的任何方面」这条红线，从物理隔离开始最省事。
// `quota.ts` 那边只加了两个可选字段与一个 `src` 取值。
//
// ── 一份 report 里的行远比「两个窗口」多 ────────────────────────────────────
// Anthropic 一次就 push 四条以上：账号级的 7d，外加 `7d:opus` / `7d:sonnet` 这些
// **按模型族分的子额度**，`durationMs` 全是一周；还有一条 `anthropic:extra`
// 根本没有 window、单位是美元（超支额度）。
// 直接按「窗口最长」挑是并列的，谁上条取决于数组顺序 —— 用户看到的「本周 X%」
// 很可能是 Opus 那份子额度。本仓库 2026-08-22 在 Claude 那侧踩过同一个坑，
// `quota.ts:266-269` 的注释白纸黑字写着「必须按 kind 而不是 group」。
// 所以这里先过滤再排序，规则见 `usable()`。
import type { CliQuota, QuotaWindow } from './quota.ts'
import { clampPercent } from './quota.ts'

/** omp 的一条额度记录（我们只读用得上的字段，其余原样忽略）。
 *  形状来自上游 `packages/ai/src/usage.ts` 的 `UsageLimit`。 */
interface OmpLimit {
  id?: unknown
  scope?: { tier?: unknown; shared?: unknown }
  window?: { durationMs?: unknown; resetsAt?: unknown }
  amount?: {
    used?: unknown
    limit?: unknown
    usedFraction?: unknown
    remainingFraction?: unknown
    unit?: unknown
  }
  status?: unknown
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * 已用比例 0~1。**四级优先，照抄上游 `ai/src/usage.ts:118-131` 的 `resolveUsedFraction`**
 * （那个函数的注释写着「Precedence mirrors the usage UIs」，omp 自己的 `omp usage`
 * 就是用它算 status 的）。
 *
 * 为什么不图省事只读 `usedFraction`：内置 provider 今天大多两者都给，但自定义
 * provider（`models.yml` 那种）与上游新增的适配器**只填 `used`/`limit`** 的情况是有的。
 * 只读一个字段的症状是「omp 自己 `omp usage` 显示得好好的，我们的额度条却空着」，
 * 用户会认为我们坏了。
 *
 * **抄而不是 import**：那是上游包，进不了我们的构建。13-矩阵登记了这条同步项。
 */
function usedFraction(a: OmpLimit['amount']): number | undefined {
  const explicit = num(a?.usedFraction)
  if (explicit !== undefined) return explicit
  const used = num(a?.used)
  const limit = num(a?.limit)
  if (used !== undefined && limit !== undefined && limit > 0) return used / limit
  if (a?.unit === 'percent' && used !== undefined) return used / 100
  const remaining = num(a?.remainingFraction)
  if (remaining !== undefined) return 1 - remaining
  return undefined
}

/**
 * 这一条能不能上额度条。
 *
 * 两道过滤，缺一条都会让界面显示一个**看起来精确、实则答非所问**的数字：
 * · **有 window** —— 没有窗口的（`anthropic:extra` 那种美元超支额度）不是「周期用量」，
 *   把它显示成百分比、再配上「当前窗口」的说明，是两重错误。
 * · **不是按 tier 分的子额度** —— `scope.tier` 有值就说明它是某个模型族的份额，
 *   不是账号级的那条。两者 `durationMs` 相同，不过滤就会随数组顺序二选一。
 */
function usable(l: OmpLimit): boolean {
  const d = num(l.window?.durationMs)
  return d !== undefined && d > 0 && l.scope?.tier === undefined
}

/** omp 的 status → 我们的 severity。
 *
 *  **`'ok'` 必须映射成 `'normal'`**：`isHot()` 的判据是 `severity !== 'normal'`，
 *  把 omp 的原文写进去会让每一格都恒定标红。
 *  认不出的（含 `'unknown'` 与缺失）**不写** —— 那样 `isHot` 会回退到百分比阈值，
 *  比编一个告警级别诚实。 */
function severityOf(status: unknown): string | undefined {
  if (status === 'ok') return 'normal'
  if (status === 'warning' || status === 'exhausted') return status
  return undefined
}

function windowOf(l: OmpLimit, now: number): QuotaWindow | null {
  const frac = usedFraction(l.amount)
  if (frac === undefined) return null
  const percent = clampPercent(frac * 100)
  if (percent === undefined) return null
  const resetsMs = num(l.window?.resetsAt)
  const durationMs = num(l.window?.durationMs)
  const sev = severityOf(l.status)
  return {
    percent,
    // **omp 给的是毫秒，我们的字段是秒。** 不除的话 `isWindowExpired`
    // （`resetsAt * 1000 < now`）等于又乘一次 1000，这一格永远不过期、
    // tooltip 里的重置时间在几万天以后。
    ...(resetsMs === undefined ? {} : { resetsAt: Math.floor(resetsMs / 1000) }),
    ...(durationMs === undefined ? {} : { windowMinutes: Math.round(durationMs / 60_000) }),
    at: now,
    src: 'omp',
    ...(sev === undefined ? {} : { severity: sev })
  }
}

/**
 * 把 `omp usage --json` 的输出翻成一个 provider 的额度。
 *
 * @param provider 要取哪一家。**必须显式给**：一次 `omp usage` 可能回好几家
 *   （用户常同时配一家订阅一家 API key），而额度条只有一个位置 ——
 *   随手取 `reports[0]` 会让那个数字属于谁随数组顺序变，没人解释得清。
 *   取不到就返回 null，**不退化到别的 provider**。
 *
 * 拿不到数据一律 `null`（不是空对象、更不是 0%）：一个永远显示 0% 的格子
 * 看起来像真数据。API key 模式下 reports 为空是常态，退出码还是 0。
 */
export function ompQuotaFromUsageJson(payload: unknown, provider: string, now: number): CliQuota | null {
  const p = (payload ?? {}) as { reports?: unknown }
  const reports = Array.isArray(p.reports) ? (p.reports as Record<string, unknown>[]) : []
  const report = reports.find((r) => r && typeof r === 'object' && r.provider === provider)
  if (!report) return null

  const limits = Array.isArray(report.limits) ? (report.limits as OmpLimit[]) : []
  const rows = limits
    .filter((l) => l && typeof l === 'object' && usable(l))
    .map((l) => ({ durationMs: num(l.window?.durationMs) ?? 0, w: windowOf(l, now) }))
    .filter((r): r is { durationMs: number; w: QuotaWindow } => r.w !== null)
    .sort((a, b) => a.durationMs - b.durationMs)

  if (rows.length === 0) return null
  return {
    // 短的上 primary、长的上 secondary —— 与 Claude 的 5 小时 / 7 天、
    // Codex 的 primary / secondary 是同一个直觉，界面那两格的含义不变。
    primary: rows[0].w,
    // **只有一条就只填一格**，不拿被过滤掉的去凑数
    ...(rows.length > 1 ? { secondary: rows[rows.length - 1].w } : {}),
    updatedAt: now,
    label: `omp · ${provider}`
  }
}

// ── 落盘取舍 ──────────────────────────────────────────────────────────────

/** 非加密的短哈希（FNV-1a）。**够用且必须够轻**：
 *  `shared/` 会被渲染层一起打包，不能 import `node:crypto`。
 *  这里要的不是密码学强度，是「同一个账号算出同一个串、换了账号就变」，
 *  而且**不把邮箱与账号 id 原样落盘** —— 那份快照是磁盘上一个普通 JSON。 */
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** 这份数据属于哪个账号。**取不到就是 undefined —— 那就别比对**，
 *  宁可不比，也不能拿 undefined 去跟一个真 key 比然后误判成「换账号了」
 *  （`quotaApi.ts` 那条纪律逐字适用）。 */
export function ompAccountKeyOf(payload: unknown, provider: string): string | undefined {
  const p = (payload ?? {}) as { reports?: unknown }
  const reports = Array.isArray(p.reports) ? (p.reports as Record<string, unknown>[]) : []
  const report = reports.find((r) => r && typeof r === 'object' && r.provider === provider)
  const meta = (report?.metadata ?? {}) as Record<string, unknown>
  const parts = ['accountId', 'email', 'orgId']
    .map((k) => (typeof meta[k] === 'string' ? (meta[k] as string) : ''))
    .filter(Boolean)
  if (parts.length === 0) return undefined
  return shortHash(`${provider}|${parts.join('|')}`)
}

/** 两格的值一不一样。**同值不广播** —— 每轮对话跑完都会来一次，
 *  值没变还广播的话界面上的「上次更新于」会每次都跳，而它其实什么都没变。 */
function sameWindow(a: QuotaWindow | undefined, b: QuotaWindow | undefined): boolean {
  if (!a || !b) return a === b
  return a.percent === b.percent && a.resetsAt === b.resetsAt && a.severity === b.severity
}

/**
 * 这次读到的数据该不该写进快照，写成什么样。
 *
 * 返回 `null` = 什么都不用做（值没变、或这次没读到）。
 * 返回对象 = 用它替换快照里那两个字段。
 *
 * **两条纪律**：
 * · **读失败 / 没数据不清空**（`incoming` 为 null 时原样保留）。网络抖一下就把额度条
 *   清掉，比显示一个稍旧的数字糟得多；真正让旧数据作废的是 `isWindowExpired`。
 * · **账号对不上就整个丢掉**。与 `claudeAccountUuid` 同一条：2026-08-23 那次事故
 *   「`/login` 换账号之后显示的是别人的额度」不是显示旧数字，是显示别人的。
 *   omp 那边同样支持多账号，同一个坑照样在。
 */
export function nextOmpSnapshot(
  prev: { omp?: CliQuota; ompAccountKey?: string },
  incoming: CliQuota | null,
  accountKey: string | undefined
): { omp: CliQuota; ompAccountKey?: string } | null {
  if (!incoming) return null
  const switched = !!accountKey && !!prev.ompAccountKey && accountKey !== prev.ompAccountKey
  if (
    !switched &&
    prev.omp &&
    sameWindow(prev.omp.primary, incoming.primary) &&
    sameWindow(prev.omp.secondary, incoming.secondary)
  ) {
    return null
  }
  return { omp: incoming, ...(accountKey === undefined ? {} : { ompAccountKey: accountKey }) }
}
