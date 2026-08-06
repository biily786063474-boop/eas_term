// 让 .glow-edge 的边缘光晕跟着鼠标走。
//
// **一个全局监听搞定所有卡片**，不是每张卡片挂一个。画布上同屏可能十几个节点，
// 逐个挂 onMouseMove 意味着十几个 React 事件处理器 + 十几次 setState；
// 这里只在 document 上听一次，命中哪张卡就往那张卡写两个 CSS 变量 ——
// 不经过 React，零重渲染。
//
// 配套样式见 glow.css。挂在 App 顶层调用一次即可。
import { useEffect } from 'react'

/** 鼠标离卡片多远就不再算「在这张卡上」。留一点余量，贴边移动时光晕不会闪断 */
const SLACK = 2

export function useEdgeGlow(): void {
  useEffect(() => {
    let raf = 0
    let pending: { el: HTMLElement; x: number; y: number } | null = null
    /** 上一次点亮的卡片。鼠标移开时要把变量清掉，否则下次 hover 会先闪一下旧位置 */
    let last: HTMLElement | null = null

    const flush = (): void => {
      raf = 0
      if (!pending) return
      const { el, x, y } = pending
      pending = null
      el.style.setProperty('--gx', `${x}px`)
      el.style.setProperty('--gy', `${y}px`)
    }

    const onMove = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest?.('.glow-edge, .cfile-node') as HTMLElement | null
      if (el !== last) {
        // 离开上一张：清掉变量，回到 CSS 里那个「中心」默认值
        last?.style.removeProperty('--gx')
        last?.style.removeProperty('--gy')
        last = el
      }
      if (!el) return
      const r = el.getBoundingClientRect()
      // 屏幕坐标：先用它判边界。指针在边界外一点点（子元素外扩、阴影区）就不更新，
      // 免得光晕跳到角上
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top
      if (sx < -SLACK || sy < -SLACK || sx > r.width + SLACK || sy > r.height + SLACK) return
      // **再换算回元素自己的坐标系**。画布整体挂着 scale()，getBoundingClientRect
      // 给的是缩放后的屏幕尺寸，而 CSS 变量是在元素内部用的 —— 直接把屏幕差值写进去，
      // 缩到 50% 时光晕会停在鼠标左边一半的位置。offsetWidth 是没缩放的本地宽，
      // 两者相除正好是当前缩放比；没缩放的元素比值为 1，这行不产生任何影响。
      const k = r.width > 0 ? el.offsetWidth / r.width : 1
      const x = sx * k
      const y = sy * k
      // 每帧最多写一次：mousemove 一秒能来上百次，逐次写 style 是白费
      pending = { el, x, y }
      if (!raf) raf = requestAnimationFrame(flush)
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onMove)
      if (raf) cancelAnimationFrame(raf)
      last?.style.removeProperty('--gx')
      last?.style.removeProperty('--gy')
    }
  }, [])
}
