// 「在用时长」的两条判据，从 telemetry.ts 拆出来单测（那边 import electron，测不了）。

/** 采样间隔：每这么久看一眼算不算在用 */
export const ACTIVE_SAMPLE_MS = 15 * 1000
/** 系统这么多秒内有过键鼠才算在用 */
export const ACTIVE_IDLE_S = 60

/** 这一格算不算在用：Eas-Term 自己的窗口在前台，**且**最近有键鼠。只问自己的窗口，不看别的应用。 */
export function isActiveSample(hasFocusedWindow: boolean, systemIdleSeconds: number): boolean {
  return hasFocusedWindow && Number.isFinite(systemIdleSeconds) && systemIdleSeconds >= 0 && systemIdleSeconds < ACTIVE_IDLE_S
}

/** 心跳里上报的在用秒数。采样粒度 15s 会略多算，封顶到这段的总时长；坏值一律按 0。 */
export function cappedActiveSeconds(sec: number, activeMs: number): number {
  const total = Number.isFinite(sec) ? Math.max(sec, 0) : 0
  const active = Number.isFinite(activeMs) ? Math.max(Math.round(activeMs / 1000), 0) : 0
  return Math.min(total, active)
}
