import { useEffect, useState } from 'react'

import { railPath, railThumb } from './ctxRail.ts'

/**
 * 双击菜单的「沿边滚动条」。进度不画成一根竖条，而是**沿着菜单自己的圆角边框走**
 * （用户 2026-09-02 点名）。几何与滑块算法在 `ctxRail.ts`（纯函数、10 条单测）。
 *
 * ── 为什么它不放在菜单里面 ────────────────────────────────────────────────
 * `.canvas-ctxmenu` **自己就是滚动容器**（`overflow-y: auto`）。放进去的话，
 * 无论 absolute 还是 sticky 都要跟内容一起滚 —— 沿边的轨道会滑出边框，
 * 看着像一条脱缰的线。所以它是**兄弟节点**，用菜单的 `getBoundingClientRect()`
 * 做 fixed 定位覆盖上去，自己不参与滚动。
 *
 * `pointer-events: none`：它盖在菜单上，能接事件就会挡住底下的条目。
 */
export function CtxScrollRail({ host }: { host: React.RefObject<HTMLElement | null> }): JSX.Element | null {
  const [s, setS] = useState<{
    x: number
    y: number
    w: number
    h: number
    r: number
    top: number
    sh: number
    ch: number
  } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const read = (): void => {
      const box = el.getBoundingClientRect()
      const r = parseFloat(getComputedStyle(el).borderTopRightRadius) || 0
      setS({
        x: box.left,
        y: box.top,
        w: box.width,
        h: box.height,
        r,
        top: el.scrollTop,
        sh: el.scrollHeight,
        ch: el.clientHeight
      })
    }
    read()
    el.addEventListener('scroll', read, { passive: true })
    // 菜单高度会随搜索结果变（条数一变，能不能滚也跟着变）——
    // 只听 scroll 的话，搜到只剩两条时轨道还画着满长的滑块
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', read)
      ro.disconnect()
    }
  }, [host])

  // 装得下就不画。**这里跟 `railThumb` 的「满长滑块」不冲突** ——
  // 那是给「刚好装满」留的余地，而这里是「压根不需要滚」，画一条静止的轨道
  // 只会让人以为它坏了。
  if (!s || s.sh <= s.ch + 1) return null

  const d = railPath({ w: s.w, h: s.h, r: s.r })
  const { len, at } = railThumb(s.top, s.sh, s.ch)

  return (
    <svg
      className="cctx-rail"
      style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
      viewBox={`0 0 ${s.w} ${s.h}`}
      aria-hidden="true"
    >
      {/* 轨道：整段路径，很淡 —— 它只是告诉你「滑块会在这条线上走」 */}
      <path className="cctx-rail-track" d={d} />
      {/* 滑块：同一条路径，用 dash 只露出一段。
          `pathLength={1}` 把路径长度归一化成 1，于是 dasharray/offset 直接用
          `railThumb` 回的那两个 0–1 的数 —— 不用 `getTotalLength()`
          （那个要等 DOM 挂上才能算，而这里渲染时就要出数）。 */}
      <path
        className="cctx-rail-thumb"
        d={d}
        pathLength={1}
        strokeDasharray={`${len} 1`}
        strokeDashoffset={-at}
      />
    </svg>
  )
}
