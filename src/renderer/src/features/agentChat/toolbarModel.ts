// 工具栏能力映射：把一个 CLI 的 CliCapabilities 声明翻译成工具栏该渲染什么。
// **纯逻辑，不引 React / DOM，不引入任何 CLI 身份判断。** CliCapabilities 本身也没有
// 携带「这是哪个 CLI」的字段——UI 只读这一层产出的布尔值和数组，永远不该也无从问
// 「是不是 claude / codex」。加第三个 CLI 时，只要它的 adapter 如实填好 capabilities，
// 这个文件和它的调用方都不需要改一行。
//
// 三条硬约束（背后是实测教训，不是随手定的）：
// ① 绝不显示上下文百分比——Usage.contextRatio 在内核里零处填写（turn.done 的 usage
//    没有窗口上限，没有分母），formatUsage 只输出 token 数与花费。
// ② costUsd 缺失（undefined）时整段省略，不显示 $0——Codex 不报花费，显示「花了 $0」
//    是错的信息，不是「没有信息」。但 costUsd 显式为数值 0 时要显示——那是真实数据。
// ③ approval 为空 → 显示沙箱级别；非空 → 不显示。判据是「这个 CLI 能不能逐次审批」，
//    不是「它是不是 Codex」。approval 为空却没给 sandboxLevels 时 showSandbox 必须是
//    false——宁可不显示，也不要显示一个空的选择器。

import type { CliCapabilities, Usage } from '../../../../shared/agentChat.ts'

export interface ToolbarModel {
  showModel: boolean
  models: { id: string; label: string }[]
  showEffort: boolean
  effortLevels: { id: string; label: string }[]
  showCompact: boolean
  showSandbox: boolean
  sandboxLevels: { id: string; label: string }[]
  showUsage: boolean
}

export function toolbarModel(caps: CliCapabilities): ToolbarModel {
  const models = caps.models ?? []
  const effortLevels = caps.effortLevels ?? []
  const sandboxLevels = caps.sandboxLevels ?? []
  return {
    showModel: models.length > 0,
    models,
    showEffort: effortLevels.length > 0,
    effortLevels,
    // compact 未声明（undefined）和显式声明为 false 都不显示——两个条件缺一不可，
    // 否则「没告诉我们能不能压缩」会被误当成「能压缩」。
    showCompact: caps.compact !== false && caps.compact !== undefined,
    showSandbox: caps.approval.length === 0 && sandboxLevels.length > 0,
    sandboxLevels,
    showUsage: caps.contextUsage
  }
}

/** 拼成人话，例：`输入 12 · 输出 345 · 缓存 6789 · $0.0421`。
 *  u 为 null 时返回空串；cachedInputTokens / costUsd 缺失（undefined）时各自的分段
 *  整段省略——但 costUsd 显式为 0 时仍然显示 $0，因为那是「已知花费为零」，跟「这个
 *  CLI 根本不报花费」不是一回事。 */
export function formatUsage(u: Usage | null, costUsd?: number): string {
  if (!u) return ''
  const parts: string[] = [`输入 ${u.inputTokens}`, `输出 ${u.outputTokens}`]
  if (u.cachedInputTokens !== undefined) {
    parts.push(`缓存 ${u.cachedInputTokens}`)
  }
  if (costUsd !== undefined) {
    parts.push(`$${costUsd}`)
  }
  return parts.join(' · ')
}
