// 「正在处理」那颗球的画布外壳。几何全在 orbGeometry.ts（纯函数、有测试），
// 这里只管：拿 2D 上下文、按 DPR 开画布、每帧把点画出去、以及什么时候别画。
//
// **为什么是 canvas 不是 CSS 动画**：这颗球每帧有三四十个点各自换位置、大小和亮度，
// 用 DOM 就是三四十个节点每帧改 transform + opacity —— 样式重算和合成的量都在那儿。
// 仓库里为这件事专门加过一条自动检查（scripts/check-animations.mjs：`infinite` 动画
// 只许动合成属性），起因正是「五个呼吸点把 GPU 烧到常驻 23%」。一块 24px 的画布
// 每帧一次 fill，比那便宜得多，而且只在 agent 真的在跑的时候存在。
//
// 三个「别画」的闸门，缺一个都会变成常驻耗电：
//   · 组件卸载（agent 答完了，busy 变 false）→ 取消 rAF
//   · 标签页/窗口不可见 → 停，回来再续
//   · 用户系统里开了「减弱动态效果」→ 只画一帧静态的，不起循环
import { useEffect, useRef } from 'react'
import {
  buildOrb,
  scaleCount,
  scaleSize,
  SOLVING,
  INLINE_TUNING,
  type OrbConfig
} from './orbGeometry.ts'

/** 30fps 够了。这颗球一个完整周期十几秒，60fps 和 30fps 肉眼分不出，
 *  但每帧的开销是实打实的两倍。 */
const FRAME_MS = 1000 / 30

/** 从 `color` 计算属性里取出 rgb。取不到就退回一个中性灰 ——
 *  **不能让取色失败变成「什么都不画」**，那样 agent 在跑时界面上一点动静都没有。 */
function rgbOf(el: HTMLElement): [number, number, number] {
  const m = getComputedStyle(el).color.match(/-?\d+(\.\d+)?/g)
  if (!m || m.length < 3) return [200, 200, 200]
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}

export function ThinkingOrb({ size = 28 }: { size?: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    // DPR 只在挂载时取一次：这颗球的生命周期是「agent 跑这一轮」，
    // 中途把窗口拖到另一块不同缩放的屏幕上是极边缘的情况，不值得为它挂监听
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    cv.width = Math.round(size * dpr)
    cv.height = Math.round(size * dpr)
    ctx.scale(dpr, dpr)

    const cfg: OrbConfig = scaleSize(scaleCount(SOLVING, INLINE_TUNING.count), INLINE_TUNING.size)
    const [r, g, b] = rgbOf(cv)

    const draw = (t: number): void => {
      ctx.clearRect(0, 0, size, size)
      for (const d of buildOrb(size, t, cfg)) {
        ctx.fillStyle = `rgba(${r},${g},${b},${d.lum.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 「减弱动态效果」：画一帧就停。挑 t=0.9 是因为那一刻正好有一层拧到一半，
    // 静止画面上也看得出这是个「在解的球」而不是一颗普通的点阵球
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      draw(0.9)
      return
    }

    let raf = 0
    let last = 0
    // **动画时间自己攒，不用 performance.now()**：窗口不可见时我们会停下来，
    // 拿绝对时间的话回来那一帧会瞬间跳过几十秒的动作，看着像抽了一下
    let t = 0
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const dt = now - last
      if (dt < FRAME_MS) return
      last = now
      // dt 封顶：从后台切回来的第一帧 dt 可能是几秒，不封的话球会瞬移
      t += (Math.min(dt, 100) / 1000) * INLINE_TUNING.speed
      draw(t)
    }
    const start = (): void => {
      if (raf) return
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const stop = (): void => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    }
    const onVis = (): void => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    start()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      stop()
    }
  }, [size])

  return (
    <canvas
      ref={ref}
      className="ac-orb"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
