// 节点连线图（SVG）。布局与几何在 `radial.ts`（纯函数、有测试），这里只画。
//
// ── 为什么用 SVG 而不是 canvas-2d ──────────────────────────────────────────
// 节点最多几十个，SVG 的开销完全够；换来的是**每个节点天然是个可交互元素**
// （hover / 点击 / 无障碍名字都不用自己做命中测试）。
// 双击迸发那个特效是另一回事 —— 那是每帧重画的粒子，canvas 才划算。

import { useMemo, useRef, useState } from 'react'
import {
  chordPath,
  labelAt,
  linkWidth,
  magnetOffset,
  radialLayout,
  type RadialNode
} from './radial.ts'
import { forceLayout, pickLabels } from './forceLayout.ts'

export interface GraphItem extends RadialNode {
  label: string
  color: string
  /** 悬停时显示的一行说明 */
  hint?: string
}

export interface GraphLink {
  from: string
  to: string
  count: number
  /** 这条线参与运行时循环 —— 单独标出来 */
  cycle?: boolean
}

/** 排布方式。
 *  · `ring` —— 环形：**确定、不掉帧，任意两点之间的弦一眼可见**，答「谁和谁连」
 *  · `force` —— 力导向（知识图谱那种）：答「哪几块自然抱团」
 *  两者各答一半，所以是并列的两个视图，不是替换关系。 */
export type LayoutKind = 'ring' | 'force'

export function GraphCanvas({
  items,
  links,
  groupOrder,
  layout = 'ring',
  width = 520,
  height = 420,
  onPick
}: {
  items: GraphItem[]
  links: GraphLink[]
  groupOrder?: string[]
  layout?: LayoutKind
  width?: number
  height?: number
  onPick?: (id: string) => void
}): JSX.Element {
  /** 悬停的节点。**只用来做视觉突出，不改布局** —— 布局一动图就会跳，读不下去。 */
  const [hot, setHot] = useState<string | null>(null)
  /** 悬停节点的磁吸位移。**只作用在那一个节点上**，别的节点位置不动 ——
   *  「布局不因悬停而变」那条仍然成立，动的只是被指的那一个。 */
  const [pull, setPull] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  const placed = useMemo(
    () =>
      layout === 'force'
        ? forceLayout(items, links, width, height)
        : radialLayout(items, width, height, groupOrder),
    [layout, items, links, width, height, groupOrder]
  )
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed])
  /** 力导向下哪些标签能显示（环形不用挑 —— 标签朝外辐射，天然不撞）。
   *  被挑掉的那些 **hover 时仍然看得到**（`aria-label` 与 tooltip 都还在）。 */
  const labelled = useMemo(() => {
    if (layout !== 'force') return null
    const name = new Map(items.map((i) => [i.id, i.label]))
    return pickLabels(placed, (id) => name.get(id) ?? id)
  }, [layout, placed, items])
  const maxCount = useMemo(() => Math.max(...links.map((l) => l.count), 1), [links])
  const cx = width / 2
  const cy = height / 2

  /** 和悬停节点相连的那些 —— 它们保持亮，其余压暗。 */
  const related = useMemo(() => {
    if (!hot) return null
    const s = new Set<string>([hot])
    for (const l of links) {
      if (l.from === hot) s.add(l.to)
      if (l.to === hot) s.add(l.from)
    }
    return s
  }, [hot, links])

  if (!placed.length) {
    return <div className="cg-empty">没有可画的节点</div>
  }

  return (
    <svg
      ref={svgRef}
      className="cg-svg"
      viewBox={`0 0 ${width} ${height}`}
      // 图跟着容器缩放，但**不重排** —— 布局只依赖 width/height 这两个常量，
      // 所以同一份数据每次打开都长一样，用户找得回上次看的那块地。
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="模块依赖关系图"
    >
      {/* 连线先画，节点压在上面 */}
      <g className="cg-edges">
        {links.map((l) => {
          const a = byId.get(l.from)
          const b = byId.get(l.to)
          if (!a || !b) return null
          // 相邻节点用小 bend：大 bend 会让它们之间鼓出一个多余的包
          // 环形下「相邻」看角度；力导向没有环，改看**距离** ——
          // 近的用小 bend（大 bend 会在两点间鼓出一个多余的包），远的才弯
          const adjacent =
            layout === 'force'
              ? Math.hypot(a.x - b.x, a.y - b.y) < Math.min(width, height) * 0.22
              : Math.abs(a.angle - b.angle) < (Math.PI * 2) / placed.length + 0.01
          const dim = related ? !(related.has(l.from) && related.has(l.to)) : false
          return (
            <path
              key={`${l.from}→${l.to}`}
              d={chordPath(a, b, cx, cy, adjacent ? 0.12 : 0.55)}
              className={`cg-edge${l.cycle ? ' cyc' : ''}${dim ? ' dim' : ''}`}
              strokeWidth={linkWidth(l.count, maxCount)}
              fill="none"
            />
          )
        })}
      </g>

      <g className="cg-nodes">
        {placed.map((p) => {
          const it = items.find((i) => i.id === p.id)!
          const dim = related ? !related.has(p.id) : false
          const l = labelAt(p, cx, cy)
          return (
            <g
              key={p.id}
              className={`cg-node${dim ? ' dim' : ''}${hot === p.id ? ' hot' : ''}`}
              onMouseEnter={() => setHot(p.id)}
              onMouseLeave={() => {
                setHot(null)
                setPull({ x: 0, y: 0 })
              }}
              onMouseMove={(e) => {
                // 屏幕坐标 → viewBox 坐标：图是等比缩放铺进容器的，
                // **不换算的话缩放比不是 1 时磁吸方向会偏**
                const el = svgRef.current
                if (!el) return
                const b = el.getBoundingClientRect()
                const k = width / b.width
                setPull(magnetOffset((e.clientX - b.left) * k - p.x, (e.clientY - b.top) * k - p.y))
              }}
              transform={hot === p.id ? `translate(${pull.x.toFixed(2)} ${pull.y.toFixed(2)})` : undefined}
              onClick={() => onPick?.(p.id)}
              role={onPick ? 'button' : undefined}
              tabIndex={onPick ? 0 : undefined}
              aria-label={it.hint ? `${it.label}，${it.hint}` : it.label}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPick?.(p.id)
                }
              }}
            >
              {/* 命中区比圆点大一圈：小节点只有 5px 半径，照着圆点点很难点中 */}
              <circle cx={p.x} cy={p.y} r={Math.max(p.r + 6, 12)} className="cg-hit" />
              <circle cx={p.x} cy={p.y} r={p.r} fill={it.color} className="cg-dot" />
              {/* 力导向下叠上的标签藏掉（见 `pickLabels`）；悬停的那个永远显示 */}
              {(labelled === null || labelled.has(p.id) || hot === p.id) && (
                <text
                  x={l.x}
                  y={l.y}
                  textAnchor={l.anchor}
                  dominantBaseline="middle"
                  className="cg-label"
                >
                  {it.label}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
