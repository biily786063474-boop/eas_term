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
      resetsAt: typeof w.resets_at === 'number' ? w.resets_at : undefined
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

/** 窗口长度 → 给人看的说法。hover 时用。 */
export function windowLabel(minutes?: number): string {
  if (!minutes) return '当前窗口'
  if (minutes <= 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
  const days = Math.round(minutes / 1440)
  return days === 7 ? '本周' : `${days} 天`
}
