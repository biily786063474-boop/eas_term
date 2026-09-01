// 画布上「浮在 canvas-viewport 之外的那些层」的滚轮穿透。
//
// 为什么需要它：活终端在 PaneLayer、用户画的标记在 CanvasShapeLayer，两者都是
// .canvas-viewport 的**兄弟**节点，滚轮落在它们上面时事件传不到画布视口去 ——
// 于是鼠标一挪到终端或标记上，画布就滚不动、缩不了。
//
// 约定（沿用 PaneView 早就定下的那条，2026-08-31 拆成两半）：
//   · **平移**：没选中就把滚轮拿去驱动画布，选中了才放行给内容
//     （终端的 scrollback、便签的长文本）。
//   · **缩放**：永远驱动画布，不看选中 —— 见下方 onWheel 里的说明。
// 提成共用是因为现在有两处要它 —— 各写一份的话，以后改缩放手感就得改两个地方，
// 而漏改的那个只会表现成「有的地方缩放手感不一样」，很难联想到这里。
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useStore } from '../../store'

export const SCALE_MIN = 0.2
export const SCALE_MAX = 2.2
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

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
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
  // 判据用「单次跨度是否 ≥40」：触控板再快也是连续小步，滚轮最小的一格也有 100
  const byWheel = Math.abs(dy) >= 40
  const factor = byWheel
    ? dy > 0
      ? 1 / 1.12
      : 1.12 // 滚轮：每格固定 ±12%，与 dy 具体是 100 还是 120 无关
    : Math.exp(-dy * 0.01) // 触控板：小量下等价于旧的 (1 - dy*0.01)，手感不变，但永远为正
  const s2 = clamp(cur.scale * factor, SCALE_MIN, SCALE_MAX)
  return {
    scale: s2,
    x: px - (px - cur.x) * (s2 / cur.scale),
    y: py - (py - cur.y) * (s2 / cur.scale)
  }
}

/** 把这一次滚轮拿去驱动画布视口：ctrl 是以光标为锚点缩放，否则平移。 */
function driveCanvas(e: WheelEvent): void {
  e.preventDefault()
  e.stopPropagation()
  const cur = useStore.getState().canvas.viewport
  const setViewport = useStore.getState().setViewport
  if (e.ctrlKey) {
    const vp = document.querySelector('.canvas-viewport')?.getBoundingClientRect()
    if (!vp) return
    setViewport(zoomViewport(e, vp, cur))
  } else {
    setViewport({ x: cur.x - e.deltaX, y: cur.y - e.deltaY })
  }
}

/**
 * 在 `ref` 上挂一个 capture 阶段的滚轮监听，把「不该归内容的滚轮」交给画布。
 *
 * @param enabled     false 时整个不挂（比如不在画布模式、或看板模式 —— 看板没有可平移的画布，
 *                    挂上去会一边吃掉 scrollback 一边偷偷平移画布视口，切回画布才发现画面跑了）
 * @param shouldRelease 返回 true = 这一次放行给内容（选中了 / 最大化了），false = 拿去驱动画布。
 *                    传事件进来是因为一层里可能有多个元素（标记层），要按落点判断是哪一个。
 *
 * **必须 `passive: false`**，否则 preventDefault 无效、页面照旧滚。
 */
export function useCanvasWheelPassthrough(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  shouldRelease: (e: WheelEvent) => boolean
): void {
  // shouldRelease 每次渲染都是新函数，放进依赖会让监听反复重挂；但它读的是
  // props/state（PaneView 那边读 maximized 与 selKey），直接排除依赖就成了陈旧闭包、
  // 读到的是挂载那一刻的旧值。所以用 ref 每次渲染刷新，监听本身只挂一次。
  const releaseRef = useRef(shouldRelease)
  releaseRef.current = shouldRelease

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const onWheel = (e: WheelEvent): void => {
      // **缩放永远归画布** —— ctrl+滚轮 / 触控板捏合表达的是「看远看近」，对整块画布而言，
      // 光标恰好停在哪个终端或标记上是偶然。只有平移才问 shouldRelease。
      // 这条跟 CanvasStage 里那份 onWheel 是同一个约定，**改一处必须改另一处**，
      // 否则会出现「画布空白处能缩、鼠标移到终端上就缩不动」这种更难查的分裂。
      if (!e.ctrlKey && releaseRef.current(e)) return
      driveCanvas(e)
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [ref, enabled])
}
