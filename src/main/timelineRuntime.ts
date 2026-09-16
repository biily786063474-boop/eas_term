// Conservative, zero-model-cost audit. A wording signal is not a claim that a
// milestone exists: it only queues one reminder for the next user-driven turn.
export function timelineGuidance(pluginId?: string): string {
  return pluginId === 'eas:timeline' ? '时间线：交付独立成果前用 timeline_record，taskKey/date 保持稳定，更新不重复计数。已验证/已验收必须附依据；仅成功回执代表已记录。只查询相关记录，不扫描历史、不另起模型。普通问答不记；收到补漏提醒而无需记录时用 timeline_review 简述。' : ''
}
interface Audit { cwd: string; active: boolean; possible: boolean; receipt: boolean; reminder: boolean }
export class TimelineRuntime {
  private sessions = new Map<string, Audit>()
  begin(id: string, cwd: string): void {
    const old = this.sessions.get(id)
    if (old?.active && old.cwd === cwd) return
    this.sessions.set(id, { cwd, active: true, possible: false, receipt: false, reminder: old?.reminder ?? false })
  }
  text(id: string, text: string): void {
    const s = this.sessions.get(id)
    if (s?.active && /已完成|已修复|已交付|设计.*定稿|验收通过|implemented|delivered|fixed/i.test(text.slice(-4000))) s.possible = true
  }
  receipt(id: string, cwd: string, tool: string, result: unknown): void {
    const s = this.sessions.get(id)
    if (!s?.active || s.cwd !== cwd || !result || typeof result !== 'object') return
    const r = result as { isError?: boolean; structuredContent?: { id?: string; reviewed?: boolean } }
    if (!r.isError && ((tool === 'timeline_record' && typeof r.structuredContent?.id === 'string') || (tool === 'timeline_review' && r.structuredContent?.reviewed === true))) s.receipt = true
  }
  end(id: string): void {
    const s = this.sessions.get(id)
    if (!s?.active) return
    s.active = false
    s.reminder = s.possible && !s.receipt
  }
  takeReminder(id: string): string {
    const s = this.sessions.get(id)
    if (!s?.reminder) return ''
    s.reminder = false
    return '时间线提示：上轮出现成果交付表述但未收到记录成功回执。请在本轮顺带核对相关成果，已有记录则更新；无成果需记则 timeline_review 简述。勿扫描全历史、勿为此另开轮次。'
  }
  drop(id: string): void { this.sessions.delete(id) }
}
export const timelineRuntime = new TimelineRuntime()
