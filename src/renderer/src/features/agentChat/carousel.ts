// 角色轮播的**判断层**：翻页、边界阻尼、倾斜角。纯函数，零 DOM，可单测。
//
// 抽出来的理由和 `codegraph/radial.ts` 一样：这些判断错了的表现很隐蔽 ——
// 图还是画得出来，只是「拖到头还能拖走」「翻页差一格」这类手感问题，
// 靠肉眼在真机上试是试不全的（边界那几格恰恰最难手动复现）。

/** 拖多远算「翻一页」。太小会误翻（手一抖就换角色），太大则拖着费劲。 */
export const SWIPE_PX = 56

/** 超过这个位移才认作「在拖」。
 *
 *  **它不只是防抖，是个真 bug 的修法**：一按下就 `setPointerCapture`，
 *  浏览器会把随后的 click 派发到捕获元素（那张卡）而不是按钮上 ——
 *  于是卡里那颗「用这个角色」按钮永远点不动。
 *  所以捕获推迟到真的移动了才做，没超过阈值的那一下就是一次普通点击。 */
export const DRAG_MIN = 4

/** 拖动时卡片跟着倾斜的最大角度。
 *  **2026-09-05 起 RolePicker 改成轨道式平移，不再用倾斜**（整条长轨 rotate 会把
 *  远端卡片甩很远）。`tiltFor` 与这个常量暂时留着——纯函数、有测试、零成本，
 *  哪天想给某张卡加回单卡倾斜可以直接用。 */
export const TILT_MAX = 3.2

/** 拖到头之后继续拖的阻尼系数。能拖一点，但明显拖不动 ——
 *  那一下手感就是「到头了」。0 会让卡片纹丝不动（像卡死了），1 等于没有边界。 */
const EDGE_DAMP = 0.28

/** 把索引夹在 [0, len-1]。**不循环** —— 循环会让「我翻到哪了」失去边界感，
 *  而圆点指示的意义正是「一共几个、现在第几个」。 */
export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0
  return Math.min(len - 1, Math.max(0, i))
}

/**
 * 手指移动了 `raw` px，卡片实际该偏移多少。
 * 在第一张往右拖、或最后一张往左拖时施加阻尼。
 */
export function dragOffset(raw: number, idx: number, len: number): number {
  const atStart = raw > 0 && idx <= 0
  const atEnd = raw < 0 && idx >= len - 1
  return atStart || atEnd ? raw * EDGE_DAMP : raw
}

/** 位移对应的倾斜角（度），夹在 ±TILT_MAX。 */
export function tiltFor(dx: number): number {
  return Math.max(-TILT_MAX, Math.min(TILT_MAX, dx / 18))
}

/**
 * 松手时落到哪一张。
 *
 * 注意方向：**往左拖（dx 为负）是看下一张** —— 卡片跟着手往左走，
 * 右边那张被带进来。写反了的表现是「滑动方向和内容方向相反」，
 * 手感上非常别扭但看截图完全看不出来。
 */
export function settleIndex(idx: number, dx: number, len: number): number {
  if (dx <= -SWIPE_PX) return clampIndex(idx + 1, len)
  if (dx >= SWIPE_PX) return clampIndex(idx - 1, len)
  return clampIndex(idx, len) // 没到阈值：留在原地，弹回去
}
