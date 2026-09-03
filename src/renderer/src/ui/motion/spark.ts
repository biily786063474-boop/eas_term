// 双击画布时在光标处炸开的那圈白色放射短线。**纯几何 + 缓动，不碰 DOM，可单测。**
//
// 参数按用户 2026-09-03 给的规格：duration 660ms、ease-out、强度 subtle。
//
// ── 「subtle」具体是什么意思 ────────────────────────────────────────────────
// 用户给的坑：「全站包裹会让每次点击都放烟花，严肃的后台界面容易显吵。」
// 所以这里的克制体现在三处，改之前先读这段：
//   · **只在双击画布空白时放**（不是全站包裹）—— 挂点在 CanvasStage，见那里的注释；
//   · 线**短**（14px 起、随进度缩到 0）而不是长拖尾；
//   · 数量少（10 根）、透明度上限 0.7，不到全白。
// 这三个数字一起决定「有反馈」和「像烟花」之间的距离。

/** 一次迸发的规格。数字都在这儿，改效果先改这里而不是散在渲染循环里。 */
export const SPARK = {
  /** 用户给定：660ms */
  durationMs: 660,
  /** 放射线根数。**别加多** —— 12 根往上就开始像庆祝动画了 */
  count: 10,
  /** 线的起始长度（px，屏幕坐标，不随画布缩放变） */
  len: 14,
  /** 起点离光标多远：留一点空心，线从光标外圈飞出去而不是从一个点长出来 */
  inner: 6,
  /** 飞散距离（px） */
  travel: 26,
  /** 线宽 */
  width: 1.4,
  /** 透明度上限。**不到 1** —— subtle 的一半在这里 */
  alpha: 0.7
} as const

/** ease-out（用户指定）。`1 - (1-t)^3` —— 起手快、收尾慢，
 *  和「炸开然后飘散」的体感一致；用线性会显得整段都在匀速平移。 */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - (1 - c) ** 3
}

/** 一根线这一帧的两个端点（相对迸发中心的偏移，屏幕像素）。 */
export interface SparkLine {
  x1: number
  y1: number
  x2: number
  y2: number
  alpha: number
}

/**
 * 算出这一帧要画的所有线。
 *
 * @param t 归一化进度 0→1（`(now - start) / durationMs`）。
 *          **超出 [0,1] 会被夹住** —— 掉帧时 t 可能一下跳过 1，
 *          不夹的话 `1-t` 变负数，线会往回长。
 * @param seed 每次迸发的角度偏移。同一处连点两下时，两次的线不该完全重合 ——
 *             重合看着像「只放了一次」。
 */
export function sparkFrame(t: number, seed = 0): SparkLine[] {
  const p = easeOut(t)
  // 长度随进度缩到 0（用户规格：「向外飞散同时变短淡出」）
  const len = SPARK.len * (1 - p)
  const dist = SPARK.inner + SPARK.travel * p
  // 淡出用 (1-p)：线在收尾那段已经很短，再配上低透明度就消失得不突兀
  const alpha = SPARK.alpha * (1 - p)
  const out: SparkLine[] = []
  for (let i = 0; i < SPARK.count; i++) {
    const a = (i / SPARK.count) * Math.PI * 2 + seed
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    out.push({
      x1: cos * dist,
      y1: sin * dist,
      x2: cos * (dist + len),
      y2: sin * (dist + len),
      alpha
    })
  }
  return out
}

/** 这次迸发放完了没有。调用方据此停掉 rAF —— **不停会让一个空循环常驻**，
 *  而画布本来就是这个应用最吃帧的地方。 */
export function sparkDone(t: number): boolean {
  return t >= 1
}
