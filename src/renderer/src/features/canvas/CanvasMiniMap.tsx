// 画布缩略图（左下角小地图）：总览所有 Frame 的位置与名称 + 当前视口范围框。
// 点击地图任意处 → 画布平移过去（保持缩放）；拖视口框 → 连续平移。
// 坐标换算：世界 bbox（含 5% 留白）→ fit-contain 进固定尺寸 → 仿射映射。
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { statusColor, statusOfFrame } from './frameStatus'

const MAP_W = 216
const MAP_H = 150
const PAD = 8
const HEAD_H = 34 // Frame 折叠时的视觉高度（与 CanvasStage/canvasSlice 一致）

// 地图标签用短名：按显示宽度截断（中文/日文算 2 单位、其它算 1，上限 4 单位）
// → 中文取前 2 个字，英文取前 4 个字符，各标签长度观感一致
function shortName(name: string): string {
  let out = ''
  let w = 0
  for (const ch of name.trim()) {
    const cw = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ch) ? 2 : 1
    if (w + cw > 4) break
    out += ch
    w += cw
  }
  return out || name.slice(0, 4)
}

export function CanvasMiniMap(): JSX.Element | null {
  const maximizedNode = useStore(liveMaximizedNode)
  const frames = useStore((s) => s.canvas.frames)
  // 状态在项目上，不在 Frame 上 —— 点的颜色要查项目
  const projects = useStore((s) => s.projects)
  const freeNodes = useStore((s) => s.canvas.freeNodes)
  const vp = useStore((s) => s.canvas.viewport)
  const setViewport = useStore((s) => s.setViewport)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ offX: number; offY: number } | null>(null)
  const [collapsed, setCollapsed] = useState(true) // 默认收起：只在左下角留一个小图标，不占画布
  // hover 到某个点：点轻微放大 + 跟随鼠标的气泡显示全称（地图上的标签是截断过的短名，
  // 中文只剩 2 个字，光看标签分不出「笔纵画板」和「笔纵后台」）。
  // 判定不挂在可见的点上——它 r=2，鼠标几乎压不中；单独放一个大一圈的透明命中圈接管。
  const [hot, setHot] = useState<{ id: string; name: string; x: number; y: number } | null>(null)

  const fh = (f: { collapsed: boolean; h: number }): number => (f.collapsed ? HEAD_H : f.h)

  // 世界 bbox（四周各留 5%）——空画布给个虚拟窗口，避免除零。自由节点没有 Frame 兜着，
  // 位置可能落在所有 Frame 之外，不算进 bbox 的话缩略图会把它们裁没了。
  const world = useMemo(() => {
    if (!frames.length && !freeNodes.length) return { minX: 0, minY: 0, w: 2000, h: 1500 }
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
    for (const n of freeNodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.w)
      maxY = Math.max(maxY, n.y + n.h)
    }
    const wW = Math.max(1, maxX - minX)
    const wH = Math.max(1, maxY - minY)
    return { minX: minX - wW * 0.05, minY: minY - wH * 0.05, w: wW * 1.1, h: wH * 1.1 }
  }, [frames, freeNodes])

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
  if (maximizedNode) return null // 最大化时让位（沉浸式）
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
          {/* 只标「Frame 左上角的位置 + 名称」，不画 Frame 大小；名称等大、统一截断 */}
          {frames.map((f) => {
            const p = w2m(f.x, f.y)
            return (
              <g key={f.id}>
                {/* 打了状态标签的点跟 Frame 同色：缩略图本来就是「远看全局」，
                    状态色在这儿比在画布上更值钱 */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={2}
                  className={`cmm-dot${f.parentId ? ' sub' : ''}${hot?.id === f.id ? ' hot' : ''}`}
                  // 颜色跟着项目状态走（f.status 是旧结构，已经迁到项目上了）
                  {...(() => {
                    const c = statusColor(statusOfFrame(frames, projects, f.id))
                    return c ? { fill: c, 'data-tint': '1' } : {}
                  })()}
                />
                <text x={p.x + 4} y={p.y + 3} className={`cmm-name${f.parentId ? ' sub' : ''}`}>
                  {shortName(f.name)}
                </text>
                {/* 透明命中圈：判定范围比可见的点大一圈。放在点和文字之后 ——
                    SVG 后画的在上层，它才接管得到 hover。onMouseDown 不拦，
                    照旧冒泡到 <svg> 走「点地图任意处 → 平移过去」。 */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  className="cmm-hit"
                  onMouseEnter={(e) =>
                    setHot({ id: f.id, name: f.name, x: e.clientX, y: e.clientY })
                  }
                  onMouseMove={(e) =>
                    setHot((h) => (h?.id === f.id ? { ...h, x: e.clientX, y: e.clientY } : h))
                  }
                  // 只清掉自己那条：命中圈会互相重叠，离开 A 时可能已经进了 B，
                  // 无条件 setHot(null) 会把 B 刚设好的状态抹掉（气泡闪一下就没）
                  onMouseLeave={() => setHot((h) => (h?.id === f.id ? null : h))}
                />
              </g>
            )
          })}
          {/* 自由节点：只打点不写名字（数量可能不少，缩略图上标满名字会糊成一团） */}
          {freeNodes.map((n) => {
            const p = w2m(n.x, n.y)
            return <circle key={n.id} cx={p.x} cy={p.y} r={2} className="cmm-dot free" />
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
          {!frames.length && !freeNodes.length && (
            <text x={MAP_W / 2} y={MAP_H / 2} className="cmm-empty">
              暂无 Frame
            </text>
          )}
        </svg>
      )}
      {/* 气泡走 portal 到 body：跟右键菜单同一套做法。缩略图自己带 transition/z-index，
          浮层留在里面迟早会被裁或被压。偏移 +12/+14 是为了不压在光标底下。 */}
      {hot &&
        createPortal(
          <div className="app-tooltip cmm-tip" style={{ left: hot.x + 12, top: hot.y + 14 }}>
            {hot.name}
          </div>,
          document.body
        )}
    </div>
  )
}
