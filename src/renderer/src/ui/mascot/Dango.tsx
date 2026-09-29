// 像素团子（Eas-Term 吉祥物）。形状与帧序列在 dangoGrid.ts（纯函数、有测试），这里只管切帧和什么时候别切。
//
// **为什么不用 CSS 动画**：仓库有一条自动检查（scripts/check-animations.mjs），起因是常驻的呼吸点
// 把 GPU 烧到 23%。团子只在少数时刻换几格像素，用低频定时器切帧、没有每帧循环，比任何无限 CSS 动画都省。
//
// 三道「别切」的闸门，和 ThinkingOrb 同一套：
//   · 组件卸载 → 清定时器
//   · 不可见 → 停在第 0 帧，回来再续。主窗口里「不可见」包括失焦（backgroundThrottling 关着，
//     document.hidden 可能一直是 false，见 03 号图纸）；灵动岛例外 —— 它本来就在主窗口没焦点时显示，
//     只能按自己的 visibility 停，所以由调用方传 pauseWhenBlurred={false}
//   · 系统「减弱动态效果」→ 只画第 0 帧
import { useEffect, useMemo, useRef, useState } from 'react'
import { dangoShape, dangoTimeline, type DangoState } from './dangoGrid.ts'

export type { DangoState }

export function Dango({ state, size = 24, pauseWhenBlurred = true, className }: {
  state: DangoState
  /** 取 24 的整数倍最锐利（24 / 48 / 72 / 96…）；72 及以下自动不画脚 */
  size?: number
  pauseWhenBlurred?: boolean
  className?: string
}): JSX.Element {
  const timeline = useMemo(() => dangoTimeline(state), [state])
  const [step, setStep] = useState(0)
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    setStep(0)
    if (timeline.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let timer = 0
    let i = 0
    let running = false
    let onScreen = true
    const tick = (): void => {
      i = (i + 1) % timeline.length
      setStep(i)
      timer = window.setTimeout(tick, timeline[i][1])
    }
    const start = (): void => { if (running) return; running = true; timer = window.setTimeout(tick, timeline[i][1]) }
    const stop = (): void => { if (!running) return; running = false; clearTimeout(timer); i = 0; setStep(0) }
    const sync = (): void => {
      const hidden = document.hidden || !onScreen || (pauseWhenBlurred && !document.hasFocus())
      hidden ? stop() : start()
    }
    const el = ref.current
    const observer = el ? new IntersectionObserver(entries => { onScreen = entries[0]?.isIntersecting ?? false; sync() }) : null
    if (el && observer) observer.observe(el)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('blur', sync)
    window.addEventListener('focus', sync)
    sync()
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('blur', sync)
      window.removeEventListener('focus', sync)
      observer?.disconnect()
      clearTimeout(timer)
    }
  }, [timeline, pauseWhenBlurred])

  const shape = dangoShape(state, size, timeline[step]?.[0] ?? {})
  return (
    <svg
      ref={ref}
      className={className ? `dango ${className}` : 'dango'}
      width={shape.width}
      height={shape.height}
      viewBox={shape.viewBox}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={shape.path} fill="currentColor" />
    </svg>
  )
}
