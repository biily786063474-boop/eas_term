// 最大化 / 还原的丝滑动画，**四个可最大化的模块共用这一份**。
//
// 用户 2026-09-02：「所有的全屏都要有丝滑的放大动画，缩小也有，类似于苹果的最大化动画。」
// 用户 2026-09-07：「frame 中所有可以最大化窗口都要统一的放大缩小过度动效。」
//
// 后一句是因为**当时只有 `PaneView`（终端 / AI 对话）有**，而画布上的三个节点
// —— 文件预览、画布组件、自由节点 —— 最大化时是瞬移。逻辑当初内联在 PaneView 里，
// 想给另外三个用只能抄，于是抽成这个 hook：**几何在 `flip.ts`（纯函数有测试），
// 时序与判据在这里，调用方只负责给一个矩形。**
//
// 加第五个可最大化的模块时用这个 hook，别再抄一份 —— 抄出来的第一天是一样的，
// 改过一次曲线或阈值之后就不一样了，而症状只是「有的窗口手感不对」，极难查。
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { invertTransform, sameRect, FLIP_EASING, FLIP_MS, type FlipRect } from './flip.ts'

/**
 * 元素的矩形一变就跑 FLIP（布局已到终态，只用 transform 把视觉倒推回起点再跑回去）。
 *
 * @param ref  要动的那个元素。它的 `left/top/width/height` 必须已经是终态。
 * @param rect 元素此刻的矩形；`null` = 这一轮不参与（比如被别人最大化盖住而 display:none，
 *             那时量出来的是 0，倒推会得到 Infinity，浏览器判整条 transform 无效）。
 */
export function useMaximizeFlip(ref: RefObject<HTMLElement | null>, rect: FlipRect | null): void {
  const last = useRef<FlipRect | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    // rect 为 null 时**把记忆一起清掉**：藏起来再出现，中间那段不该被当成一次跳变
    if (!el || !rect) {
      last.current = null
      return
    }
    const prev = last.current
    last.current = rect
    // 第一次挂载没有起点可倒推；几乎没变的也别动画（硬跑一遍只会闪一下）
    if (!prev || sameRect(prev, rect)) return
    // **只给最大化/还原这一类跳变做动画。** 平移和缩放画布时矩形也在变，
    // 那些本来就是连续的，再叠一层补间会拖泥带水。判据是「面积变了一大截」。
    const ratio = (rect.w * rect.h) / Math.max(1, prev.w * prev.h)
    if (ratio > 0.6 && ratio < 1.7) return
    const anim = el.animate(
      [{ transform: invertTransform(prev, rect) }, { transform: 'none' }],
      { duration: ratio > 1 ? FLIP_MS.grow : FLIP_MS.shrink, easing: FLIP_EASING }
    )
    return () => anim.cancel()
    // 依赖逐字段列，不能只依赖 rect 对象 —— 调用方每次渲染都会新建一个对象字面量，
    // 那样每渲染一次都会重跑一遍 effect
  }, [ref, rect?.left, rect?.top, rect?.w, rect?.h])
}
