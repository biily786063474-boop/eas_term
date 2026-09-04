// 图背后的环境光：纯黑底上散布细小光点，缓慢漂移，鼠标移动整片轻微偏转。
//
// ── 为什么没用规格里点名的 ogl ──────────────────────────────────────────────
// 规格写的是 webgl-ogl ＋ 依赖 ogl。这里没用，两个理由：
//   ① 这是**画布节点里的一块背景**。画布上同时还跑着终端（xterm）和网页
//      （webview），它们已经在争 GPU 与帧了 —— 再开一个 WebGL 上下文是实打实的
//      成本，而这个效果**刻意很安静**（规格自己写的），根本吃不到 WebGL 的好处。
//   ② 几百个 2~3px 的点、每帧只改位置，canvas-2d 完全够；ogl 是 ~50KB 的新依赖。
// 真要换成 ogl，替掉的是这个文件，调用点不用动。
//
// ── 三个一写就错的地方 ──────────────────────────────────────────────────────
// 1. **DPR**：不按 devicePixelRatio 放大后备缓冲，retina 上点是糊的。
// 2. **不可见时要停**：画布可以被滚出视口、模块可以被别的模块盖住 ——
//    不停的话它在后台一直烧帧（本仓库有过「后台节流」那一整轮教训）。
// 3. **鼠标偏转要用阻尼**，不能直接跟手：直接跟手时整片星空会随指针抖，
//    而规格要的是「轻微偏转」。

import { useEffect, useRef } from 'react'

/** 漂移速度（规格给的 speed=0.1）。**很慢** —— 快了就成了屏保。 */
const SPEED = 0.1
/** 每 10000 px² 放几个点。太密会变成噪点纹理，太疏就看不出是星空。
 *  第一版算成了 0.055×10，1080×390 的画面上只落了 23 颗 —— 那不是星空，
 *  是几粒灰。4 颗/10000px² ≈ 170 颗，是「一片」但仍然安静。 */
const DENSITY = 4
/** 鼠标偏转的最大位移（px）。整片一起动，所以这个值要很小。 */
const PARALLAX = 14

interface Dot {
  x: number
  y: number
  /** 深度 0~1：越大越近 —— 近的更亮、更大、偏转更多（视差） */
  z: number
  /** 每颗自己的漂移方向 */
  vx: number
  vy: number
  hue: number
}

export function Starfield(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    let dots: Dot[] = []
    let raf = 0
    let w = 0
    let h = 0
    /** 目标偏转与当前偏转 —— 差值每帧收一点，就是那个「阻尼」 */
    let tx = 0
    let ty = 0
    let cxOff = 0
    let cyOff = 0
    let running = true

    /** 用坐标当种子的伪随机 —— **同一块地方每次刷新星图一样**，
     *  不然每次重渲染星星都换位置，读起来像画面在闪。 */
    let seed = 20260903
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }

    const build = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = cv.clientWidth
      h = cv.clientHeight
      if (w === 0 || h === 0) return
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed = 20260903
      const n = Math.round(((w * h) / 10000) * DENSITY)
      dots = Array.from({ length: n }, () => ({
        x: rnd() * w,
        y: rnd() * h,
        z: 0.25 + rnd() * 0.75,
        vx: (rnd() - 0.5) * SPEED,
        vy: (rnd() - 0.5) * SPEED,
        // 色相集中在冷白~淡青~淡紫这一小段：**不引入新色相**，
        // 只是让「白」有一点点温度差，纯白一片会显得很平
        hue: 200 + rnd() * 90
      }))
    }

    const frame = (): void => {
      if (!running) return
      ctx.clearRect(0, 0, w, h)
      // 阻尼：每帧把当前偏转往目标收 8%
      cxOff += (tx - cxOff) * 0.08
      cyOff += (ty - cyOff) * 0.08
      for (const d of dots) {
        d.x += d.vx
        d.y += d.vy
        if (d.x < -4) d.x = w + 4
        if (d.x > w + 4) d.x = -4
        if (d.y < -4) d.y = h + 4
        if (d.y > h + 4) d.y = -4
        // 近的偏转更多 —— 这就是视差，整片才有厚度
        const px = d.x + cxOff * d.z
        const py = d.y + cyOff * d.z
        const r = 0.5 + d.z * 1.3
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${d.hue}, 45%, 78%, ${(0.06 + d.z * 0.16).toFixed(3)})`
        ctx.fill()
      }
      raf = requestAnimationFrame(frame)
    }

    const onMove = (e: MouseEvent): void => {
      const b = cv.getBoundingClientRect()
      if (b.width === 0) return
      tx = ((e.clientX - b.left) / b.width - 0.5) * -PARALLAX * 2
      ty = ((e.clientY - b.top) / b.height - 0.5) * -PARALLAX * 2
    }
    const onLeave = (): void => {
      tx = 0
      ty = 0
    }

    build()
    frame()
    const ro = new ResizeObserver(build)
    ro.observe(cv)
    const parent = cv.parentElement
    parent?.addEventListener('mousemove', onMove)
    parent?.addEventListener('mouseleave', onLeave)

    // **看不见就停。** 模块被盖住、滚出视口、或整个窗口进后台时不该继续烧帧
    const io = new IntersectionObserver((es) => {
      const vis = es.some((x) => x.isIntersecting)
      if (vis && !running) {
        running = true
        frame()
      } else if (!vis) {
        running = false
        cancelAnimationFrame(raf)
      }
    })
    io.observe(cv)
    const onVis = (): void => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        frame()
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      parent?.removeEventListener('mousemove', onMove)
      parent?.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={ref} className="cg-stars" aria-hidden="true" />
}
