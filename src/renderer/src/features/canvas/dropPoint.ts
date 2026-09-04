// 「屏幕上的一个点」→「Frame 内的插入坐标」。
//
// **零 import，可 `node --test`。**
//
// ── 为什么抽出来 ────────────────────────────────────────────────────────
// 插入组件有两条路：从抽屉拖进来、在 Frame 里右键插入。两条路要落在同一个地方，
// 否则「拖进去」和「右键插入」对同一个光标位置给出不同结果，用起来像有 bug。
// 这段换算原本只在 CanvasDrawer 里有一份，右键那条抄一遍必然漂
// （画布缩放那套就是抄了两份，一边修好了另一边一直没跟上，见 zoomMath.ts 的文件头）。

/** 光标咬在节点标题栏上的偏移。
 *  横向以组件**中心**对齐光标，纵向让光标落在标题栏里 ——
 *  这样"松手/点下去的地方"就是"这个节点的抓手"，位置感是连续的。 */
const TITLE_GRAB = 14

export interface Viewport {
  x: number
  y: number
  scale: number
}

/**
 * @param client   鼠标的 clientX / clientY
 * @param rect     `.canvas-viewport` 的 getBoundingClientRect（只用 left / top）
 * @param vp       画布视口（平移 ＋ 缩放）
 * @param frame    目标 Frame 的世界坐标左上角
 * @param width    要插入的节点宽度（用来做水平居中）
 * @returns 相对 Frame 左上角的插入点
 */
export function insertPointInFrame(
  client: { x: number; y: number },
  rect: { left: number; top: number },
  vp: Viewport,
  frame: { x: number; y: number },
  width: number
): { px: number; py: number } {
  // **先减平移再除缩放，顺序不能反** —— viewport.x/y 是屏幕像素的平移量，
  // 不是世界坐标的平移量。反过来写在 scale=1 时看不出错，缩放后偏得越来越远。
  const wx = (client.x - rect.left - vp.x) / vp.scale
  const wy = (client.y - rect.top - vp.y) / vp.scale
  return { px: wx - frame.x - width / 2, py: wy - frame.y - TITLE_GRAB }
}
