// 额度用量的共享数据模型 —— 主进程采集、渲染层显示，两边照这一份说话。
//
// ── 两个 CLI，两条完全不同的取数路 ──────────────────────────────────
// **Claude Code**：statusline 机制。CLI 定期调我们装的转发脚本
//   （resources/agent-hooks/eas-statusline.mjs），它把 JSON POST 回 app。
//   字段：rate_limits.five_hour / seven_day 的 used_percentage + resets_at。
//   headless 事件流里**没有**这些（2026-08-18 实测）。
//
// **Codex**：只能读它自己的会话日志。
//   2026-08-21 实测：`codex exec --json` 的 headless 流只有 thread.started /
//   turn.started / item.completed / turn.completed 四种事件，**不含 rate_limits**；
//   而 ~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl 里的 `token_count` 事件带着：
//     rate_limits: { primary: { used_percent, window_minutes, resets_at }, secondary, plan_type }
//   额度是**账号级**的，所以不必对应到某个会话，读最新那份日志就行。
//
// 两边都是「跑过一轮才有数」。**没数就不显示那一侧**（用户 2026-08-21 拍板），
// 不显示 0% 也不显示占位符 —— 一个永远是 — 的格子每天看着，不如没有。

/** 一个额度窗口。percent 是 0–100 的整数。 */
export interface QuotaWindow {
  percent: number
  /** 窗口长度（分钟）。Claude 侧固定 300 / 10080，Codex 侧原样透传 */
  windowMinutes?: number
  /** 什么时候重置（Unix 秒） */
  resetsAt?: number
  /** **这一格自己**的采样时刻（ms epoch）。
   *
   *  不能拿 CliQuota.updatedAt 顶替：那是整个 CLI 共用一个，而两条来源各自只报得出
   *  一部分窗口（statusline 的 five_hour 可能整个缺席，事件流的 five_hour 不带用量）。
   *  只刷新了一格却把整段推到「刚刚」，旁边那个几小时前的数字就会显示成「刚刚采到」。 */
  at: number
  /** 这一格是哪条通道给的。冲突时靠它决定谁说了算：
   *  `statusline` 两个窗口都精确；`event` 只在跨阈值时报、且五小时不带用量；
   *  `log` 是 Codex 读自己的会话日志。 */
  src: 'statusline' | 'event' | 'log'
}

/** 一条新数据该不该盖掉这一格已有的值。
 *
 *  **两条来源同时活着是常态**（开着终端 + 用 AI 对话），而它们对同一个窗口给出的数字
 *  会差 1（statusline 的 79 对事件流 0.796×100 四舍五入的 80）。谁后到谁说了算的话，
 *  这一格会在 79/80 之间无限横跳 —— 80 正好是告警阈值，颜色也跟着红/不红地闪。
 *
 *  规则：**statusline 是精确来源，无条件覆盖**；事件流是补充，只在这一格还没有
 *  statusline 值、或那个值已经旧到没有参考意义时才写。 */
export function shouldReplaceWindow(
  prev: QuotaWindow | undefined,
  next: QuotaWindow,
  staleMs: number
): boolean {
  if (!prev) return true
  if (next.src === 'statusline') return true
  if (prev.src === 'statusline' && next.at - prev.at < staleMs) return false
  return next.at >= prev.at
}

/** 这一格是不是已经过了重置时刻 —— 过了就该作废，不能继续显示。
 *
 *  事件流只在跨阈值时才报，所以「本周 79% → 周窗口重置 → 下周一直没到阈值」
 *  这条路上没有任何东西会来覆盖它，那个 79% 会一直挂着，
 *  tooltip 里的「X 月 X 日重置」指的还是已经过去的时刻。 */
export function isWindowExpired(w: QuotaWindow | undefined, now: number): boolean {
  return !!w && typeof w.resetsAt === 'number' && w.resetsAt * 1000 < now
}

/** 一个 CLI 的额度快照。两个窗口都可能缺 —— 缺了就不显示那一格。 */
export interface CliQuota {
  /** 短窗口：Claude 是 5 小时，Codex 是 primary（付费计划通常也是 5 小时） */
  primary?: QuotaWindow
  /** 长窗口：Claude 是 7 天，Codex 是 secondary（free 计划为 null） */
  secondary?: QuotaWindow
  /** 这份数据是什么时候采到的（ms epoch）。落盘后重开软件显示「上次更新于」 */
  updatedAt: number
  /** Codex 侧带的计划类型，Claude 侧没有。只用于 hover 说明，不参与判断 */
  planType?: string
}

export interface QuotaSnapshot {
  claude?: CliQuota
  codex?: CliQuota
}

/** 百分比归一到 0–100 的整数。
 *
 *  **两边的口径不一样**：Claude 的 used_percentage 已经是 0–100，
 *  Codex 的 used_percent 也是（实测 `used_percent: 1.0` = 1%，不是 100%）。
 *  但 headless 事件流里那个 `utilization` 是 0–1 —— 所以调用方要自己传对，
 *  这里只做范围钳制，不猜单位。猜错的代价是显示一个差 100 倍的数字。 */
