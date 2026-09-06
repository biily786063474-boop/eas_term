// 画布上**内容模块**的数量上限与淘汰规则。纯函数，有测试。
//
// 用户 2026-09-06：「控制画布上展示的文件数量，超过 5 个内容的模块自动清理最前面的模块，
// 用户可以选择右上角把内容钉在画板，这个不在 5 个的限制之内。」
//
// ── 什么算「内容模块」 ────────────────────────────────────────────────────
// 只有**文件预览类**：HTML/网页（web）、代码与 Markdown（code）、图片视频（image）。
// 这些是 AI 一张接一张往画布上堆的东西，也是用户说的「html md 图片类」。
//
// **不算内容、永远不淘汰**的：
//   · 终端与 AI 对话（带 leafId）—— 那是活的进程与正在进行的对话，删了就断了
//   · 画布组件（component）—— 版本管理 / 团队面板 / 代码地图 / 插件面板，是用户摆的工具
//   · 便签（note 类 shape 不在 nodes 里，天然不受影响）
//
// ── 淘汰谁 ────────────────────────────────────────────────────────────────
// 「最前面的」= **最早加进来的那个**（数组下标小的在前，`placeNodeInFrame` 一直是追加）。
// 先进先出，像一叠纸：新的压上来，最底下那张被抽走。**钉住的完全不参与**：既不占名额，
// 也不会被抽走。

import type { CanvasNode } from './types'

/** 默认上限。用户说的「5 个」 */
export const CONTENT_CAP = 5

/** 这个节点算不算「内容模块」（会被计数与淘汰的那类） */
export function isContentNode(n: CanvasNode): boolean {
  if (n.leafId) return false // 终端 / AI 对话：活的东西，不动
  if (n.component) return false // 画布组件：用户摆的工具，不动
  const k = n.pane?.kind
  return k === 'web' || k === 'code' || k === 'image'
}

/** 钉住的不参与限额（既不占名额也不被淘汰） */
export function isPinned(n: CanvasNode): boolean {
  return n.pinned === true
}

/**
 * 加入新节点后，应该淘汰哪几个（返回 id）。
 *
 * @param nodes 这个 Frame 当前的全部节点，**按加入顺序**（数组下标即顺序）
 * @param cap 上限，默认 5
 *
 * 只在超出时返回；不超出返回空数组。**永远从最早的开始淘汰**。
 */
export function nodesToEvict(nodes: readonly CanvasNode[], cap = CONTENT_CAP): string[] {
  const counted = nodes.filter((n) => isContentNode(n) && !isPinned(n))
  const over = counted.length - cap
  if (over <= 0) return []
  return counted.slice(0, over).map((n) => n.id)
}

/** 界面提示用：这个 Frame 里内容模块的占用情况 */
export function contentStat(nodes: readonly CanvasNode[], cap = CONTENT_CAP): { used: number; cap: number; pinned: number } {
  let used = 0
  let pinned = 0
  for (const n of nodes) {
    if (!isContentNode(n)) continue
    if (isPinned(n)) pinned++
    else used++
  }
  return { used, cap, pinned }
}
