// 把 adapter 注册表与「这台机器上探测到的可用性」合成渲染层能用的 CliInfo 列表。
// 纯函数——探测本身（adapter.detect()）是 IO，由调用方（session.ts 的 IPC handler）
// 先跑完，再把结果按 { [id]: boolean } 的形状喂进来，这里只管合成，可测的就是这一层。

import type { CliAdapter, CliInfo } from '../../shared/agentChat.ts'

/** availability 按 adapter.id 查；判据精确是 `=== true`——缺失的 key、显式的 false、
 *  乃至任何非布尔的真值都算不可用（宁可少显示一个选项，也不要让用户选一个装不上的 CLI
 *  然后报错）。capabilities 原样透传，不挑字段重新拼装——UI 靠它整体决定渲染哪些控件。 */
export function buildCliList(adapters: CliAdapter[], availability: Record<string, boolean>): CliInfo[] {
  return adapters.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    available: availability[a.id] === true,
    capabilities: a.capabilities
  }))
}
