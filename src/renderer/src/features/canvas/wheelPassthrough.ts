// 画布上「浮在 canvas-viewport 之外的那些层」的滚轮穿透。
//
// 为什么需要它：活终端在 PaneLayer、用户画的标记在 CanvasShapeLayer，两者都是
// .canvas-viewport 的**兄弟**节点，滚轮落在它们上面时事件传不到画布视口去 ——
// 于是鼠标一挪到终端或标记上，画布就滚不动、缩不了。
//
// 约定（沿用 PaneView 早就定下的那条）：**没选中就把滚轮拿去驱动画布**，
// 选中了才放行给内容（终端的 scrollback、便签的长文本）。
// 提成共用是因为现在有两处要它 —— 各写一份的话，以后改缩放手感就得改两个地方，
// 而漏改的那个只会表现成「有的地方缩放手感不一样」，很难联想到这里。
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useStore } from '../../store'

/** 把这一次滚轮拿去驱动画布视口：ctrl 是以光标为锚点缩放，否则平移。 */
function driveCanvas(e: WheelEvent): void {
  e.preventDefault()
  e.stopPropagation()
  const cur = useStore.getState().canvas.viewport
  const setViewport = useStore.getState().setViewport
  if (e.ctrlKey) {
    const vp = document.querySelector('.canvas-viewport')?.getBoundingClientRect()
    if (!vp) return
    const px = e.clientX - vp.left
    const py = e.clientY - vp.top
    const s2 = Math.min(2.2, Math.max(0.2, cur.scale * (1 - e.deltaY * 0.01)))
    setViewport({
      scale: s2,
      x: px - (px - cur.x) * (s2 / cur.scale),
      y: py - (py - cur.y) * (s2 / cur.scale)
    })
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
      if (releaseRef.current(e)) return
      driveCanvas(e)
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [ref, enabled])
}
