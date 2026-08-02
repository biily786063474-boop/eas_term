// 画布状态的派生读取。
//
// 这里的东西都在解决同一类问题：**状态里存的是「指向别处数据的引用」，
// 而那份数据可能已经不在了。** 直接读原始字段就会拿到悬空引用。

import type { AppState } from '../types'

/**
 * 当前真正处于最大化的节点。**所有消费端都该用这个，不要直接读 `s.maximizedNode`。**
 *
 * 为什么必须校验：`maximizedNode` 记的是 `{frameId?, nodeId}`，
 * 而节点可以从好几条路径消失 —— 关闭节点（UI 按钮 / `canvas_close_node`）、
 * 删除 Frame、切换/重载画布。指望每条路径都记得把它清掉是不现实的，
 * **漏掉任何一条，症状都是「关掉一个节点，整个画布全空」**：
 * 因为 PaneLayer 和各节点组件都靠 `maximizedNode && !isMax` 来隐藏「非最大化的节点」，
 * 一旦它指向一个不存在的节点，就没有任何节点能匹配 isMax —— 于是全被隐藏。
 *
 * 实测复现过：最大化一个节点 → 关闭它 → `canvas_get_state` 里
 * `maximized` 字段仍是那个已删除的 id，画布上一个模块都看不见。
 *
 * 返回原引用或 null，所以 zustand 的浅比较不会因为这层包装产生多余重渲染。
 */
export function liveMaximizedNode(s: AppState): { frameId?: string; nodeId: string } | null {
  const m = s.maximizedNode
  if (!m) return null
  const alive = m.frameId
    ? !!s.canvas.frames.find((f) => f.id === m.frameId)?.nodes.some((n) => n.id === m.nodeId)
    : s.canvas.freeNodes.some((n) => n.id === m.nodeId)
  return alive ? m : null
}
