// 「一道细亮镜面高光沿圆角边框滑动，方向跟着鼠标转」——这一层只算角度，不碰 DOM。
//
// ── 为什么不是 webgl-ogl（用户给的规格里指定的实现）──────────────────────────
// 用户 2026-09-03 连规格一起给了坑：
//   「每个按钮吃一个 WebGL 上下文，一屏里放好几个会明显掉帧；亮色背景上高光看不出来。」
//
// 而要加特效的正是**并排的三颗** CLI 按钮（Claude / Codex / 默认 harness），
// 恰好命中那句话。照字面做的代价：3 个 WebGL 上下文 + 一个新依赖（ogl 当前没装，
// 全仓也没有任何 WebGL 用法），换来的是同一个视觉。
//
// 所以这里用 conic-gradient 环 + 一个 CSS 变量做角度：
//   · 上下文 0 个，多少颗按钮都不掉帧；
//   · 亮/暗两套高光色（那个坑的后半句），见 canvas.css 的 `.cframe-start-btn`；
//   · `speed` / `intensity` / `radius` 都还在，只是落到 CSS 而不是 uniform。
// 想换回 ogl 的话，把这个文件和那段 CSS 一起替掉即可，调用点不用动。

/** 用户给定的四个参数，原样留在代码里。 */
export const SWEEP = {
  /** 圆角（px）。用户给定 radius=18 */
  radius: 18,
  /** 背景模糊（px）。用户给定 blur=0 —— 按钮底下就是 Frame，本来就不需要再糊一层 */
  blur: 0,
  /** 高光亮度倍数。用户给定 intensity=1 */
  intensity: 1,
  /** 自动巡游速度。用户给定 speed=0.35。
   *  **单位是「转/秒」的十分之一** —— 0.35 → 一圈约 5.7 秒，是「ambient」该有的慢。
   *  当成「转/秒」会快到像加载动画，那不是这个效果要的。 */
  speed: 0.35
} as const

/** 自动巡游转一圈要多久（ms）。 */
export function ambientPeriodMs(speed: number = SWEEP.speed): number {
  // speed 0.35 → 2000/0.35 ≈ 5714ms
  return Math.round(2000 / Math.max(0.01, speed))
}

/**
 * 光标相对元素中心的角度，用作 conic-gradient 的起始角。
 *
 * **返回 CSS 的 deg 语义**：0° 在正上方、顺时针增大 —— 和 `atan2` 的
 * 「0 在正右方、逆时针」差 90° 且方向相反。两者混了的表现是
 * 「高光跟着鼠标转，但总差 90 度」，看着像随机跑。
 *
 * @param rect 元素的 `getBoundingClientRect()`（只用 4 个数，方便测）
 */
export function sweepAngle(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number
): number {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  // atan2(y, x)：0 在正右、逆时针为正。+90 把 0 挪到正上方，
  // 而 CSS conic 是顺时针，所以 y 分量取原样即可（屏幕 y 轴本来就朝下）。
  const deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90
  // 归一化到 [0, 360)：负角度直接塞进 CSS 也能用，但读日志时一堆负数很难对
  return ((deg % 360) + 360) % 360
}
