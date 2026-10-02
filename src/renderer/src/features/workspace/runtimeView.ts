// 「运行与资源」页的纯函数：分组、摘要、标签、服务 id 解析。不 import React / store，`node --test` 裸跑。
import { t } from '../../i18n.ts'
import type { RuntimeObservedService, RuntimeRecentItem } from '../../../../shared/runtimeResources'

// 文案在读取时按当前语言取（getter），不在模块顶层固化
export const KIND_LABEL: Record<RuntimeObservedService['kind'], string> = {
  get terminal() { return t('settings.runtime.kind.terminal') },
  get agent() { return t('settings.runtime.kind.agent') },
  get plugin() { return t('settings.runtime.kind.plugin') },
  get 'language-server'() { return t('settings.runtime.kind.languageServer') },
  get notification() { return t('settings.runtime.kind.notification') },
  get voice() { return t('settings.runtime.kind.voice') },
  get cli() { return t('settings.runtime.kind.cli') }
}
export const OUTCOME_LABEL: Record<RuntimeRecentItem['outcome'], string> = {
  get done() { return t('settings.runtime.outcome.done') },
  get cancelled() { return t('settings.runtime.outcome.cancelled') },
  get timeout() { return t('settings.runtime.outcome.timeout') },
  get failed() { return t('settings.runtime.outcome.failed') },
  get exited() { return t('settings.runtime.outcome.exited') }
}
const REASON_KEY = {
  'memory-threshold': 'settings.runtime.reason.memory',
  'cpu-threshold': 'settings.runtime.reason.cpu',
  'metrics-unavailable': 'settings.runtime.reason.metrics',
  recovering: 'settings.runtime.reason.recovering',
  'critical-pressure': 'settings.runtime.reason.critical'
} as const
export function queueReasonLabel(reason?: string): string {
  if(reason==='cli-offline')return t('settings.runtime.waitNetwork')
  if(reason==='cli-backoff')return t('settings.runtime.reason.cliBackoff')
  if(reason==='cli-dispatch')return t('settings.runtime.reason.cliDispatch')
  const key = reason ? (REASON_KEY as Record<string, (typeof REASON_KEY)[keyof typeof REASON_KEY]>)[reason] : undefined
  return key ? t(key) : t('settings.runtime.reason.default')
}
/** '' = 全部；'none' = 只要完全未关联的 */
export function matchProject(filter: string, ids: readonly (string | null)[]): boolean {
  if (filter === '') return true
  if (filter === 'none') return ids.every((id) => id === null)
  return ids.includes(filter)
}
export interface ServiceGroup { key: string; title: string; items: RuntimeObservedService[] }
/** 按项目：一个服务归属几个项目就出现在几张卡里（共享语言服务器）；没有归属进「未关联」。按类型：标题用中文类型名。 */
export function groupServices(services: readonly RuntimeObservedService[], mode: 'project' | 'kind', labelOf: (projectId: string) => string): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>()
  const put = (key: string, title: string, s: RuntimeObservedService): void => {
    let g = groups.get(key)
    if (!g) { g = { key, title, items: [] }; groups.set(key, g) }
    g.items.push(s)
  }
  for (const s of services) {
    if (mode === 'kind') { put('kind:' + s.kind, KIND_LABEL[s.kind], s); continue }
    if (!s.projectIds.length) { put('project:none', t('settings.runtime.unlinked'), s); continue }
    for (const id of s.projectIds) put('project:' + id, labelOf(id), s)
  }
  return [...groups.values()]
}
export function servicesSummary(services: readonly RuntimeObservedService[]): { kinds: { kind: RuntimeObservedService['kind']; label: string; count: number }[]; stopping: number } {
  const counts = new Map<RuntimeObservedService['kind'], number>()
  let stopping = 0
  for (const s of services) {
    counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
    if (s.state === 'stopping') stopping += 1
  }
  return { kinds: [...counts.entries()].map(([kind, count]) => ({ kind, label: KIND_LABEL[kind], count })), stopping }
}
/** 服务 id → 画布上对应 leaf 的钥匙。id 形状由主进程定：pty.ts 的 'pty:<id>'，session.ts 的 'agent:<sessionId>:<generation>' */
export function serviceLeafRef(id: string): { kind: 'terminal'; ptyId: string } | { kind: 'agent'; sessionId: string } | null {
  const pty = id.match(/^pty:(.+)$/)
  if (pty) return { kind: 'terminal', ptyId: pty[1] }
  const agent = id.match(/^agent:([^:]+):\d+$/)
  if (agent) return { kind: 'agent', sessionId: agent[1] }
  return null
}
export function fmtDuration(ms: number): string {
  if (ms < 1000) return t('settings.runtime.dur.lt1s')
  const s = Math.floor(ms / 1000)
  if (s < 60) return t('settings.runtime.dur.sec', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('settings.runtime.dur.min', { n: m })
  return t('settings.runtime.dur.hourMin', { h: Math.floor(m / 60), m: m % 60 })
}
export function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return t('settings.runtime.ago.sec', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('settings.runtime.ago.min', { n: m })
  return t('settings.runtime.ago.hour', { n: Math.floor(m / 60) })
}
