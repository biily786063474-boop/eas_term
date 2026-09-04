// 节点连线图（SVG）。布局与几何在 `radial.ts`（纯函数、有测试），这里只画。
//
// ── 为什么用 SVG 而不是 canvas-2d ──────────────────────────────────────────
// 节点最多几十个，SVG 的开销完全够；换来的是**每个节点天然是个可交互元素**
// （hover / 点击 / 无障碍名字都不用自己做命中测试）。
// 双击迸发那个特效是另一回事 —— 那是每帧重画的粒子，canvas 才划算。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  chordPath,
  labelAt,
  linkWidth,
  magnetOffset,
  radialLayout,
  type RadialNode
,
  ARC_GAP,
  arcPath
} from './radial.ts'
import { forceLayout, pickLabels } from './forceLayout.ts'
import { Starfield } from './Starfield.tsx'

export interface GraphItem extends RadialNode {
  label: string
  /** **RGB 三元组**（如 `'253, 164, 175'` 或 `var(--sem-danger-rgb)`），
   *  不是成品颜色 —— 渲染层要按不同 alpha 组出体量/核心/内环三层。
   *
   *  ⚠️ **不要传掺过灰的颜色。** 把干净色相往近黑里 `color-mix` 会同时降明度和
   *  降饱和，出来是泥（2026-09-03 用户原话「配色也脏」）。
   *  干净色相 ＋ 低 alpha 压在暗底上才是干净的淡色。 */
  rgb: string
  /** 悬停时显示的一行说明 */
  hint?: string
  /** **被依赖占比**（入 /（出＋入））。画成节点外面那道细弧 ——
   *  弧跑满 = 大家都在用它，几乎没弧 = 它在用所有人。
   *  `null`/缺省 = 没有跨界依赖，不画弧（那和「占比 0」不是一回事）。 */
  ratio?: number | null
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
  onPick
}: {
  items: GraphItem[]
  links: GraphLink[]
  groupOrder?: string[]
  layout?: LayoutKind
  onPick?: (id: string) => void
}): JSX.Element {
  /** 悬停的节点。**只用来做视觉突出，不改布局** —— 布局一动图就会跳，读不下去。 */
  const [hot, setHot] = useState<string | null>(null)
  /** 悬停节点的磁吸位移。**只作用在那一个节点上**，别的节点位置不动 ——
   *  「布局不因悬停而变」那条仍然成立，动的只是被指的那一个。 */
  const [pull, setPull] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  /** 画布的**实际**尺寸。
   *
   *  ⚠️ 原来 viewBox 写死 520×420 —— 于是模块最大化铺满 1147px 宽之后，
   *  `preserveAspectRatio="meet"` 按**高度**去适配，图缩在中间只占一小块
   *  （实测 SVG 被 flex 压成 1134×182，图小得看不清标签）。
   *  量出来传给布局，图才会跟着它那块地长。 */
  const [box, setBox] = useState({ w: 520, h: 420 })
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = (): void => {
      // ⚠️ **必须用 clientWidth/Height，不能用 getBoundingClientRect。**
      // 这个组件活在画布里，而画布整层有 `transform: scale()` ——
      // rect 量的是**变换之后的屏幕尺寸**，画布缩到 44% 时量出来只有布局尺寸的 44%
      //（实测：computed height 390px，rect 170px），于是图按一个假的小尺寸布局。
      // clientWidth/Height 是布局尺寸，不受祖先 transform 影响。
      // 有下限：还没布局好时是 0，按 0 算会让所有节点挤在原点。
      setBox({ w: Math.max(320, el.clientWidth), h: Math.max(240, el.clientHeight) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const width = box.w
  const height = box.h

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
    <div className="cg-canvas-box" ref={boxRef}>
      {/* 环境光：铺在图底下，**不接鼠标** —— 鼠标事件要给节点和磁吸 */}
      <Starfield />
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
              {/* ── 三层同心，全是**平的**：没有假光照，细节靠结构不靠渐变 ──
                  ① 体量：低 alpha 的盘，半径 = 内容量
                  ② 内环：发丝级，把边缘定住 —— 纯低 alpha 的盘边缘会糊
                  ③ 核心：一个小而实的点，给它一个精确的「重心」
                  这套是仪表/科学制图的语汇，扁平但不单薄。 */}
              {/* ── 同心圆：**同一个色相、三档明度**（用户 2026-09-03 定的）──
                  外圈最淡、中圈中等、核心最实 —— 层次靠明度不靠色相，
                  和图纸 15 规矩 ④ 是同一条。纯度比上一版高：
                  上一版为了「克制」把 alpha 压得太低，出来是灰扑扑的，
                  而克制该体现在**面积**上（外圈很淡、核心很小），不是把颜色洗掉。 */}
              <circle cx={p.x} cy={p.y} r={p.r} fill={`rgba(${it.rgb}, 0.14)`} className="cg-dot" />
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r * 0.68}
                fill={`rgba(${it.rgb}, 0.34)`}
                className="cg-mid"
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={Math.max(2, p.r * 0.34)}
                fill={`rgba(${it.rgb}, 0.95)`}
                className="cg-core"
              />
              {/* 出入弧：长度 = 被依赖占比。**没有跨界依赖时不画** */}
              {typeof it.ratio === 'number' && (
                <path
                  d={arcPath(p.x, p.y, p.r + ARC_GAP, it.ratio)}
                  className="cg-arc"
                  stroke={`rgba(${it.rgb}, 0.75)`}
                  fill="none"
                />
              )}
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
    </div>
  )
}
