// 节点连线图的布局。**纯几何，不碰 DOM，可单测。**
//
// ── 为什么是环形而不是力导向 ────────────────────────────────────────────────
// 力导向好看，但对这个用途有三个硬伤：
//   ① **不确定**：同一份数据每次跑出来不一样，用户下次打开找不到上次看的那块地；
//   ② 要跑模拟，节点一多就掉帧，而画布上还有终端和网页节点在争帧；
//   ③ 它优化的是「看起来不重叠」，而这里要回答的是「**谁和谁连**」——
//      环形把所有节点摊在一圈上，任意两点之间的弦一眼可见，正好对上。
//
// 环上的顺序不是随便排的：**同一个风险等级的排在一起**，
// 于是「红区之间的连线」和「红区连到绿区的线」在图上是两种一眼能分的形状。

export interface RadialNode {
  id: string
  /** 节点大小的依据（文件数 / 度数），用来定半径 */
  weight: number
  /** 排序分组用（风险等级）。同组的在环上相邻 */
  group: string
}

export interface PlacedNode extends RadialNode {
  x: number
  y: number
  /** 画多大（px 半径） */
  r: number
  /** 这个节点在环上的角度（弧度），标签朝向要用 */
  angle: number
}

/** 圆的半径占可用尺寸的比例。留出边距给标签 —— 标签写在圆外侧。 */
const RING = 0.34
/** 节点半径的上下限（px）。**下限不能太小**：太小的点点不中，也读不出它是个节点。 */
const R_MIN = 5
const R_MAX = 17

/**
 * 把节点摆在一个环上。
 *
 * @param nodes 待摆放的节点
 * @param w/h   可用画布尺寸
 * @param groupOrder 分组的先后（如风险等级由重到轻）。不在名单里的排最后。
 */
export function radialLayout(
  nodes: readonly RadialNode[],
  w: number,
  h: number,
  groupOrder: readonly string[] = []
): PlacedNode[] {
  if (!nodes.length) return []
  const cx = w / 2
  const cy = h / 2
  const ring = Math.min(w, h) * RING

  const rank = (g: string): number => {
    const i = groupOrder.indexOf(g)
    return i < 0 ? groupOrder.length : i
  }
  // 同组相邻；组内按 weight 从大到小，让大节点落在组的起始处，读起来有节奏
  const sorted = [...nodes].sort(
    (a, b) => rank(a.group) - rank(b.group) || b.weight - a.weight || a.id.localeCompare(b.id)
  )

  const maxW = Math.max(...sorted.map((n) => n.weight), 1)
  return sorted.map((n, i) => {
    // 从正上方开始、顺时针排 —— 和读钟表一致
    const angle = (i / sorted.length) * Math.PI * 2 - Math.PI / 2
    return {
      ...n,
      angle,
      x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring,
      // 面积正比于 weight（不是半径正比）—— 半径正比会让大节点看起来夸张好几倍，
      // 人眼读的是面积。
      r: R_MIN + (R_MAX - R_MIN) * Math.sqrt(n.weight / maxW)
    }
  })
}

/**
 * 两个节点之间的连线路径（二次贝塞尔，控制点拉向圆心）。
 *
 * **弯向圆心**是有意的：直线会让对角的两条线在中间叠成一片；
 * 弯进去之后每条弦各走各的弧，密的地方也分得开。
 *
 * `bend` 越大越弯。0 = 直线（相邻节点用小值，否则会弯出一个多余的鼓包）。
 */
export function chordPath(a: PlacedNode, b: PlacedNode, cx: number, cy: number, bend = 0.55): string {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const qx = mx + (cx - mx) * bend
  const qy = my + (cy - my) * bend
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}

/** 标签往圆外挪一点，别压在节点上。返回锚点与对齐方式。 */
export function labelAt(
  n: PlacedNode,
  cx: number,
  cy: number,
  gap = 8
): { x: number; y: number; anchor: 'start' | 'end' | 'middle' } {
  const dx = n.x - cx
  const dy = n.y - cy
  const len = Math.hypot(dx, dy) || 1
  const x = n.x + (dx / len) * (n.r + gap)
  const y = n.y + (dy / len) * (n.r + gap)
  // 左半边的标签右对齐、右半边左对齐 —— 让文字始终朝外展开，不越过节点
  // 正上/正下那几个用居中，否则会看到标签突然跳边
  const anchor = Math.abs(dx) < len * 0.25 ? 'middle' : dx > 0 ? 'start' : 'end'
  return { x, y, anchor }
}

/** 连线粗细。**用对数**：跨界依赖的条数跨度很大
 *  （这个仓库里从 1 到 160），线性映射会让小的那些细到看不见。 */
export function linkWidth(count: number, max: number): number {
  if (max <= 1) return 1
  return 0.6 + (Math.log(count + 1) / Math.log(max + 1)) * 3.4
}

// ── 磁吸 ────────────────────────────────────────────────────────────────────
//
// 悬停时节点朝指针**轻微**靠过去，像 macOS 里那种磁吸按钮。
// 纯几何，抽出来是因为它有两个一写就错的地方：
//   · 没有上限的话，指针停在圆边缘时节点会被拽出老远（位移和距离成正比）
//   · 没有衰减的话，指针刚进命中区节点就跳一下 —— 命中区比圆大一圈，
//     那一跳发生在指针还没碰到圆的时候，看着像图在抖

/** 磁吸的最大位移（px）。**很小** —— 它是「这个能点」的暗示，不是一个动画。 */
export const MAGNET_MAX = 5
/** 超过这个距离就不再吸（px）。和命中区半径同量级。 */
const MAGNET_RANGE = 26

/**
 * 节点该朝指针偏多少。
 *
 * @param dx/dy 指针相对节点中心的偏移
 * @returns 位移向量，**长度不超过 `MAGNET_MAX`**
 */
export function magnetOffset(dx: number, dy: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy)
  if (d < 0.001) return { x: 0, y: 0 }
  // 距离越远吸得越弱，出了范围就是 0 —— 线性衰减读起来最自然，
  // 用平方衰减的话靠近时会「粘住」，反而像卡了一下
  const strength = Math.max(0, 1 - d / MAGNET_RANGE)
  const k = (Math.min(d, MAGNET_MAX) * strength) / d
  return { x: dx * k, y: dy * k }
}
