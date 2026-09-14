/** Whole-machine ticks (Node os.cpus().times). No polling or Electron dependency.
 * null means unknown, never idle: bootstrap/hotplug/reset needs a fresh baseline.
 * Does NOT accept per-process CPU percentages from ps/Electron.
 */
export interface CpuTicks { user: number; nice: number; sys: number; idle: number; irq: number }
const fields = ['user', 'nice', 'sys', 'idle', 'irq'] as const
export function cpuBusyPercent(previous: readonly CpuTicks[] | null, current: readonly CpuTicks[]): number | null {
  if (!previous?.length || previous.length !== current.length) return null
  let total = 0
  let idle = 0
  for (let i = 0; i < current.length; i++) {
    for (const field of fields) {
      const before = previous[i][field]
      const after = current[i][field]
      if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < before) return null
      const delta = after - before
      total += delta
      if (field === 'idle') idle += delta
    }
  }
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(100, 100 * (1 - idle / total)))
}
