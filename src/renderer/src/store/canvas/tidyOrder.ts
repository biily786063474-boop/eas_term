// Frame 整理时模块的排列顺序。
//
// 单独一个文件是为了能测 —— 排序规则写错了不会崩、不会报错，
// 只会表现成「整理完终端不在第一行」，那种错肉眼要盯着看才发现。
// 不引 React / electron / store，`node --test` 直接加载。

/** 排序只认这三个字段，不需要完整的 CanvasNode */
export interface TidyNode {
  leafId?: string
  pane?: unknown
  component?: unknown
  x: number
  y: number
}

/**
 * 这个节点是不是**活终端**。
 *
 * `CanvasNode` 有三种形态，靠字段区分（见 store/canvas/types.ts）：
 *   · `leafId` 且无 pane/component → 活终端（内容由 PaneLayer 渲染）
 *   · `pane`                        → 文件类预览（代码/图片/网页）
 *   · `component`                   → 画布组件（版本管理等）
 */
export const isTerminalNode = (n: TidyNode): boolean => !!n.leafId && !n.pane && !n.component

/**
 * 整理时的排列顺序：**终端优先**，其余模块跟在后面；同一档内按阅读顺序（先上后左）。
 *
 * 为什么终端优先：Frame 是「一个项目的工作台」，终端是你真正在里面干活的那一个，
 * 其余是资料。整理之后第一眼该落在能干活的地方，而不是满 Frame 找终端在哪。
 *
 * 为什么同档内仍按阅读顺序：那是用户自己摆出来的相对位置，整理只该消除散乱，
 * 不该把他记住的先后也一起打乱。
 *
 * 返回新数组，不改入参。
 */
export function tidyOrder<T extends TidyNode>(nodes: readonly T[]): T[] {
  return [...nodes].sort(
    (a, b) => Number(isTerminalNode(b)) - Number(isTerminalNode(a)) || a.y - b.y || a.x - b.x
  )
}
