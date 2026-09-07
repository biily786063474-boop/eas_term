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
    // ⚠️ **`transform-origin` 必须自己给。**
    // `invertTransform` 的公式是按「原点在左上角」推的（`flip.ts` 的注释写着这条），
    // 但**没有任何 CSS 真的设过它** —— 2026-09-07 运行时实测 `.pane` 是 `50% 50%`、
    // `.cfile-node` 是 `150px 110px`（都是默认的中心）。于是缩放绕中心发生、
    // 平移却按左上角算，动画起点落不回原位 —— 用户实拍：「有些不是从原位到全屏的」。
    // 这条从 FLIP 上线那天就错着，只是终端块头大、偏移相对小才没被发现。
    //
    // ⚠️ **动画要等一帧再启动。**
    // 还原时 `maximizedNode` 变 null，画布上**所有**被 `display:none` 藏起来的节点
    // 同一帧全部恢复显示 —— 2026-09-07 实测 55 个元素，那一帧要 175~191ms
    //（放大时最长 16.7ms，空转基线 9.3ms，都在同一台机器上量的）。
    // WAAPI 的动画是**按时间走的**：卡住的那 175ms 里动画时钟照走，卡完直接跳到
    // 约 67% 再收尾 —— 观感就是「收回过程明显卡顿」。
    //
    // 所以先用内联样式把元素**按在起点**（这一步在 paint 之前，那一帧无论多长
    // 都只是静止不动），等下一帧那笔昂贵布局做完了再真正启动动画。
    // 动画一开始就把内联样式撤掉 —— 留着的话动画结束（fill 默认 none）会弹回起点。
    el.style.transformOrigin = '0 0'
    el.style.transform = invertTransform(prev, rect)
    const clear = (): void => {
      el.style.transform = ''
      el.style.transformOrigin = ''
    }
    // **等到一帧不再昂贵才启动动画。** 只等一帧不够 —— 实测那笔布局风暴跨了两帧
    // （79.5ms + 49.7ms），只延一帧的话动画刚跑到 0ms 就被第二帧吃掉 42ms，
    // 观感仍然是「一上来先跳一截」。所以判据不是「等几帧」而是「上一帧贵不贵」。
    //
    // 上限 4 帧是安全阀：万一机器一直很忙，宁可动画晚开始也不能永远不动。
    // 等待期间元素被上面那两行内联样式按在起点，所以看起来只是「晚一点开始」，
    // 不会跳 —— 这正是把内联按住和延迟启动做成一对的理由。
    const CHEAP_MS = 20 // 120Hz 下一帧 8.3ms，20ms 已经是明显掉帧
    let anim: Animation | null = null
    let raf = 0
    let waited = 0
    let prevTs = performance.now()
    const tick = (ts: number): void => {
      const delta = ts - prevTs
      prevTs = ts
      if (delta > CHEAP_MS && waited++ < 4) {
        raf = requestAnimationFrame(tick)
        return
      }
      clear()
      anim = el.animate(
        [
          { transformOrigin: '0 0', transform: invertTransform(prev, rect) },
          { transformOrigin: '0 0', transform: 'none' }
        ],
        { duration: ratio > 1 ? FLIP_MS.grow : FLIP_MS.shrink, easing: FLIP_EASING }
      )
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clear()
      anim?.cancel()
    }
    // 依赖逐字段列，不能只依赖 rect 对象 —— 调用方每次渲染都会新建一个对象字面量，
    // 那样每渲染一次都会重跑一遍 effect
  }, [ref, rect?.left, rect?.top, rect?.w, rect?.h])
}
