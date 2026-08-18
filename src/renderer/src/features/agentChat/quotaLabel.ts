// 额度窗口怎么说人话。纯函数，不引 React —— `node --test` 直接加载。
//
// **能显示什么由数据决定，不由想象决定。** CLI 的 rate_limit_event 给的是
// 窗口类型 + 状态 + 重置时刻，**没有「用了百分之多少」**（实测样本见
// shared/agentChat.ts 的 quota 事件）。所以这里也只产出这三样的人话版本，
// 不提供任何「进度」。哪天样本里出现了用量字段再扩。
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