export function clampPercent(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** 从 Codex 会话日志的一行里抽额度。不是那种行就返回 null。
 *
 *  只认 `payload.type === 'token_count'` 里的 rate_limits —— 结构见文件头。
 *  **容错要宽**：这是别人的私有日志格式，随时可能变。任何一处对不上就当没有，
 *  绝不猜、绝不用别的字段倒推。 */
export function codexQuotaFromLine(line: string, now: number): CliQuota | null {
  let j: unknown
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  const rec = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  const payload = rec(rec(j)?.payload)
  if (payload?.type !== 'token_count') return null
  const rl = rec(payload.rate_limits)
  if (!rl) return null
  const win = (v: unknown): QuotaWindow | undefined => {
    const w = rec(v)
    if (!w) return undefined
    const percent = clampPercent(w.used_percent)
    if (percent === undefined) return undefined
    return {
      percent,
      windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : undefined,
      resetsAt: typeof w.resets_at === 'number' ? w.resets_at : undefined,
      at: now,
      src: 'log'
    }
  }
  const primary = win(rl.primary)
  const secondary = win(rl.secondary)
  if (!primary && !secondary) return null
  return {
    primary,
    secondary,
    updatedAt: now,
    planType: typeof rl.plan_type === 'string' ? rl.plan_type : undefined
  }
}

/** 从 statusline 转发脚本回传的那份 JSON 里抽 Claude 额度。拿不到就返回 null。
 *
 *  **字段名是驼峰**——回传的不是 Claude Code 原始的 statusline JSON，而是
 *  resources/agent-hooks/eas-statusline.mjs 挑出来重拼的 `{ contextWindow, rateLimits }`
 *  （只带我们要的两块，不让 transcript_path / cwd 这些路径信息经过这条通道）。
 *  2026-08-22 的事故就出在这：读取端照着原始 JSON 的 `rate_limits` 取，永远取不到，
 *  而失败是无声的（HTTP 照回 ok:true），于是额度条上 Claude 那半永远空着，
 *  Codex 那半（走会话日志、不经这条通道）却一切正常。两种都认，
 *  日后谁直接把原始 JSON 发过来也不会再哑掉。
 *
 *  五小时 / 七天两个窗口**只有这条通道里有**，headless 事件流里没有（见文件头）。
 *  used_percentage 已经是 0–100，不用换算。 */
export function claudeQuotaFromStatusline(data: unknown, now: number): CliQuota | null {
  const rec = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  const d = rec(data)
  const rl = rec(d?.rateLimits ?? d?.rate_limits)
  if (!rl) return null
  // 窗口长度是**我们**知道的（five_hour / seven_day 就是名字本身的意思），
  // 回传里不带 window_minutes——这点和 Codex 那条不同，别去取。
  const win = (v: unknown, minutes: number): QuotaWindow | undefined => {
    const w = rec(v)
    if (!w) return undefined
    const percent = clampPercent(w.used_percentage)
    if (percent === undefined) return undefined
    return {
      percent,
      windowMinutes: minutes,
      resetsAt: typeof w.resets_at === 'number' ? w.resets_at : undefined,
      at: now,
      src: 'statusline'
    }
  }
  const primary = win(rl.five_hour, 300)
  const secondary = win(rl.seven_day, 10080)
  if (!primary && !secondary) return null
  return { primary, secondary, updatedAt: now }
}

/** headless 事件流里的 `rate_limit_event` → 一个额度窗口。取不到百分比就返回 null。
 *
 *  **这是「只用 AI 对话的人」唯一拿得到额度的通道**：AI 对话走
 *  `claude -p --output-format stream-json`，没有状态栏，statusline 那条路整个不存在。
 *
 *  实测 payload（2026-08-17，见 main/agentChat/claudeEvents.ts 的注释）：
 *    five_hour：{ status, resetsAt, rateLimitType } —— **不带 utilization**
 *    seven_day：{ status:'allowed_warning', resetsAt, utilization:0.79, surpassedThreshold:0.75 }
 *  也就是说**只有超过阈值的那个窗口才报用量**，平时的五小时窗口报不出百分比。
 *  所以这条通道是 statusline 的**补充**而不是替代：它能填上的那个窗口就填，
 *  填不了的保持原样，绝不要因为「这次没报」就把已有的数字抹掉。
 *
 *  utilization 是 0~1，与 statusline 的 0~100 口径不同，这里换算。 */
export function claudeQuotaWindowFromEvent(
  window: string,
  utilization: number | undefined,
  resetsAt: number | undefined,
  now: number
): { slot: 'primary' | 'secondary'; w: QuotaWindow } | null {
  // 窗口名按已知的认，认不出来就不猜 —— 猜错会把用量记到另一个窗口上，
  // 那比不显示更糟（用户会以为五小时快满了）
  const slot: 'primary' | 'secondary' | null =
    window === 'five_hour' ? 'primary' : window === 'seven_day' || window === 'weekly' ? 'secondary' : null
  if (!slot) return null
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null
  const percent = clampPercent(utilization * 100)
  if (percent === undefined) return null
  return {
    slot,
    w: {
      percent,
      windowMinutes: slot === 'primary' ? 300 : 10080,
      ...(typeof resetsAt === 'number' ? { resetsAt } : {}),
      at: now,
      src: 'event'
    }
  }
}

/** 这个数是多久以前采到的。
 *
 *  额度**本来就不是实时的**：Claude 只能等 statusline 被动回传（CLI 什么时候刷
 *  由它决定，headless 模式下压根不刷），Codex 要等它自己写日志。与其假装实时，
 *  不如把新鲜度摆出来——用户至少知道眼前这个数该不该信。 */
export function agoLabel(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}

/** 窗口长度 → 给人看的说法。hover 时用。 */
export function windowLabel(minutes?: number): string {
  if (!minutes) return '当前窗口'
  if (minutes <= 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
  const days = Math.round(minutes / 1440)
  return days === 7 ? '本周' : `${days} 天`
}
