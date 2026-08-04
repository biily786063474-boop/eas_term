import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// 全局自定义 tooltip：接管所有 [data-tip] 元素的悬浮提示，替代原生 title。
// 固定定位 + portal 到 body → 不被玻璃面板的 overflow:hidden / backdrop-filter 裁切。
interface TipState {
  text: string
  x: number
  y: number
  above: boolean
}

const DELAY = 360

export function Tooltip(): JSX.Element | null {
  const [tip, setTip] = useState<TipState | null>(null)
  const timer = useRef<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const clearTimer = (): void => {
      if (timer.current) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }
    const hide = (): void => {
      clearTimer()
      setTip(null)
    }
    const show = (el: HTMLElement): void => {
      const text = el.getAttribute('data-tip')
      if (!text || !text.trim()) return
      clearTimer()
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        // 下方空间不足则翻到上方显示
        const above = window.innerHeight - r.bottom < 44
        setTip({
          text,
          x: r.left + r.width / 2,
          y: above ? r.top - 8 : r.bottom + 8,
          above
        })
      }, DELAY)
    }
    const onOver = (e: PointerEvent): void => {
      const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null
      if (el) show(el)
      else hide()
    }
    const onOut = (e: PointerEvent): void => {
      const from = (e.target as HTMLElement)?.closest?.('[data-tip]')
      const to = (e.relatedTarget as HTMLElement)?.closest?.('[data-tip]')
      if (from && from !== to) hide()
    }
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimer()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // 贴边收拢：居中锚点会让靠窗口边缘的元素（如标题栏最右的设置）把 tooltip 顶出视口。
  // 在绘制前量一次、用 margin 推回来——改 left 会触发第二次布局，margin 不会。
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.marginLeft = '0px'
    const r = el.getBoundingClientRect()
    const M = 8
    const dx =
      r.right > window.innerWidth - M
        ? window.innerWidth - M - r.right
        : r.left < M
          ? M - r.left
          : 0
    if (dx) el.style.marginLeft = `${dx}px`
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={boxRef}
      className={`app-tooltip${tip.above ? ' above' : ''}`}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
