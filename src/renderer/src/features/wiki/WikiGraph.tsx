// 知识图谱。节点=笔记，边=[[双链]]。
//
// 卡帕西原话：Obsidian 的图谱是「看清 wiki 形状最好的方式 —— 什么连着什么、
// 哪些是枢纽、哪些是孤儿」。注意他说的用途是**看形状**，不是日常查询 ——
// 所以这块和体检是一对：图谱让你看见孤儿页，体检告诉你该拿它们怎么办。
//
// 自己画而不是引图布局库：项目里没有 d3，为一个视图加一整个依赖不划算。
// 力导向那点数学（斥力 + 弹簧 + 阻尼）一百来行就够，而且能完全控制性能。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WikiGraph as GraphData } from '../../../../shared/types'

interface P {
  x: number
  y: number
  vx: number
  vy: number
}

/** 标签 → 颜色。同一个标签在任何一次渲染里颜色都一样（按名字哈希，不随机） */
function tagColor(tag: string | undefined): string {
  if (!tag) return '#525252'
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  const palette = ['#6ee7b7', '#7dd3fc', '#c4b5fd', '#fcd34d', '#fda4af', '#a5b4fc', '#5eead4']
  return palette[h % palette.length]
}

export function WikiGraph({ onOpen }: { onOpen: (rel: string) => void }): JSX.Element {
  const [data, setData] = useState<GraphData | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const posRef = useRef<Map<string, P>>(new Map())
  const rafRef = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.wiki.graph().then(setData)
  }, [])

  const adj = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of data?.edges ?? []) {
      if (!m.has(e.from)) m.set(e.from, [])
      m.get(e.from)!.push(e.to)
    }
    return m
  }, [data])

  useEffect(() => {
    const cv = canvasRef.current
    const box = boxRef.current
    if (!cv || !box || !data || !data.nodes.length) return
    const dpr = window.devicePixelRatio || 1
    const resize = (): void => {
      cv.width = box.clientWidth * dpr
      cv.height = box.clientHeight * dpr
      cv.style.width = box.clientWidth + 'px'
      cv.style.height = box.clientHeight + 'px'
    }
    resize()

    const pos = posRef.current
    const n = data.nodes.length
    let seeded = false
    // 撒点必须等 flex 布局定下来再做：在 effect 里立刻读 clientHeight 拿到的是
    // 还没撑开的高度，撒出来的圆挤在顶部，而退火降温太快、centering 力来不及把它拉回中间。
    // 所以推迟到第一帧 step() 里用实时尺寸撒。
    const seed = (W: number, H: number): void => {
      data.nodes.forEach((node, i) => {
        if (pos.has(node.id)) return
        const a = (i / n) * Math.PI * 2
        const R = Math.min(W, H) / 3
        pos.set(node.id, { x: W / 2 + Math.cos(a) * R, y: H / 2 + Math.sin(a) * R, vx: 0, vy: 0 })
      })
      seeded = true
    }

    let alpha = 1 // 退火：慢慢降温，最后停下来，别让它永远抖
    const step = (): void => {
      const W = box.clientWidth
      const H = box.clientHeight
      if (!seeded) seed(W, H)
      // 斥力：所有点互相推开。n 不大（几百），O(n²) 完全够用
      for (let i = 0; i < data.nodes.length; i++) {
        const a = pos.get(data.nodes[i].id)!
        for (let j = i + 1; j < data.nodes.length; j++) {
          const b = pos.get(data.nodes[j].id)!
          let dx = a.x - b.x
          let dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            d2 = 1
          }
          const f = (2600 * alpha) / d2
          const d = Math.sqrt(d2)
          a.vx += (dx / d) * f
          a.vy += (dy / d) * f
          b.vx -= (dx / d) * f
          b.vy -= (dy / d) * f
        }
      }
      // 弹簧：有链接的互相拉近
      for (const e of data.edges) {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const f = (d - 110) * 0.012 * alpha
        a.vx += (dx / d) * f
        a.vy += (dy / d) * f
        b.vx -= (dx / d) * f
        b.vy -= (dy / d) * f
      }
      // 向心 + 阻尼 + 边界
      for (const node of data.nodes) {
        const p = pos.get(node.id)!
        p.vx += (W / 2 - p.x) * 0.004 * alpha
        p.vy += (H / 2 - p.y) * 0.004 * alpha
        p.vx *= 0.86
        p.vy *= 0.86
        p.x = Math.max(24, Math.min(W - 24, p.x + p.vx))
        p.y = Math.max(24, Math.min(H - 24, p.y + p.vy))
      }
      alpha *= 0.985

      const ctx = cv.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      // 边
      ctx.lineWidth = 1
      for (const e of data.edges) {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) continue
        const lit = hover && (e.from === hover || e.to === hover)
        ctx.strokeStyle = lit ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.09)'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      // 点：半径随入链数长，一眼看出谁是枢纽；没有入链的画空心 = 孤儿
      for (const node of data.nodes) {
        const p = pos.get(node.id)!
        const r = 4 + Math.min(7, node.inbound * 1.6)
        const c = tagColor(node.tags[0])
        const isHover = hover === node.id
        ctx.beginPath()
        ctx.arc(p.x, p.y, isHover ? r + 2 : r, 0, Math.PI * 2)
        if (node.inbound === 0) {
          ctx.strokeStyle = c
          ctx.lineWidth = 1.5
          ctx.stroke()
        } else {
          ctx.fillStyle = c
          ctx.fill()
        }
        if (isHover || n <= 40) {
          ctx.fillStyle = isHover ? '#f5f5f5' : 'rgba(245,245,245,0.55)'
          ctx.font = `${isHover ? 12 : 10.5}px -apple-system, "PingFang SC", sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(node.title.slice(0, 12), p.x, p.y - r - 5)
        }
      }
      if (alpha > 0.004) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    const ro = new ResizeObserver(() => {
      resize()
      // 尺寸变了要重新升温，否则点会卡在按旧尺寸算出来的位置上
      alpha = Math.max(alpha, 0.5)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(step)
    })
    ro.observe(box)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [data, hover])

  const hit = (e: React.MouseEvent): string | null => {
    const box = boxRef.current
    if (!box || !data) return null
    const r = box.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    let best: string | null = null
    let bd = 18
    for (const node of data.nodes) {
      const p = posRef.current.get(node.id)
      if (!p) continue
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < bd) {
        bd = d
        best = node.id
      }
    }
    return best
  }

  if (!data) return <div className="pane-placeholder">读取图谱…</div>
  if (!data.nodes.length)
    return <div className="pane-placeholder">还没有笔记 —— 先往收件箱丢点东西，让 agent 整理出几篇</div>

  const orphans = data.nodes.filter((x) => !x.inbound).length
  return (
    <div className="wg" ref={boxRef}>
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => setHover(hit(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const id = hit(e)
          if (id) onOpen(id)
        }}
      />
      <div className="wg-legend">
        {data.nodes.length} 篇 · {data.edges.length} 条链接
        {!!orphans && <em> · {orphans} 个孤儿页（空心点）</em>}
        <span>点大小 = 被引用次数 · 颜色 = 首个标签</span>
      </div>
      {!!hover && (
        <div className="wg-tip">
          {data.nodes.find((x) => x.id === hover)?.title}
          <em>
            入 {data.nodes.find((x) => x.id === hover)?.inbound} · 出{' '}
            {adj.get(hover)?.length ?? 0}
          </em>
        </div>
      )}
    </div>
  )
}
