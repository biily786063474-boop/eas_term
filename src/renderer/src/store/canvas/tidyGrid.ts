// 整理排列时把模块摆成**宫格**，而不是一整列。
//
// **纯函数，`node --test` 直接跑。** 抽出来的理由和 tidyOrder 一样：摆错了不会崩，
// 只表现成「整理完还是一列」这类手感问题，靠肉眼在真机上试不全（尤其模块宽窄不一时）。
//
// ── 为什么会排成一整列（用户 2026-09-05 报的）────────────────────────────
// 老逻辑的行宽是 `max(frame.w - 2·PAD, 最宽模块)`：一旦 Frame 被裹窄了（而整理成列
// 之后 reflowSeparate 正好把它裹成窄条），行宽就只够放一个模块 → 下次整理又是一列，
// 越整越窄。行宽**不该跟着 frame.w 走** —— 它该由「想排成几列」决定。
//
// ── 目标列数：接近正方形 ────────────────────────────────────────────────
// 经典宫格用 ceil(√n) 列。但模块宽窄不一，纯按个数会让宽模块那几行溢出，
// 所以列数定了之后，行宽取「最宽的 cols 个模块之和」——保证那一行真放得下，
// 又不会宽到把窄模块也摊成一行。
//
// 保留老逻辑对的那部分：**按 tidyOrder 定好的顺序**逐个塞、按行折叠、每行高度取行内最高。

/** 摆放用到的最小字段。w/h 是模块尺寸，id 用来回填坐标。 */
export interface GridNode {
  id: string
  w: number
  h: number
}

export interface GridOpts {
  gap: number
  /** 左上角起点（相对 Frame 内容区） */
  startX: number
  startY: number
  /** 用户手动指定的列数上限；不给就按 √n 求接近正方形 */
  maxCols?: number
}

/** 给这批模块（已按 tidyOrder 排好序）算出宫格坐标。 */
export function gridPlace(order: readonly GridNode[], opts: GridOpts): Map<string, { x: number; y: number }> {
  const { gap, startX, startY } = opts
  const placed = new Map<string, { x: number; y: number }>()
  const n = order.length
  if (n === 0) return placed

  // 目标列数：接近正方形，且不超过模块数。maxCols 给了就听它的（但仍夹在 [1, n]）。
  // **ceil 不是 round**：round(√2)=1 会把 2 个模块排成一列（用户报的那个），
  // ceil 保证 n≥2 时至少 2 列，倾向宫格。
  const target = opts.maxCols ?? Math.ceil(Math.sqrt(n))
  const cols = Math.min(n, Math.max(1, target))

  // 行宽 = 最宽的 cols 个模块之和（含间隔）。**这才是「排成几列」的真实宽度** ——
  // 用平均宽会让一堆宽模块挤成一行放不下，用最宽单个又会把窄模块也逼成一列。
  const widths = order.map((x) => x.w).sort((a, b) => b - a)
  const rowW = widths.slice(0, cols).reduce((s, w) => s + w + gap, 0) - gap

  let x = startX
  let y = startY
  let rowH = 0
  for (const node of order) {
    // 换行：已经放了东西，且再放这个会超过行宽
    if (x > startX && x + node.w > startX + rowW) {
      x = startX
      y += rowH + gap
      rowH = 0
    }
    placed.set(node.id, { x, y })
    x += node.w + gap
    rowH = Math.max(rowH, node.h)
  }
  return placed
}
