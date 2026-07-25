// 画布缩略图（左下角小地图）：总览所有 Frame 的位置与名称 + 当前视口范围框。
// 点击地图任意处 → 画布平移过去（保持缩放）；拖视口框 → 连续平移。
// 坐标换算：世界 bbox（含 5% 留白）→ fit-contain 进固定尺寸 → 仿射映射。
import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'

const MAP_W = 216
const MAP_H = 150
const PAD = 8
const HEAD_H = 34 // Frame 折叠时的视觉高度（与 CanvasStage/canvasSlice 一致）

export function CanvasMiniMap(): JSX.Element | null {
  const frames = useStore((s) => s.canvas.frames)
  const vp = useStore((s) => s.canvas.viewport)
  const setViewport = useStore((s) => s.setViewport)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ offX: number; offY: number } | null>(null)
  const [collapsed, setCollapsed] = useState(true) // 默认收起：只在左下角留一个小图标，不占画布

  const fh = (f: { collapsed: boolean; h: number }): number => (f.collapsed ? HEAD_H : f.h)

  // 世界 bbox（四周各留 5%）——空画布给个虚拟窗口，避免除零
  const world = useMemo(() => {
    if (!frames.length) return { minX: 0, minY: 0, w: 2000, h: 1500 }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const f of frames) {
      minX = Math.min(minX, f.x)
      minY = Math.min(minY, f.y)
      maxX = Math.max(maxX, f.x + f.w)
      maxY = Math.max(maxY, f.y + fh(f))
    }
    const wW = Math.max(1, maxX - minX)
    const wH = Math.max(1, maxY - minY)
    return { minX: minX - wW * 0.05, minY: minY - wH * 0.05, w: wW * 1.1, h: wH * 1.1 }
  }, [frames])

  // fit-contain 到地图可用区并居中
  const map = useMemo(() => {
    const availW = MAP_W - PAD * 2
    const availH = MAP_H - PAD * 2
    const s = Math.min(availW / world.w, availH / world.h)
    const dw = world.w * s
    const dh = world.h * s
    return { dx: PAD + (availW - dw) / 2, dy: PAD + (availH - dh) / 2, dw, dh, scale: s }
  }, [world])

  const w2m = (wx: number, wy: number): { x: number; y: number } => ({
    x: map.dx + (wx - world.minX) * map.scale,
    y: map.dy + (wy - world.minY) * map.scale
  })
  const m2w = (mx: number, my: number): { wx: number; wy: number } => ({
    wx: world.minX + (mx - map.dx) / map.scale,
    wy: world.minY + (my - map.dy) / map.scale
  })

  // 当前可视世界区域 → 地图坐标（画布 transform 是 translate(vp.x,vp.y) scale(vp.scale)）
  const el = document.querySelector('.canvas-viewport') as HTMLElement | null
  const cw = el?.clientWidth ?? window.innerWidth
  const ch = el?.clientHeight ?? window.innerHeight
  const tl = w2m(-vp.x / vp.scale, -vp.y / vp.scale)
  const br = w2m((-vp.x + cw) / vp.scale, (-vp.y + ch) / vp.scale)
  const view = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }

  // 把世界坐标点居中到画布（保持缩放）
  const panTo = (wx: number, wy: number): void => {
    setViewport({ x: cw / 2 - wx * vp.scale, y: ch / 2 - wy * vp.scale, scale: vp.scale })
  }

  const localPoint = (e: { clientX: number; clientY: number }): { mx: number; my: number } => {
    const r = svgRef.current!.getBoundingClientRect()
    return { mx: e.clientX - r.left, my: e.clientY - r.top }
  }

  const onMapDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const { mx, my } = localPoint(e)
    // 落在视口框内 → 拖动它（保持按下点相对框中心的偏移，框不会瞬移到鼠标下）
    const inView = mx >= view.x && mx <= view.x + view.w && my >= view.y && my <= view.y + view.h
    dragRef.current = inView
      ? { offX: mx - (view.x + view.w / 2), offY: my - (view.y + view.h / 2) }
      : { offX: 0, offY: 0 }
    if (!inView) {
      const { wx, wy } = m2w(mx, my)
      panTo(wx, wy)
    }
    const onMove = (ev: MouseEvent): void => {
      const d = dragRef.current
      if (!d || !svgRef.current) return
      const r = svgRef.current.getBoundingClientRect()
      const { wx, wy } = m2w(ev.clientX - r.left - d.offX, ev.clientY - r.top - d.offY)
      panTo(wx, wy)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 收起态：只留一个小图标按钮（画布左下角不被占用）
  if (collapsed) {
    return (
      <button
        className="canvas-minimap-mini"
        data-tip="展开画布缩略图"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setCollapsed(false)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
          <path d="M9 4v13.5M15 6.5V20" />
        </svg>
      </button>
    )
  }

  return (
    <div className="canvas-minimap" onMouseDown={(e) => e.stopPropagation()}>
      <div className="cmm-head">
        <span className="cmm-title">缩略图</span>
        <span className="cmm-spacer" />
        <button className="cmm-fold" data-tip="收起缩略图" onClick={() => setCollapsed(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 14h6v6" />
            <path d="M20 10h-6V4" />
            <path d="M14 10 21 3" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      </div>
      {(
        <svg
          ref={svgRef}
          className="cmm-svg"
          width={MAP_W}
          height={MAP_H}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          onMouseDown={onMapDown}
        >
          {/* 世界底板 */}
          <rect
            x={map.dx}
            y={map.dy}
            width={map.dw}
            height={map.dh}
            rx={4}
            className="cmm-board"
          />
          {frames.map((f) => {
            const p = w2m(f.x, f.y)
            const w = Math.max(2, f.w * map.scale)
            const h = Math.max(2, fh(f) * map.scale)
            const showName = w >= 26 && h >= 9
            return (
              <g key={f.id}>
                <rect
                  x={p.x}
                  y={p.y}
                  width={w}
                  height={h}
                  rx={1.5}
                  className={`cmm-frame${f.parentId ? ' sub' : ''}`}
                />
                {showName && (
                  <text x={p.x + 3} y={p.y + 8} className="cmm-name" clipPath="url(#cmm-clip)">
                    {f.name.length > Math.floor(w / 5) ? f.name.slice(0, Math.floor(w / 5)) + '…' : f.name}
                  </text>
                )}
              </g>
            )
          })}
          {/* 当前视口范围 */}
          <rect
            x={view.x}
            y={view.y}
            width={Math.max(3, view.w)}
            height={Math.max(3, view.h)}
            rx={2}
            className="cmm-view"
          />
          {!frames.length && (
            <text x={MAP_W / 2} y={MAP_H / 2} className="cmm-empty">
              暂无 Frame
            </text>
          )}
        </svg>
      )}
    </div>
  )
}
