// 画布装饰层：viewport（点阵背景 + 平移缩放捕获）→ world（transform 变换）→ Frame 卡片。
// 这一层只画「死内容」（Frame 边框/标题/点阵/缩放条），可随意位图缩放。
// 活终端由 PaneLayer 渲染、浮在此层之上按同一视口变换对齐（实现规划 §5-A 双层渲染）。

import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import type { CanvasFrame } from '../../store'
import { PlusIcon, MinusIcon } from '../../ui/Icons'
import './canvas.css'

const SCALE_MIN = 0.2
const SCALE_MAX = 2.2
const HEAD_H = 34
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

export function CanvasStage(): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frames = useStore((s) => s.canvas.frames)
  const vp = useStore((s) => s.canvas.viewport)
  const setViewport = useStore((s) => s.setViewport)
  const moveFrame = useStore((s) => s.moveFrame)
  const toggleCollapse = useStore((s) => s.toggleCollapse)

  // 滚轮缩放 / 双指平移（原生监听以便 passive:false 阻止页面滚动）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const cur = useStore.getState().canvas.viewport
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const factor = e.ctrlKey ? 1 - e.deltaY * 0.01 : 1 - e.deltaY * 0.0016
        const s2 = clamp(cur.scale * factor, SCALE_MIN, SCALE_MAX)
        setViewport({
          scale: s2,
          x: px - (px - cur.x) * (s2 / cur.scale),
          y: py - (py - cur.y) * (s2 / cur.scale)
        })
      } else {
        setViewport({ x: cur.x - e.deltaX, y: cur.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setViewport])

  const startPan = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const cur = useStore.getState().canvas.viewport
    const sx = e.clientX
    const sy = e.clientY
    const el = viewportRef.current
    el?.classList.add('panning')
    const onMove = (ev: MouseEvent): void =>
      setViewport({ x: cur.x + (ev.clientX - sx), y: cur.y + (ev.clientY - sy) })
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      el?.classList.remove('panning')
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startFrameDrag = (f: CanvasFrame, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const scale = useStore.getState().canvas.viewport.scale
    const sx = e.clientX
    const sy = e.clientY
    const fx = f.x
    const fy = f.y
    const onMove = (ev: MouseEvent): void =>
      moveFrame(f.id, fx + (ev.clientX - sx) / scale, fy + (ev.clientY - sy) / scale)
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const setScale = (s2: number): void => {
    const cur = useStore.getState().canvas.viewport
    const el = viewportRef.current
    const cx = (el?.clientWidth ?? 0) / 2
    const cy = (el?.clientHeight ?? 0) / 2
    const sc = clamp(s2, SCALE_MIN, SCALE_MAX)
    setViewport({
      scale: sc,
      x: cx - (cx - cur.x) * (sc / cur.scale),
      y: cy - (cy - cur.y) * (sc / cur.scale)
    })
  }

  const fitAll = (): void => {
    const el = viewportRef.current
    if (!el || !frames.length) return
    const x1 = Math.min(...frames.map((f) => f.x)) - 60
    const y1 = Math.min(...frames.map((f) => f.y)) - 70
    const x2 = Math.max(...frames.map((f) => f.x + f.w)) + 60
    const y2 = Math.max(...frames.map((f) => f.y + (f.collapsed ? HEAD_H : f.h))) + 60
    const sw = el.clientWidth
    const sh = el.clientHeight
    const sc = clamp(Math.min(sw / (x2 - x1), sh / (y2 - y1)), SCALE_MIN, 1.3)
    setViewport({
      scale: sc,
      x: (sw - (x2 - x1) * sc) / 2 - x1 * sc,
      y: (sh - (y2 - y1) * sc) / 2 - y1 * sc
    })
  }

  return (
    <div
      ref={viewportRef}
      className="canvas-viewport"
      onMouseDown={startPan}
      style={{
        backgroundSize: `${26 * vp.scale}px ${26 * vp.scale}px`,
        backgroundPosition: `${vp.x}px ${vp.y}px`
      }}
    >
      <div
        className="canvas-world"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})` }}
      >
        {frames.map((f) => (
          <div
            key={f.id}
            className={`cframe${f.collapsed ? ' collapsed' : ''}`}
            style={{ left: f.x, top: f.y, width: f.w, height: f.collapsed ? HEAD_H : f.h }}
          >
            <div className="cframe-head" onMouseDown={(e) => startFrameDrag(f, e)}>
              <span className="cframe-dot" />
              <b className="cframe-name">{f.name}</b>
              <span className="cframe-count">{f.nodes.length} 面板</span>
              <button
                className="cframe-btn"
                title={f.collapsed ? '展开' : '折叠'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => toggleCollapse(f.id)}
              >
                {f.collapsed ? <PlusIcon size={13} /> : <MinusIcon size={13} />}
              </button>
            </div>
            {!f.collapsed && f.nodes.length === 0 && <div className="cframe-empty">空 Frame</div>}
          </div>
        ))}
      </div>

      <div className="canvas-zoombar">
        <button
          onClick={() => setScale(useStore.getState().canvas.viewport.scale / 1.15)}
          title="缩小"
        >
          <MinusIcon size={14} />
        </button>
        <button className="zoom-pct" onClick={() => setScale(1)} title="重置 100%">
          {Math.round(vp.scale * 100)}%
        </button>
        <button
          onClick={() => setScale(useStore.getState().canvas.viewport.scale * 1.15)}
          title="放大"
        >
          <PlusIcon size={14} />
        </button>
        <button className="zoom-fit" onClick={fitAll} title="适应全部">
          ⤢
        </button>
      </div>
    </div>
  )
}
