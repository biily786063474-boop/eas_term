import { useSyncExternalStore } from 'react'

export interface ReportAssociation { leafId: string; frameId: string; nodeId: string; url: string }
interface ReportNode { id: string; leafId?: string; pane?: { kind: string; url?: string | null } }
interface ReportFrame { id: string; nodes: ReportNode[] }

const reports = new Map<string, ReportAssociation>()
const listeners = new Set<() => void>()
const previewListeners = new Set<() => void>()
const activePreviews = new Map<string, number>()
let revision = 0
function emit(): void { revision++; for (const listener of listeners) listener() }

export function publishReport(report: ReportAssociation): void {
  reports.set(report.leafId, report)
  emit()
}

export function clearReports(): void { reports.clear(); emit() }
export function clearReportForLeaf(leafId: string): void { if (reports.delete(leafId)) emit() }

export function reportForLeaf(leafId: string | undefined, frames: readonly ReportFrame[]): ReportAssociation | undefined {
  if (!leafId) return undefined
  const report = reports.get(leafId)
  const node = frames.find(frame => frame.id === report?.frameId)?.nodes.find(item => item.id === report?.nodeId)
  return node?.pane?.kind === 'web' && node.pane.url === report?.url ? report : undefined
}

export function manualReportForNode(frames: readonly ReportFrame[], frameId: string, nodeId: string, leafId: string | undefined): ReportAssociation | undefined {
  if (!leafId) return undefined
  const frame = frames.find(item => item.id === frameId)
  if (!frame?.nodes.some(node => node.leafId === leafId && node.pane?.kind === 'agent')) return undefined
  const node = frame.nodes.find(item => item.id === nodeId)
  const url = node?.pane?.url
  if (node?.pane?.kind !== 'web' || !url || !/^file:\/\/.*\.html?(?:[?#]|$)/i.test(url)) return undefined
  return { leafId, frameId, nodeId, url }
}

export function useReportRevision(): number {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision)
}

const previewKey = (frameId: string, nodeId: string): string => `${frameId}:${nodeId}`
/** 双层报告展示期间拆除画板原节点的 guest，避免同一 HTML 同时创建两个 Chromium 页面。 */
export function retainReportPreview(frameId: string, nodeId: string): () => void {
  const key = previewKey(frameId, nodeId)
  activePreviews.set(key, (activePreviews.get(key) ?? 0) + 1)
  for (const listener of previewListeners) listener()
  return () => {
    const count = activePreviews.get(key) ?? 0
    if (count <= 1) activePreviews.delete(key)
    else activePreviews.set(key, count - 1)
    for (const listener of previewListeners) listener()
  }
}

export function useReportPreviewActive(frameId: string, nodeId: string): boolean {
  return useSyncExternalStore(
    listener => { previewListeners.add(listener); return () => { previewListeners.delete(listener) } },
    () => activePreviews.has(previewKey(frameId, nodeId))
  )
}
