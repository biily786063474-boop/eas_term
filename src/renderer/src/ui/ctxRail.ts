// 双击菜单的「沿边滚动条」：进度不画成一根竖条，而是**沿着菜单自己的圆角边框走**。
//
// 用户 2026-09-02：「双击菜单的滚动的进度条沿着边缘路径从顶部右上角三分之一处起，
// 按路径走 到右边缘三分之二高度处止。」
//
// 为什么值得单独摘成纯函数：这段是几何，**画错了在界面上看不出来** ——
// 圆弧半径差一点、方向反了、终点偏几像素，看着都还是「一条沿边的线」。
// 只有把它写成能断言的坐标，才谈得上「对不对」。

export interface RailGeom {
  /** 菜单可视区宽高（不含滚动出去的部分） */
  w: number
  h: number
  /** 菜单的圆角半径（`--radius-lg`） */
  r: number
}

/**
 * 轨道的 SVG path。
 *
 * 走法（顺时针，沿边框内侧）：
 *
 *   起点：顶边上、**距右端 1/3 宽**的位置
 *     ↓ 沿顶边向右
 *   拐点：右上角的圆弧（半径 r）
 *     ↓ 沿右边向下
 *   终点：右边上、**2/3 高**的位置
 *
 * **半径要夹住**：菜单很窄或很矮时，`r` 可能大到让圆弧吃掉整条边，
 * 画出来是一段自我交叉的鬼画符。夹到「两条边各自能让出的一半」为止。
 */
export function railPath({ w, h, r }: RailGeom): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  // 起点：距右端 1/3 宽。但不能越过圆弧的起点，否则「沿顶边走」这段是负长度
  const startX = Math.min(w * (2 / 3), w - rr)
  // 终点：2/3 高。同理不能高于圆弧的结束点
  const endY = Math.max(h * (2 / 3), rr)
  return `M ${startX} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${endY}`
}

/**
 * 滑块在轨道上的位置与长度，单位是**轨道全长的比例**（0–1）。
 *
 * 直接给比例而不是像素：SVG 那侧用 `pathLength="1"` 把路径长度归一化，
 * 于是 dasharray/dashoffset 都能用同一套 0–1 的数 —— 不用去测那条曲线到底多长
 * （`getTotalLength()` 要等 DOM 挂上才能算，而这里在渲染前就要出数）。
 */
export function railThumb(scrollTop: number, scrollHeight: number, clientHeight: number): {
  /** 滑块占轨道的比例 */
  len: number
  /** 滑块起点在轨道上的比例 */
  at: number
} {
  const scrollable = scrollHeight - clientHeight
  // 不需要滚动时给一根满长的滑块 —— 比「没有滑块」更好懂：
  // 用户看到的是「就这么多，到头了」，而不是「这里本来该有个什么东西吗」
  if (scrollable <= 0) return { len: 1, at: 0 }
  // 可视比例就是滑块长度（跟原生滚动条同一套直觉）。
  // **下限 0.12**：内容极长时按比例算出来会是一根看不见的线头。
  const len = Math.max(0.12, Math.min(1, clientHeight / scrollHeight))
  const p = Math.min(1, Math.max(0, scrollTop / scrollable))
  return { len, at: p * (1 - len) }
}
