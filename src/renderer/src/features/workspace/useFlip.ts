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
import { useLayoutEffect, useRef, type RefObject, useEffect, useState } from 'react'
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
    // ⚠️ **`transform-origin` 由动画自己给，不能指望元素上有。**
    // `invertTransform` 的公式是按「原点在左上角」推的（`flip.ts` 的注释写着这条）。
    // `PaneView` **自己设了** `transformOrigin: '0 0'`（给它的位图缩放用），所以终端那条
    // 一直是对的；而画布上那三个节点组件从来没设过 —— 实测 `.cfile-node` 是
    // `150px 110px`（默认的中心）。于是缩放绕中心、平移按左上角，起点落不回原位。
    // 这正是用户 2026-09-07 说的「**有些**不是从原位到全屏的」—— 是「有些」，不是全部。
    // 现在关键帧里自带这一条，调用方元素上有没有都不影响。
    //
    // ⚠️ **只能通过关键帧给，绝不能写 `el.style.transform` / `transformOrigin`。**
    // `.pane` **自己就有一个内联 transform**（`scale(vp.scale)`，画布缩放用的位图缩放，
    // 由 React 的 style 属性下发）。2026-09-07 我一度用内联样式把元素「按在起点」，
    // 结果两头都坏：覆盖掉了它自己的 scale，清理时又把 `transformOrigin: 0 0` 留在
    // 元素上 —— 于是那个 scale 改成绕左上角缩放，整块渲染位置全错，
    // 用户实拍报「坐标好像错乱了」。
    // WAAPI 的动画值在动画期间**盖过** CSS transform，`cancel()` / 结束（fill 默认 none）
    // 后自动还原，全程不碰内联样式 —— 这才是对的做法。
    //
    // ⚠️ **动画要等一帧「不贵的」再启动。**
    // 还原时画布上**所有**被 `display:none` 藏起来的节点同一帧全部恢复显示 ——
    // 2026-09-07 实测 55 个元素，冷启动那一帧 175~191ms（放大时最长 16.7ms、
    // 空转基线 9.3ms，同一台机器）。而 WAAPI 是**按时间走的**：卡住的那段时间里
    // 动画时钟照走，卡完直接跳到约 67% 再收尾 —— 观感就是「收回明显卡顿」。
    //
    // 所以**先建好动画再 `pause()` 按在第 0 帧**（这一步已经把元素定在起点，
    // 而且是 WAAPI 的值，不动内联样式），等某一帧的间隔说明布局风暴过去了再 `play()`。
    // ⚠️ 只等一帧不够：实测风暴跨两帧（79.5ms + 49.7ms），只延一帧的话动画刚跑到
    // 0ms 就被第二帧吃掉 42ms。判据是「上一帧贵不贵」，不是「等几帧」；
    // 上限 4 帧是安全阀 —— 机器一直忙时宁可晚开始，也不能永远不动。
    const CHEAP_MS = 20 // 120Hz 下一帧 8.3ms，20ms 已经是明显掉帧
    const anim = el.animate(
      [
        { transformOrigin: '0 0', transform: invertTransform(prev, rect) },
        { transformOrigin: '0 0', transform: 'none' }
      ],
      { duration: ratio > 1 ? FLIP_MS.grow : FLIP_MS.shrink, easing: FLIP_EASING }
    )
    anim.pause()
    anim.currentTime = 0
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
      anim.play()
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      anim.cancel()
    }
    // 依赖逐字段列，不能只依赖 rect 对象 —— 调用方每次渲染都会新建一个对象字面量，
    // 那样每渲染一次都会重跑一遍 effect
  }, [ref, rect?.left, rect?.top, rect?.w, rect?.h])
}

/**
 * 「因为谁而藏着」—— 最大化时其它节点要 `display:none`，**但还原时要晚一点再放出来**。
 *
 * ── 为什么 ────────────────────────────────────────────────────────────────
 * 还原那一刻画布上所有被藏起来的节点同一帧全部恢复显示，2026-09-07 实测 55 个元素、
 * 一帧 50~120ms（冷启动更贵）。这笔开销落在收回动画的头上，用户看到的就是
 * 「回收动画会掉帧」。`useMaximizeFlip` 那边只能绕（等一帧不贵的再启动），
 * 绕的代价是动画晚开始 —— 眼睛看到的还是「点完先顿一下」。
 *
 * 所以这里治根：**把恢复显示推迟到收回动画放完之后**。反正它们在最大化期间本来就
 * 一直看不见，晚 260ms 出现不改变任何语义，而收回那段就没有别的活跟它抢帧了。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 * 调用方拿它算 `hiddenByMax`，**不要拿它算 `isMax` / 最大化的几何** —— 那两个必须
 * 用实时值，否则被还原的那个节点会晚 260ms 才开始缩，动画就没了。
 *
 * 正在被还原的那个节点自己**不会**被藏：它就是 `holder` 指的那个。
 */
export function useHidingHolder(live: MaxRef | null): MaxRef | null {
  const [holder, setHolder] = useState<MaxRef | null>(live)
  useEffect(() => {
    // 有人最大化了：**立刻**藏起其它节点，一帧都不能等（等了会看见它们压在上面）
    if (live) {
      setHolder(live)
      return
    }
    // 还原：多留一个收回动画的时长再放出来
    const t = setTimeout(() => setHolder(null), FLIP_MS.shrink)
    return () => clearTimeout(t)
  }, [live?.frameId, live?.nodeId])
  return live ?? holder
}

/** 最大化的那个节点的身份。跟 store 里 `maximizedNode` 同形，这里只取用得上的两个字段。 */
export interface MaxRef {
  frameId?: string
  nodeId: string
}
