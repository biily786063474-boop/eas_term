// 额度与上下文的显示数据。纯函数、零 import，node --test 直接跑。
//
// ── 两个数据源，优先级不同 ────────────────────────────────────────────
// **statusline 通道**（resources/agent-hooks/eas-statusline.mjs 回传）：
//   · rate_limits.five_hour.used_percentage / seven_day.used_percentage —— 两个窗口都有
//   · context_window.used_percentage —— v2.1.6+ 原生，**和 CLI 里 /context 一致**
// **headless 事件流**（turn.done / rate_limit_event）：
//   · 五小时那条没有 utilization，七天那条只在接近限额时才推
//   · 上下文只能自己算 (input+cache)/contextWindow，口径和 /context 不同
//     （Claude Code 扣掉了自动压缩预留），所以会偏小 —— 用户报的「不准」就是这个
//
// 所以：**有 statusline 数据就用它，没有才回退到事件流**。回退时要标出来，
// 不能让一个近似值冒充精确值。

export interface StatuslineData {
  contextWindow?: { used_percentage?: number | null } | null
  rateLimits?: {
    five_hour?: { used_percentage?: number | null; resets_at?: number | null } | null
    seven_day?: { used_percentage?: number | null; resets_at?: number | null } | null
  } | null
}

export interface QuotaBar {
  /** 'five_hour' | 'seven_day' */
  key: string
  label: string
  /** 0–100，已经取整 */
  percent: number
  resetsAt?: number
}

const pct = (v: unknown): number | null => {
  if (typeof v !== 'number' || Number.isNaN(v)) return null
  return Math.min(100, Math.max(0, Math.round(v)))
}

/**
 * 两个额度进度条。**只产出真有百分比的那些** —— 拿不到就不画，
 * 绝不用倒计时或本地累计倒推一个数字（那是「看起来精确、实则编造」）。
 */
export function quotaBars(d: StatuslineData | null | undefined): QuotaBar[] {
  const r = d?.rateLimits
  if (!r) return []
  const out: QuotaBar[] = []
  const five = pct(r.five_hour?.used_percentage)
  if (five !== null) {
    out.push({ key: 'five_hour', label: '五小时', percent: five, resetsAt: r.five_hour?.resets_at ?? undefined })
  }
  const seven = pct(r.seven_day?.used_percentage)
  if (seven !== null) {
    out.push({ key: 'seven_day', label: '本周', percent: seven, resetsAt: r.seven_day?.resets_at ?? undefined })
  }
  return out
}

/**
 * 上下文占用。返回 null = 一个数都拿不到，那就别显示。
 *
 * @param fallbackRatio 事件流自己算的比例（0–1），只在没有 statusline 数据时用
 */
export function contextPercent(
  d: StatuslineData | null | undefined,
  fallbackRatio?: number
): { percent: number; exact: boolean } | null {
  const native = pct(d?.contextWindow?.used_percentage)
  // exact=true 表示「和 CLI 的 /context 对得上」；false 是我们自己算的近似值
  if (native !== null) return { percent: native, exact: true }
  if (typeof fallbackRatio === 'number' && !Number.isNaN(fallbackRatio)) {
    return { percent: Math.min(100, Math.max(0, Math.round(fallbackRatio * 100))), exact: false }
  }
  return null
}

/** 进度条的告警档：>=90 危险、>=75 提醒、其余正常。和额度 chip 原来那套色阶一致。 */
export function barSeverity(percent: number): 0 | 1 | 2 {
  if (percent >= 90) return 2
  if (percent >= 75) return 1
  return 0
}
