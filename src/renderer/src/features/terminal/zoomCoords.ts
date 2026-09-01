// 画布缩放下，把鼠标坐标校正回「未缩放」的坐标系 —— 否则终端里点哪都偏。
//
// ## 为什么需要
//
// 画布上的面板靠 CSS `transform: scale()` 放大（见 PaneView 的「真缩放」注释）。
// 而 xterm 换算「点在第几行第几列」的算式是（@xterm/xterm 5.5.0，getCoordsRelativeToElement）：
//
//     [event.clientX - rect.left - paddingLeft, ...]   然后再除以 cellWidth
//
// `rect` 来自 getBoundingClientRect()，**含变换**；`cellWidth` 与 `padding` 都**不含变换**。
// 于是算出来的行列号恰好被放大了 scale 倍 —— 缩放 1.3 时点第 10 行会选中第 13 行。
// 纵向先被发现，是因为行比列窄，偏几行就跨过一整行。
//
// ## 这个 bug 复发过一次
//
// 2026-07-23 `d716139` 修过（当时改成字体缩放，让 rect 与字符尺寸同步）；
// 2026-08-30 `f46b573` 改成真缩放，那条修复连同终端的特殊分支一起被移除，bug 回来了。
// 那次改动做了 A/B 画质测量，但**只验了「糊不糊」，没验「点得准不准」** ——
// 给终端开特殊分支本来有两个理由，只记住了一个。
//
// 所以这一版不改布局方案（真缩放的比例恒定、手势不跳、GPU 不重建都要保住），
// 只在事件进入 xterm 之前把坐标校正回去，并用单测钉住换算本身。
// **动 PaneView 的 transform 之前，先看这里。**

/**
 * 从元素自身反推当前的实际缩放比。
 *
 * 用 `rect.width / offsetWidth` 而不是读 store 里的 viewport.scale：
 * offsetWidth 是**布局宽度**（不含变换），rect.width 是**变换后**的宽度，比值就是实际缩放。
 * 这样最大化（无变换）、嵌套变换、以后换别的缩放方案，都不用改这里。
 */
export function scaleOf(rectWidth: number, offsetWidth: number): number {
  if (!offsetWidth || !Number.isFinite(rectWidth) || !Number.isFinite(offsetWidth)) return 1
  const s = rectWidth / offsetWidth
  // 极端值当作没缩放：0 或负数是元素还没布局好，过大多半是量到了坏值
  if (!Number.isFinite(s) || s <= 0 || s > 100) return 1
  return s
}

/**
 * 把一个屏幕坐标校正成「元素没有被缩放时，它会落在哪」。
 *
 * @param client   事件的 clientX / clientY
 * @param rectEdge 元素 rect 的 left / top（屏幕坐标，含变换）
 * @param scale    实际缩放比
 */
export function unscaleClient(client: number, rectEdge: number, scale: number): number {
  if (scale === 1) return client
  return rectEdge + (client - rectEdge) / scale
}

/** 缩放比是否近似 1（近似即可跳过校正，省掉每次事件的两次除法） */
export function isUnscaled(scale: number): boolean {
  return Math.abs(scale - 1) < 0.001
}
