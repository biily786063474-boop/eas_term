/** Electron browser/render/GPU/utility only; excludes spawned CLI/plugin memory.
 * reportedPeakSumBytes sums per-process reported peaks, NOT a simultaneous app peak.
 */
export interface ElectronProcessSnapshot {
 sampledAt:number;scope:'electron-only';processCount:number
 workingSetBytes:number|null;reportedPeakSumBytes:number|null;cpuPercent:number|null
}
/** Main-owned immutable sample. Unknown is null, never zero.
 * sampledAt is monotonic milliseconds, NOT a wall-clock timestamp.
 * CPU-only foundation; memory/GPU are not measured by this protocol yet.
 */
export interface CpuResourceSnapshot {
 readonly sampledAt: number | null
 readonly cpuPercent: number | null
 readonly status: 'stopped' | 'warming' | 'ready' | 'unavailable'
}
/** Sum of resident sets for main + live descendants, excluding the diagnostic helper.
 * Includes CLI/plugin descendants, but not reparented daemons. Shared pages may be counted twice.
 * Separate from Electron metrics; never add the two aggregates together.
 */
export interface ProcessTreeSnapshot {
 sampledAt:number;scope:'app-process-tree';processCount:number;residentBytes:number
}
export interface RuntimeMonitorSnapshot {
 processTree?:ProcessTreeSnapshot|null
 processes?:ElectronProcessSnapshot|null
 /** False preserves control-plane visibility but hides unavailable/stale usage. */
 metricsAvailable?:boolean
 sampledAt:number; logicalCpus:number;totalMemoryBytes:number;memoryUsedBytes:number|null
 memoryMethod:string;cpuPercent:number|null;enforcement:'disabled'|'plugin-tools'
 mode?:'normal'|'eco';threshold?:number
 tasks?:{id:string;name:string;projectId:string|null;scope?:'app';ageMs:number;state:'queued'|'running'|'cancel-requested';reason?:string}[]
 services?:RuntimeObservedService[]
 /** 最近结束的任务/服务（本窗口 + 应用级），新在前，有界。 */
 recent?:RuntimeRecentItem[]
}
export interface RuntimeRecentItem {
 id:string;name:string;kind:'task'|'service';outcome:'done'|'cancelled'|'timeout'|'failed'|'exited';projectId:string|null;scope?:'app';ageMs:number;durationMs:number
}
export interface RuntimeObservedService {
 id:string;name:string;kind:'plugin'|'terminal'|'agent'|'language-server'|'voice'|'cli';projectIds:string[];unknownRefs:number
 uptimeMs:number;state:'running'|'stopping';canStop:boolean
}
