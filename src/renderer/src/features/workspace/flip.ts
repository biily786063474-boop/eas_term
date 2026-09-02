// 最大化 / 还原的「丝滑放大」动画。做法是 **FLIP**（First-Last-Invert-Play）。
//
// 用户 2026-09-02：「所有的全屏都要有丝滑的放大动画，缩小也有，
// 类似于苹果的最大化动画。」
//
// ── 为什么必须是 FLIP，不能直接给 left/top/width/height 加 transition ──────
// 那四个属性每一帧都触发**布局 → 绘制 → 合成**三步，而节点里装的是终端、
// 编辑器、画布这些重内容 —— 每帧重排一次，动画必然掉帧，
// 而且 xterm 那种会按容器尺寸重算字符网格，动画期间字会一直跳。
//
// FLIP 的做法是：**布局一步到位（瞬间变成终态），只用 transform 把视觉"倒推"回起点，
// 再让它跑回 identity**。整个过程只动 transform/opacity —— 这两样走合成层，不触发布局。
// 这也是 `check-animations.mjs` 那道闸的要求。

/** FLIP 用的矩形。**刻意不叫 `Rect`** —— 项目里已经有一个同名类型
 * （`PaneLayer` 的布局矩形，字段不同），撞名会让编译器把两者混起来。 */
export interface FlipRect {
  left: number
  top: number
  w: number
  h: number
}

/**
 * 算出「把终态倒推回起点」的那个 transform。
 *
 * 元素此刻已经在 `to` 的位置和尺寸上（布局已经生效），我们要让它**看起来**
 * 还在 `from`：先平移到起点，再缩到起点的比例。
 *
 * `transform-origin` 必须是 `0 0` —— 默认的 `50% 50%` 会让缩放绕中心发生，
 * 平移量就得连带补偿中心点的偏移，算出来的公式又长又容易错。
 */
export function invertTransform(from: FlipRect, to: FlipRect): string {
  // 终态尺寸为 0 时（元素还没布局出来）不做倒推 —— 除以 0 会得到 Infinity，
  // 浏览器会把整条 transform 判为无效，动画直接不发生。
  const sx = to.w > 0 ? from.w / to.w : 1
  const sy = to.h > 0 ? from.h / to.h : 1
  const dx = from.left - to.left
  const dy = from.top - to.top
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
}

/** 两个矩形几乎一样时不必动画 —— 硬跑一遍只会闪一下。 */
export function sameRect(a: FlipRect, b: FlipRect, tol = 1): boolean {
  return (
    Math.abs(a.left - b.left) < tol &&
    Math.abs(a.top - b.top) < tol &&
    Math.abs(a.w - b.w) < tol &&
    Math.abs(a.h - b.h) < tol
  )
}

/** 苹果那条最大化曲线的近似：**起步快、收尾慢、不回弹**。
 *
 *  不用 `ease-out`（太平）也不用带回弹的 spring（窗口最大化回弹会显得轻浮）——
 *  这条的后半段拖得比 ease-out 长，落位时有「稳住」的感觉。 */
export const FLIP_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

/** 时长。**放大比缩小略长**：放大是「展开给你看」，值得多一点时间；
 *  缩小是「收回去」，拖沓反而碍事。 */
export const FLIP_MS = { grow: 320, shrink: 260 }
