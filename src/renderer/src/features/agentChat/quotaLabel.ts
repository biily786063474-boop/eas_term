// 额度窗口怎么说人话。纯函数，不引 React —— `node --test` 直接加载。
//
// **能显示什么由数据决定，不由想象决定。** 这里只产出「窗口类型 + 状态 + 重置时刻」
// 的人话版本，不提供任何「进度」。
//
// 2026-08-22 更正：原注释断言 rate_limit_event「没有用了百分之多少」——**那是错的**。
// 七天那条带 `utilization`（0~1，跨过 surpassedThreshold 后才报），五小时那条确实没有。
// 额度条正是靠这个字段让「只用 AI 对话、从不开终端」的用户也能看到周用量
// （见 shared/quota.ts 的 claudeQuotaWindowFromEvent）。这个文件本身不需要跟着改：
// 它服务的是对话工具栏那套文案，不显示百分比是那边的设计选择，不是数据拿不到。
import type { Quota } from './reduce.ts'

/** 窗口类型 → 中文。**认不出就原样显示**：漏掉一种新窗口时，
 *  用户至少还能看到 CLI 报的原文，而不是一个空白或「未知」。 */
export function windowLabel(w: string): string {
  if (w === 'five_hour') return '五小时'
  if (w === 'weekly' || w === 'seven_day') return '本周'
  return w
}

/** 距离重置还有多久。**不显示秒**：这是个瞥一眼的信息，秒级精度只会让数字乱跳。
 *  已经过了重置时刻（时钟偏差或事件过期）返回 null，让调用方别显示倒计时。 */
export function untilReset(resetsAt: number | undefined, now: number): string | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null
  const ms = resetsAt * 1000 - now
  if (ms <= 0) return null
  const min = Math.floor(ms / 60000)
  if (min < 1) return '不到 1 分钟'
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  const d = Math.floor(h / 24)
  return `${d} 天 ${h % 24} 小时`
}

/** 状态严重度：0 正常 / 1 该注意 / 2 已经用不了。
 *  **认不出的状态按 0 处理**——不认识的字符串不该被当成告警，
 *  那会让界面为一个我们没见过的正常状态大呼小叫。 */
export function severityOf(status: string): 0 | 1 | 2 {
  const s = status.toLowerCase()
  if (s === 'allowed' || s === 'ok' || s === '') return 0
  if (s.includes('reject') || s.includes('exceed') || s.includes('exhaust') || s.includes('limit')) return 2
  if (s.includes('warn') || s.includes('near') || s.includes('approach')) return 1
  return 0
}

/** 一条额度的完整人话。用于 chip 上的悬浮说明。 */
export function quotaText(q: Quota, now: number): string {
  const w = windowLabel(q.window)
  const left = untilReset(q.resetsAt, now)
  const sev = severityOf(q.status)
  const head = sev === 2 ? `${w}额度已用尽` : `${w}额度`
  return left ? `${head} · ${left}后重置` : head
}
