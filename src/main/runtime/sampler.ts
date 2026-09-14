import { cpuBusyPercent, type CpuTicks } from './cpuMetrics.ts'
import type { CpuResourceSnapshot } from '../../shared/runtimeResources.ts'
interface SamplerDeps {
 /** Cheap synchronous OS ticks only; no shell, disk, IPC or async work here. */
 read: () => readonly CpuTicks[]
 now: () => number
 setTimer: (fn: () => void, ms: number) => unknown
 clearTimer: (handle: unknown) => void
}
/** Opt-in lifecycle, no timers on import. Keeps one snapshot and one baseline.
 * No app.getAppMetrics calls, so existing diagLog sampling is unaffected.
 */
export function createCpuSampler(deps: SamplerDeps) {
 let generation = 0, active = false
 let timer: unknown = null
 let previous: CpuTicks[] | null = null
 let previousAt: number | null = null
 let latest: CpuResourceSnapshot = Object.freeze({ sampledAt: null, cpuPercent: null, status: 'stopped' })
 const publish = (sample: CpuResourceSnapshot) => { latest = Object.freeze(sample) }
 const sample = (epoch: number): void => {
  if (!active || epoch !== generation) return
  timer = null
  let now: number | null = null
  try {
   now = deps.now()
   if (!Number.isFinite(now)) throw new Error('invalid clock')
   const current = deps.read().map(t => ({ ...t }))
   const continuous = previousAt !== null && now > previousAt && now - previousAt <= 10000
   const cpuPercent = cpuBusyPercent(continuous ? previous : null, current)
   publish({ sampledAt: now, cpuPercent, status: cpuPercent === null ? 'warming' : 'ready' })
   previous = current; previousAt = now
  } catch {
   previous = null; previousAt = null
   publish({ sampledAt: now !== null && Number.isFinite(now) ? now : null, cpuPercent: null, status: 'unavailable' })
  }
  if (active && epoch === generation) timer = deps.setTimer(() => sample(epoch), 1000)
 }
 return {
  start(): void {
   if (active) return
   active = true; previous = null; previousAt = null
   sample(++generation)
  },
  stop(): void {
   active = false; generation++
   if (timer !== null) deps.clearTimer(timer)
   timer = null; previous = null; previousAt = null
   publish({ sampledAt: null, cpuPercent: null, status: 'stopped' })
  },
  snapshot(): CpuResourceSnapshot { return latest }
 }
}
