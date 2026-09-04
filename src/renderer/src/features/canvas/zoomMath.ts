// 画布与内容缩放的**纯数学**。零 import —— 这样它能进 `node --test`。
//
// 抽出来是因为 `wheelPassthrough.ts` 要 import store（目录 import，Node 的 ESM
// 解析器认不了），整个文件因此进不了单测。而这几个函数恰恰是**有事故史**的那部分：
// 旧的缩放公式在鼠标滚轮下会算出 0 甚至负数，表现是「往后拉一下，一步到底 20%」。
// 那种错不抛异常，只是手感忽然坏掉 —— 必须有测试钉着。

export const SCALE_MIN = 0.2
export const SCALE_MAX = 2.2
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/**
 * 一次滚轮/捏合对应的缩放倍率。**全项目只有这一份**，画布视口与最大化内容都调它。
 *
 * 抽出来是因为「触控板 vs 鼠标滚轮」这条判据是用一次事故换的（见 `zoomViewport`
 * 的注释：旧公式在滚轮下会让 scale 归零甚至变负，表现为「往后拉一下一步到底 20%」）。
 * 再写第二份的下场必然是其中一份没跟上，而症状只是「有的地方手感不一样」，很难联想到这里。
 */
export function wheelZoomFactor(e: WheelEvent): number {
  // deltaMode：0=像素（Chromium 常态）、1=行、2=页。不折算的话行/页模式下步长会小得动不了
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
  // 判据用「单次跨度是否 ≥40」：触控板再快也是连续小步，滚轮最小的一格也有 100
  const byWheel = Math.abs(dy) >= 40
  return byWheel
    ? dy > 0
      ? 1 / 1.12
      : 1.12 // 滚轮：每格固定 ±12%，与 dy 具体是 100 还是 120 无关
    : Math.exp(-dy * 0.01) // 触控板：小量下等价于旧的 (1 - dy*0.01)，手感不变，但永远为正
}

// ── 最大化之后的内容缩放 ────────────────────────────────────────────────────
//
// 最大化时画布世界整个 `visibility:hidden`，缩画布视口毫无意义 ——
// 那时候双指该缩的是**这个模块自己的显示比例**（用户 2026-09-03）。

/** 内容缩放的上下限。比画布那对（0.2~2.2）**收窄**：
 *  画布缩到 20% 是为了看全局，而最大化时人是在读内容 —— 缩到 20% 只剩一团糊。 */
export const CONTENT_MIN = 0.5
export const CONTENT_MAX = 3

/** 最大化的模块被捏合一次之后，显示比例该是多少。
 *
 *  ⚠️ **测这条路时别用 CDP 的 `Input.dispatchMouseEvent`。** 它发的滚轮走渲染进程
 *  路由，落在 `<webview>` 上会被 guest 截走，测出来是「宿主一个事件都收不到」——
 *  据此会得出「双指对 HTML 节点无效」的错误结论（2026-09-03 我就是这么错了一次）。
 *  真实触控板捏合是 Chromium 在**合成器层**转成 ctrl+wheel 发给顶层页面的，
 *  不进 webview。要测就用 `Input.synthesizePinchGesture`。
 *
 *  **不带锚点**：内容是铺满的，按光标锚定会让文字往边上跑，而这里要的是「放大来读」。 */
export function zoomContent(cur: number, e: WheelEvent): number {
  return clamp(cur * wheelZoomFactor(e), CONTENT_MIN, CONTENT_MAX)
}

/** 把一个显示比例夹进合法区间。键盘那条（⌘+/⌘-）用它 —— **和捏合共用同一对上下限**，
 *  两条路走出不同的范围会让人以为其中一条坏了。 */
export function clampContent(v: number): number {
  return clamp(v, CONTENT_MIN, CONTENT_MAX)
}

/**
 * 一次滚轮该把视口缩放到哪。**全项目只有这一份缩放算法** —— CanvasStage 的画布视口
 * 和这里的浮层穿透都调它。
 *
 * 曾经是两份：这边写着 `scale * (1 - deltaY * 0.01)`，CanvasStage 那边早就修好了、
 * 这边没跟上。那条旧公式是照着 macOS 触控板写的（捏合时 deltaY 是 ±1~10 的连续小值，
 * 乘出来 0.9~1.1，很顺），但鼠标滚轮**一格就是 100 或 120**：
 *   dy=100 → 1 - 1.0 = 0     → scale 归零，被 clamp 拉到 SCALE_MIN(20%)
 *   dy=120 → 1 - 1.2 = -0.2  → 负数，同样掉到 20%
 * 表现就是「往后拉一下，一步到底 20%」。
 *
 * @param rect 画布视口的 getBoundingClientRect()，用来把鼠标位置换算成视口内坐标
 */
export function zoomViewport(
  e: WheelEvent,
  rect: DOMRect,
  cur: { scale: number; x: number; y: number }
): { scale: number; x: number; y: number } {
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  // deltaMode：0=像素（Chromium 常态）、1=行、2=页。不折算的话行/页模式下步长会小得动不了
  const s2 = clamp(cur.scale * wheelZoomFactor(e), SCALE_MIN, SCALE_MAX)
  return {
    scale: s2,
    x: px - (px - cur.x) * (s2 / cur.scale),
    y: py - (py - cur.y) * (s2 / cur.scale)
  }
}

