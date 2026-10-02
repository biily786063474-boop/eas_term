// 图片放大查看的纯计算：适应窗口的比例、以光标为中心缩放、拖动范围。没有 DOM，`node --test` 裸跑。
// 坐标约定：x / y 是图片中心相对舞台中心的位移（px），s 是相对原图像素的缩放。

export interface ZoomView { s: number; x: number; y: number }

export const MAX_SCALE = 8
/** 图片四周留的边，和 .image-popup 原来的 padding 一致 */
export const FIT_PAD = 48

/** 整张图放进窗口的比例；小图不放大（1:1 就是最清楚的样子） */
export function fitScale(nw: number, nh: number, vw: number, vh: number, pad = FIT_PAD): number {
  if (!(nw > 0) || !(nh > 0)) return 1
  return Math.max(0.01, Math.min(1, (vw - 2 * pad) / nw, (vh - 2 * pad) / nh))
}

/** 最小缩到适应比例的一半，最大 8 倍原图 */
export function clampScale(s: number, fit: number): number {
  return Math.min(MAX_SCALE, Math.max(fit / 2, s))
}

/** 把缩放比例改成 next，同时让 (px, py)（相对舞台中心）下面那一点不动 */
export function zoomAt(v: ZoomView, next: number, px: number, py: number): ZoomView {
  const k = next / v.s
  return { s: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
}

/** 拖动时至少留在窗口里的图片宽度（px） */
export const KEEP_VISIBLE = 80

/**
 * 拖动范围：随便拖，但每个方向至少留 KEEP_VISIBLE px 在窗口里，图不会被拖丢。
 * 不用「边缘对齐」那种严格限制：刚放大一点时图只比窗口大几十 px，严格限制会把以光标为中心的缩放拽回中间
 * （2026-10-02 真机：放大四下后光标下那一点漂了 80px）。
 */
export function clampPan(v: ZoomView, nw: number, nh: number, vw: number, vh: number): ZoomView {
  const w = nw * v.s, h = nh * v.s
  const mx = Math.max(0, (w + vw) / 2 - Math.min(KEEP_VISIBLE, w)), my = Math.max(0, (h + vh) / 2 - Math.min(KEEP_VISIBLE, h))
  return { s: v.s, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) }
}

/** 一次滚轮的缩放倍数。触控板捏合在 Chromium 里是带 ctrlKey 的小 delta，灵敏度要高一些 */
export function wheelFactor(deltaY: number, pinch: boolean): number {
  const d = Math.max(-300, Math.min(300, deltaY))
  return Math.exp(-d * (pinch ? 0.01 : 0.0015))
}

/** 按钮 / 键盘一步 */
export const STEP = 1.25
