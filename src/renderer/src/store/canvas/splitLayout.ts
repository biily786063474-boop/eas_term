// 发布分屏（插件 panel/split.open）的纯计算：放哪几格、换掉谁、怎么排。无 DOM、无 store，node --test 裸跑。
// 规则见 docs/superpowers/specs/2026-10-02-发布台分屏-design.md。
export const SPLIT_MAX = 6
export const SPLIT_CELL = { w: 420, h: 520, gap: 16 }

import type { SplitWant } from '../../../../shared/splitView'
export type { SplitWant }
export interface SplitCellNow { key: string; nodeId: string; openedAt: number }
export interface SplitPlan { add: SplitWant[]; reuse: string[]; replace: Array<{ out: SplitCellNow; in: SplitWant }>; skipped: string[] }

export function planSplit(now: readonly SplitCellNow[], want: readonly SplitWant[], published: readonly string[], max: number): SplitPlan {
  const cap = Math.max(1, Math.min(SPLIT_MAX, Math.floor(max) || SPLIT_MAX))
  const plan: SplitPlan = { add: [], reuse: [], replace: [], skipped: [] }
  const seen = new Set<string>()
  const list = want.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)))
  for (const x of list.slice(cap)) plan.skipped.push(x.key)
  // 可被换掉的：已有格子里、不在这批要的里面的；已发布优先，同档按 openedAt 早的先
  const keep = new Set(list.slice(0, cap).map((x) => x.key))
  const pub = new Set(published)
  const victims = now
    .filter((cell) => !keep.has(cell.key))
    .sort((a, b) => Number(pub.has(b.key)) - Number(pub.has(a.key)) || a.openedAt - b.openedAt)
  let free = cap - now.length
  for (const x of list.slice(0, cap)) {
    if (now.some((cell) => cell.key === x.key)) { plan.reuse.push(x.key); continue }
    if (free > 0) { plan.add.push(x); free--; continue }
    const out = victims.shift()
    if (out) plan.replace.push({ out, in: x })
    else plan.skipped.push(x.key)
  }
  return plan
}

export function splitLayout(n: number): { cols: number; rows: number; slots: Array<{ x: number; y: number }>; w: number; h: number } {
  const k = Math.max(0, Math.min(SPLIT_MAX, n))
  const cols = k <= 3 ? Math.max(1, k) : k === 4 ? 2 : 3
  const rows = k <= 3 ? 1 : 2
  const { w, h, gap } = SPLIT_CELL
  const slots = Array.from({ length: k }, (_, i) => ({ x: (i % cols) * (w + gap), y: Math.floor(i / cols) * (h + gap) }))
  return { cols, rows, slots, w: cols * w + (cols - 1) * gap, h: rows * h + (rows - 1) * gap }
}
