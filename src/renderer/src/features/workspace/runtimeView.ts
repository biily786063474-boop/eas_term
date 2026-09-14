// 「运行与资源」页的纯函数：分组、摘要、标签、服务 id 解析。不 import React / store，`node --test` 裸跑。
import type { RuntimeObservedService, RuntimeRecentItem } from '../../../../shared/runtimeResources'

export const KIND_LABEL: Record<RuntimeObservedService['kind'], string> = {
  terminal: '终端', agent: 'AI 对话', plugin: '插件', 'language-server': '语言服务器', voice: '语音', cli: 'CLI'
}
export const OUTCOME_LABEL: Record<RuntimeRecentItem['outcome'], string> = {
  done: '完成', cancelled: '已取消', timeout: '排队超时', failed: '失败', exited: '已退出'
}
const REASON: Record<string, string> = {
  'memory-threshold': '内存超过当前阈值', 'cpu-threshold': 'CPU超过当前阈值', 'metrics-unavailable': '等待可靠资源采样',
  recovering: '等待资源持续恢复', 'critical-pressure': '系统内存压力过高'
}
export function queueReasonLabel(reason?: string): string {
  return (reason && REASON[reason]) || '等待运行名额或资源预算'
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
    if (!s.projectIds.length) { put('project:none', '未关联', s); continue }
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
  if (ms < 1000) return '不到 1 秒'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
export function fmtAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  return `${Math.floor(m / 60)} 小时前`
}
