// 双击画布时的迸发特效（canvas-2d）。几何与缓动在 `spark.ts`，这里只负责画。
//
// ── ⚠️ 用法：**不要全站包裹** ───────────────────────────────────────────────
// 用户 2026-09-03 连规格一起给的坑：「全站包裹会让每次点击都放烟花，
// 严肃的后台界面容易显吵。」所以这个组件**不监听任何事件** ——
// 它只暴露一个 `fire(x, y)`，由调用方在**它真正想庆祝的那一下**去触发。
// 目前唯一的调用点是 CanvasStage 的双击空白（= 新建造梦空间那一下）。
//
// 这么设计还有个附带好处：它不需要 pointer-events，也就不可能挡住
// 它正下方那块双击热区 —— 而那正是空画布引导踩过的坑。

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { SPARK, sparkDone, sparkFrame } from './spark.ts'

export interface ClickSparkHandle {
  /** 在视口坐标 (x, y) 放一次。连点会各放各的，互不打断。 */
  fire: (x: number, y: number) => void
}

interface Burst {
  x: number
  y: number
  start: number
  seed: number
}

export function ClickSpark({ handleRef }: { handleRef: Ref<ClickSparkHandle> }): JSX.Element {
  const cvsRef = useRef<HTMLCanvasElement>(null)
  const burstsRef = useRef<Burst[]>([])
  const rafRef = useRef<number | null>(null)
  /** 连点时给不同的角度偏移。模块级递增即可 —— 只要相邻两次不一样就行。 */
  const seqRef = useRef(0)

  useEffect(() => {
    const cvs = cvsRef.current
    if (!cvs) return
    // 跟着窗口尺寸走。**用 devicePixelRatio 放大后备份**，否则 Retina 上线是糊的。
    const fit = (): void => {
      const dpr = window.devicePixelRatio || 1
      cvs.width = Math.round(window.innerWidth * dpr)
      cvs.height = Math.round(window.innerHeight * dpr)
      cvs.style.width = `${window.innerWidth}px`
      cvs.style.height = `${window.innerHeight}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useImperativeHandle(handleRef, () => ({
    fire: (x, y) => {
      // **尊重系统的「减少动效」**：这个应用别处已经在按它降级（见 ui/motion/glow.css），
      // 一个纯装饰的迸发更没有理由无视它。
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      burstsRef.current.push({ x, y, start: performance.now(), seed: (seqRef.current++ % 5) * 0.31 })
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(draw)
    }
  }))

  const draw = (): void => {
    const cvs = cvsRef.current
    const ctx = cvs?.getContext('2d')
    if (!cvs || !ctx) {
      rafRef.current = null
      return
    }
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cvs.width, cvs.height)

    const now = performance.now()
    ctx.lineCap = 'round'
    ctx.lineWidth = SPARK.width
    const alive: Burst[] = []
    for (const b of burstsRef.current) {
      const t = (now - b.start) / SPARK.durationMs
      if (sparkDone(t)) continue // 放完了就不再进入下一帧
      alive.push(b)
      for (const l of sparkFrame(t, b.seed)) {
        ctx.strokeStyle = `rgba(255,255,255,${l.alpha})`
        ctx.beginPath()
        ctx.moveTo(b.x + l.x1, b.y + l.y1)
        ctx.lineTo(b.x + l.x2, b.y + l.y2)
        ctx.stroke()
      }
    }
    burstsRef.current = alive
    // **没有活着的迸发就把循环停掉。** 让它空转的代价不是这一帧的绘制，
    // 是画布这个本来就最吃帧的地方多一个常驻 rAF（长跑那本账上记过）。
    rafRef.current = alive.length ? requestAnimationFrame(draw) : null
  }

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  return (
    <canvas
      ref={cvsRef}
      className="click-spark"
      // 纯装饰：读屏不该念它，也绝不能接点击
      aria-hidden
    />
  )
}
