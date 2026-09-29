// 按 leaf 登记的「往这个 AI 对话输入框挂 chip」入口（Task 7：插件 ui/message 按 Frame 找目标）。
// 和全局 composerAddChip 并存、不替换：那条是「最后聚焦的输入框」，辞典等仍走它；
// 这条是「指定哪个节点」，ui/message 按面板所在 Frame 找到 leafId 后查这里。
// 纯函数，uiSlice 调用；放单独文件是为了能在 node 里直接测（uiSlice 的 import 链跑不起来）。
import type { DictChip } from '../features/agentChat/chips.ts'

export type ChipTarget = (chip: DictChip) => void
export type ChipTargets = Record<string, ChipTarget>

export function withChipTarget(m: ChipTargets, leafId: string, fn: ChipTarget): ChipTargets {
  return m[leafId] === fn ? m : { ...m, [leafId]: fn }
}

/** 只删**仍是自己**的那个：同一个 leaf 的空态输入框和对话态输入框会交接，
 *  React 里新的可能先挂上、旧的后卸载 —— 不比对 fn 的话，旧的一卸载就把新的删了。 */
export function withoutChipTarget(m: ChipTargets, leafId: string, fn: ChipTarget): ChipTargets {
  if (m[leafId] !== fn) return m
  const next = { ...m }
  delete next[leafId]
  return next
}
