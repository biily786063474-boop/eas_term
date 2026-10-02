import { useEffect, useRef, useState } from 'react'
import { clampPan, clampScale, fitScale, STEP, wheelFactor, zoomAt, type ZoomView } from './imageZoom'

export interface ZoomLabels { zoomIn: string; zoomOut: string; fit: string; actual: string }
// 文案由调用方传入已翻译的；中文默认值只给单测用（单测的 vm 里 import 不了 i18n）。
/** 调用方用自己的翻译函数取四个按钮的文案（这里不 import i18n，单测的 vm 里加载不了） */
export function zoomLabelsFrom(tr: (key: 'viewer.zoomIn' | 'viewer.zoomOut' | 'viewer.zoomFit' | 'viewer.zoomActual') => string): ZoomLabels {
  return { zoomIn: tr('viewer.zoomIn'), zoomOut: tr('viewer.zoomOut'), fit: tr('viewer.zoomFit'), actual: tr('viewer.zoomActual') }
}
export const DEFAULT_ZOOM_LABELS: ZoomLabels = { zoomIn: '放大', zoomOut: '缩小', fit: '适应窗口', actual: '原始大小' } // i18n-allow: 测试用默认值

/**
 * 放大查看的舞台：铺满弹窗，图片按原图像素排版、用 transform 缩放（不加 will-change ——
 * 那会让 Chromium 按 1 倍栅格化再拉伸，放大后反而糊）。
 * 打开时适应窗口居中；滚轮 / 触控板捏合以光标为中心缩放，放大后可拖动，双击在「适应窗口」和「1:1」之间切换。
 * 点舞台空白处 = 点遮罩，交给 onBackdrop（拖动结束的那次 click 不算）。
 */
export function ZoomableImage({ src, alt, labels = DEFAULT_ZOOM_LABELS, onError, onBackdrop }: { src: string; alt: string; labels?: ZoomLabels; onError?: () => void; onBackdrop: () => void }): JSX.Element {
  const stage = useRef<HTMLDivElement>(null)
  const [nat, setNat] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<[number, number]>([window.innerWidth, window.innerHeight])
  // null = 适应窗口：窗口尺寸变了跟着重新适应，不保留一个过期的比例
  const [view, setView] = useState<ZoomView | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)

  const fit = nat ? fitScale(nat[0], nat[1], box[0], box[1]) : 1
  const v: ZoomView = view ?? { s: fit, x: 0, y: 0 }
  const live = useRef({ v, fit, nat, box }); live.current = { v, fit, nat, box }

  /** 改到 next 倍，(px, py) 是相对舞台中心的锚点 */
  const scaleTo = (next: number, px = 0, py = 0): void => {
    const { v: cur, fit: f, nat: n, box: b } = live.current
    if (!n) return
    const s = clampScale(next, f)
    if (Math.abs(s - f) < 1e-3) { setView(null); return }
    // 不比适应窗口大时没什么可拖的，固定居中
    setView(s < f ? { s, x: 0, y: 0 } : clampPan(zoomAt(cur, s, px, py), n[0], n[1], b[0], b[1]))
  }
  const fromCenter = (cx: number, cy: number): [number, number] => {
    const r = stage.current!.getBoundingClientRect()
    return [cx - r.left - r.width / 2, cy - r.top - r.height / 2]
  }

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox([el.clientWidth, el.clientHeight]))
    ro.observe(el)
    // 原生监听才能 preventDefault：React 的 onWheel 是 passive，捏合会被当成页面缩放
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const [px, py] = fromCenter(e.clientX, e.clientY)
      scaleTo(live.current.v.s * wheelFactor(e.deltaY, e.ctrlKey), px, py)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') scaleTo(live.current.v.s * STEP)
      else if (e.key === '-' || e.key === '_') scaleTo(live.current.v.s / STEP)
      else if (e.key === '0') setView(null)
      else return
      e.preventDefault()
    }
    // 挂在弹窗上而不是 document：ImagePopup 拦住了键盘事件往外冒泡（别让画布收到），到不了 document
    const keyTarget: HTMLElement = el.closest('dialog') ?? el
    keyTarget.addEventListener('keydown', onKey)
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel); keyTarget.removeEventListener('keydown', onKey) }
  }, [])

  const zoomed = !!nat && v.s > fit + 1e-3
  return <>
    <div ref={stage} className={`izoom-stage${zoomed ? ' zoomed' : ''}${dragging ? ' dragging' : ''}`}
      onPointerDown={e => {
        if (e.button !== 0 || !zoomed) return
        drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const d = drag.current
        if (!d || d.id !== e.pointerId || !nat) return
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy
        if (!d.moved && Math.hypot(dx, dy) < 3) return
        if (!d.moved) { d.moved = true; setDragging(true) }
        setView(clampPan({ s: v.s, x: d.vx + dx, y: d.vy + dy }, nat[0], nat[1], box[0], box[1]))
      }}
      onPointerUp={e => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        justDragged.current = d.moved
        drag.current = null
        setDragging(false)
      }}
      onDoubleClick={e => {
        if (!nat) return
        if (zoomed || fit >= 1) { setView(null); return }
        const [px, py] = fromCenter(e.clientX, e.clientY)
        scaleTo(1, px, py)
      }}
      onClick={e => {
        if (justDragged.current) { justDragged.current = false; return }
        if (e.target === e.currentTarget) onBackdrop()
      }}>
      <img src={src} alt={alt} draggable={false} className={nat ? '' : 'loading'}
        onLoad={e => setNat([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} onError={onError}
        style={nat ? { width: nat[0], height: nat[1], transform: `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) scale(${v.s})` } : undefined} />
    </div>
    <div className="izoom-bar" role="toolbar" aria-label={labels.fit}>
      <button type="button" data-zoom="out" aria-label={labels.zoomOut} data-tip={labels.zoomOut} disabled={!nat} onClick={() => scaleTo(v.s / STEP)}>−</button>
      <button type="button" data-zoom="fit" className="izoom-pct" aria-label={labels.fit} data-tip={labels.fit} disabled={!nat} onClick={() => setView(null)}>{Math.round(v.s * 100)}%</button>
      <button type="button" data-zoom="in" aria-label={labels.zoomIn} data-tip={labels.zoomIn} disabled={!nat} onClick={() => scaleTo(v.s * STEP)}>+</button>
      <button type="button" data-zoom="actual" aria-label={labels.actual} data-tip={labels.actual} disabled={!nat} onClick={() => scaleTo(1)}>1:1</button>
    </div>
  </>
}
