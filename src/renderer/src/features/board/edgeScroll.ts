// 拖着卡片停在边缘 → 自动滚。**纯函数**，因为「滚多快」是这件事唯一容易做错的地方：
// 太慢等于没有，太快会冲过头，而这两种都只有真的拖一次才发现。
//
// ── 为什么需要它 ────────────────────────────────────────────────
// 看板一屏正好四列，列多了往右滑。没有自动滚的话，把卡片从第 1 列拖到第 6 列
// 是**做不到的**：手一直按着，没有第二只手去滚横向条。
//
// ── 判据：指针离边缘多近 ─────────────────────────────────────────
// 不用「碰到边缘才滚」——那样必须精确压在最后几像素上，拖拽本来就不好瞄准。
// 给一条 `zone` 宽的感应带，越靠边越快（线性），带外为 0。

/** 感应带宽度。比卡片的一半窄一点 —— 再宽的话，正常往边上那一列放卡片
 *  也会触发滚动，反而碍事。 */
export const EDGE_ZONE = 56
/** 每帧最多滚多少像素。按 60fps 算大约 900px/秒 —— 快到能跨几列，
 *  又慢到眼睛跟得上（跟不上就会过头，然后来回找）。 */
export const MAX_STEP = 15

/**
 * 这一帧该滚多少。
 *
 * @param pos   指针在这条轴上的位置（clientX 或 clientY）
 * @param start 容器这条轴的起点（rect.left / rect.top）
 * @param end   容器这条轴的终点（rect.right / rect.bottom）
 * @returns 负数 = 往回滚，正数 = 往前滚，0 = 不滚
 */
export function edgeStep(pos: number, start: number, end: number, zone = EDGE_ZONE, max = MAX_STEP): number {
  // 容器比感应带还窄 → 整条都在带里，那就没有「边缘」可言了，不滚
  if (end - start <= zone * 2) return 0
  const fromStart = pos - start
  const fromEnd = end - pos
  // **指针在容器外也要滚**（fromStart < 0）：手拖出界是很常见的动作，
  // 这时候停下来反而像卡住了。夹到满速。
  // `|| 0` 是为了把 **`-0` 归一成 `0`**：感应带最外沿算出来正好是 -0，
  // 而 `-0 < 0` 是 false、`Object.is(-0, 0)` 也是 false ——
  // 调用方拿它做「要不要滚」的判断时会得到反直觉的结果
  if (fromStart < zone) return -Math.round(max * Math.min(1, (zone - fromStart) / zone)) || 0
  if (fromEnd < zone) return Math.round(max * Math.min(1, (zone - fromEnd) / zone)) || 0
  return 0
}
