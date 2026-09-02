import { useEffect, useRef, useState } from 'react'

import { railPath, railThumb } from './ctxRail.ts'

/**
 * 双击菜单的「沿边滚动条」。进度不画成一根竖条，而是**沿着菜单自己的圆角边框走**
 * （用户 2026-09-02 点名）。几何与滑块算法在 `ctxRail.ts`（纯函数、10 条单测）。
 *
 * ── 为什么它不放在菜单里面 ────────────────────────────────────────────────
 * `.canvas-ctxmenu` **自己就是滚动容器**（`overflow-y: auto`）。放进去的话，
 * 无论 absolute 还是 sticky 都要跟内容一起滚 —— 沿边的轨道会滑出边框。
 * 所以它是**兄弟节点**，用菜单的 `getBoundingClientRect()` 做 fixed 定位覆盖上去。
 *
 * ── 为什么滚动时不走 setState ──────────────────────────────────────────────
 * **滚动是每秒上百次的事件**，每次都触发一轮 React 渲染（diff 整棵 SVG、
 * 重算 path）的话，滑块会明显落在内容后面 —— 用户读到的是「卡、慢」
 * （2026-09-02 第一版就是这样，还叠了个 60ms 的 transition，雪上加霜）。
 *
 * 所以分两层：
 *   · **尺寸/路径**（菜单多大、圆角多少）走 state —— 它只在开合与搜索时变；
 *   · **滑块位置**走 ref **直接写 SVG 属性**，并用 rAF 合帧 ——
 *     一帧最多写一次，且不经过 React。
 *
 * 也**不加 CSS transition**：滚动条要和内容零延迟同步，补间只会让它追在后面跑。
 * 顺滑来自滚动事件本身的密度。
 */
export function CtxScrollRail({ host }: { host: React.RefObject<HTMLElement | null> }): JSX.Element | null {
  /** 只在「菜单尺寸变了」时更新 —— 不跟着滚动走 */
  const [box, setBox] = useState<{
    x: number
    y: number
    w: number
    h: number
    r: number
    scrollable: boolean
  } | null>(null)
  const thumbRef = useRef<SVGPathElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return

    const measure = (): void => {
      const b = el.getBoundingClientRect()
      const r = parseFloat(getComputedStyle(el).borderTopRightRadius) || 0
      setBox({ x: b.left, y: b.top, w: b.width, h: b.height, r, scrollable: el.scrollHeight > el.clientHeight + 1 })
    }

    // 滑块：直接写属性，rAF 合帧。**不进 React。**
    let raf = 0
    const paint = (): void => {
      raf = 0
      const t = thumbRef.current
      if (!t) return
      const { len, at } = railThumb(el.scrollTop, el.scrollHeight, el.clientHeight)
      t.setAttribute('stroke-dasharray', `${len} 1`)
      t.setAttribute('stroke-dashoffset', String(-at))
    }
    const onScroll = (): void => {
      // 已经排了一帧就别再排 —— 一帧内滚动事件可能来好几次
      if (!raf) raf = requestAnimationFrame(paint)
    }

    measure()
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    // 菜单高度会随搜索结果变（条数一变，能不能滚也跟着变）——
    // 只听 scroll 的话，搜到只剩两条时轨道还画着满长的滑块
    const ro = new ResizeObserver(() => {
      measure()
      onScroll()
    })
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [host])

  // 装得下就不画：画一条静止的轨道只会让人以为它坏了
  if (!box || !box.scrollable) return null

  const d = railPath({ w: box.w, h: box.h, r: box.r })

  return (
    <svg
      className="cctx-rail"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      viewBox={`0 0 ${box.w} ${box.h}`}
      aria-hidden="true"
    >
      {/* 轨道：整段路径，很淡 —— 它只是告诉你「滑块会在这条线上走」 */}
      <path className="cctx-rail-track" d={d} />
      {/* 滑块：同一条路径，用 dash 只露出一段。
          `pathLength={1}` 把路径长度归一化成 1，于是 dasharray/offset 直接用
          `railThumb` 回的那两个 0–1 的数 —— 不用 `getTotalLength()`
          （那个要等 DOM 挂上才能算）。
          初值给满长：paint() 会在挂载后立刻覆盖，但中间那一帧不该是空的。 */}
      <path
        ref={thumbRef}
        className="cctx-rail-thumb"
        d={d}
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset="0"
      />
    </svg>
  )
}
