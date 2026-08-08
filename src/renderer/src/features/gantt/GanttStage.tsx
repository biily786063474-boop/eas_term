// 甘特图：横轴时间，一行一个项目，同项目并行的任务在行内上下堆叠。
//
// 为什么并行要堆叠而不是重叠半透明：叠住的标题读不出来，非 hover 不可，
// 而这张图的价值就在于扫一眼知道当时在干什么。
//
// 时间跨度（Task 6 新增）：主区默认看最近 24 小时，可切 3 天；底部导航带画完整
// 7 天全景（对齐主进程 gantt.ts 的保留期），拖取景框选看哪一段。「丝滑」那几条
// 硬要求（transform 不改 left/width、拖拽中不 setState、取景框跟手无延迟等）
// 的实现细节写在 GanttNavigator.tsx 顶部，这里只用它暴露的几个回调。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useStore } from '../../store'
import type { GanttTask } from '../../../../shared/types'
import { GanttNavigator, PANORAMA_MS, clampViewStart } from './GanttNavigator'
import './gantt.css'

const DAY_MS = 24 * 60 * 60 * 1000
/** 主区跨度档位：默认 24 小时，可切 3 天。导航带那 7 天全景不在这个列表里——
 *  全景固定不可切，只有主区看多宽是可切的。 */
const SPAN_OPTIONS = [
  { key: '24h', label: '24 小时', ms: DAY_MS },
  { key: '3d', label: '3 天', ms: 3 * DAY_MS }
] as const

const MIN_BAR_PX = 3
/** 条内放得下 10 个字大约需要这么宽；不够就把标签移到条右边 */
const LABEL_INSIDE_MIN_PX = 86

const two = (n: number): string => String(n).padStart(2, '0')
const hhmm = (t: number): string => {
  const d = new Date(t)
  return two(d.getHours()) + ':' + two(d.getMinutes())
}
const mmdd = (t: number): string => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const dur = (ms: number): string => {
  const s = Math.round(ms / 1000)
  if (s < 60) return s + ' 秒'
  const m = Math.round(s / 60)
  return m < 60 ? m + ' 分钟' : (m / 60).toFixed(1) + ' 小时'
}

/** 同一行内把重叠的任务分到不同层 —— 贪心：能放下就放，放不下开新层 */
function layer(tasks: GanttTask[], now: number): GanttTask[][] {
  const rows: GanttTask[][] = []
  for (const t of [...tasks].sort((a, b) => a.startAt - b.startAt)) {
    const end = t.endAt ?? now
    const row = rows.find((r) => (r[r.length - 1].endAt ?? now) <= t.startAt)
    if (row) row.push(t)
    else rows.push([t])
  }
  return rows
}

export function GanttStage(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const setViewMode = useStore((s) => s.setViewMode)
  const setBoardFullscreen = useStore((s) => s.setBoardFullscreen)
  const [tasks, setTasks] = useState<GanttTask[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [hover, setHover] = useState<{ t: GanttTask; x: number; y: number } | null>(null)

  /** 取景框左边缘（毫秒时间戳）。null = 贴住右端、跟随 now；一旦拖过就固定成
   *  具体值，不再自动跟随——否则往回看历史时窗口会自己漂走。 */
  const [viewStart, setViewStart] = useState<number | null>(null)
  const [span, setSpan] = useState<number>(DAY_MS)
  /** 是否正在拖取景框。只在拖拽"开始/结束"这两个离散时刻才 setState，
   *  拖拽过程中的每一帧绝不经过这里——那是 GanttNavigator 直接改 DOM 的事。 */
  const [dragging, setDragging] = useState(false)

  // 主区里"跟着时间轴走"的那部分（顶部刻度 + 每行的 lanes）的容器。拖拽预览期间
  // 直接对着里面匹配到的节点改 transform，不碰 React state——见 previewDrag。
  const plotRef = useRef<HTMLDivElement>(null)
  const dragBaseRef = useRef<{ t0: number; widthPx: number; els: HTMLElement[] } | null>(null)

  // 进来读一次，之后每 20 秒刷一次（有任务在跑时右端要跟着长）。
  // 拖拽中跳过这次刷新：既不给"拖拽中不 setState"的规则开口子，也避免轮询数据
  // 和拖拽预览的 transform 用的是两套不同基准、同一帧里打架（表现为轻微跳动）。
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      if (dragging) return
      void window.api.gantt.list().then((l) => {
        if (alive) setTasks(l)
      })
      setNow(Date.now())
    }
    pull()
    const id = window.setInterval(pull, 20000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [dragging])

  const panoramaEnd = now
  const panoramaStart = now - PANORAMA_MS

  // 取景框位置换算主区时间窗：viewStart 为 null 时贴住 now；一旦有具体值就固定住，
  // t1 不再跟 now 走（不然回看历史时窗口会自己往前漂）。
  const t1 = viewStart === null ? now : viewStart + span
  const t0 = t1 - span

  const byProject = useMemo(() => {
    const m = new Map<string, GanttTask[]>()
    for (const t of tasks) {
      if ((t.endAt ?? now) < t0) continue // 整条都在窗口左边，跳过
      // 整条都在窗口右边也要跳过——8 小时固定窗口时代这条从不会命中（没有任务
      // 发生在"未来"），但取景框能拖去看任意历史窗口之后，t1 不再等于 now，
      // 一个项目"更晚"的任务完全可能晚于当前查看的 t1。漏了这一半会让该项目
      // 在查看历史时多出一整行，行里却没有任何看得见的条——本任务实测触发过。
      if (t.startAt > t1) continue
      const arr = m.get(t.projectId) ?? []
      arr.push(t)
      m.set(t.projectId, arr)
    }
    return m
  }, [tasks, t0, t1, now])

  /** 刻度密度按跨度档位调整：24 小时档每 2 小时一根，3 天档每 6 小时一根，
   *  否则 24 根挤在一起太密。 */
  const tickStepMs = span === DAY_MS ? 2 * 3600000 : 6 * 3600000

  const ticks = useMemo(() => {
    const out: number[] = []
    const first = Math.ceil(t0 / tickStepMs) * tickStepMs
    for (let t = first; t <= t1; t += tickStepMs) out.push(t)
    return out
  }, [t0, t1, tickStepMs])

  const pct = (t: number): number => ((t - t0) / span) * 100

  const jump = (t: GanttTask): void => {
    setViewMode('board')
    setBoardFullscreen(t.leafId)
  }

  const rows = projects.filter((p) => byProject.has(p.id))

  // 提交视图后（拖拽松手 / 点导航带跳转 / 切跨度），把预览阶段留下的临时 transform
  // 清掉。用 layout 版本的 effect：赶在浏览器绘制前，跟"React 已经按新 t0 重排好
  // 的真实条位置"合成到同一帧，不会先闪一下旧位置再跳到新位置。
  useLayoutEffect(() => {
    const root = plotRef.current
    if (!root) return
    const els = root.querySelectorAll<HTMLElement>('.gantt-axis, .gantt-lanes')
    els.forEach((el) => {
      el.style.transform = ''
    })
  }, [t0])

  const beginDrag = (): void => {
    const root = plotRef.current
    if (!root) return
    const axis = root.querySelector<HTMLElement>('.gantt-axis')
    const els = Array.from(root.querySelectorAll<HTMLElement>('.gantt-axis, .gantt-lanes'))
    dragBaseRef.current = { t0, widthPx: axis?.getBoundingClientRect().width ?? 0, els }
    setDragging(true)
  }

  /** 拖拽中的预览：把"刻度 + 各行的条"当一整块刚性图层平移，不重算任何一根条的
   *  left/width。方向推导：取景框往右拖 = 用户想看更晚的时间，新窗口的 t0 变大；
   *  相对当前这帧已经画好的旧位置，"更晚的内容"应该往左移（像内容在时间轴上被
   *  卷走），所以用 -deltaMs 换算成像素。 */
  const previewDrag = (candidateViewStart: number): void => {
    const base = dragBaseRef.current
    if (!base || base.widthPx <= 0) return
    const deltaMs = candidateViewStart - base.t0
    const deltaPx = -(deltaMs / span) * base.widthPx
    for (const el of base.els) el.style.transform = `translateX(${deltaPx}px)`
  }

  const commitView = (finalViewStart: number): void => {
    dragBaseRef.current = null
    setDragging(false)
    setViewStart(clampViewStart(finalViewStart, panoramaStart, panoramaEnd, span))
  }

  /** 切跨度：右边缘保持不动（用户通常关心的是"往前看多久"）。贴住 now 的情况
   *  天然满足（t1 = now，跟 span 无关）；固定在历史某点时，要把 viewStart
   *  往回退，抵消 span 变化对 t1 的影响。 */
  const changeSpan = (nextSpan: number): void => {
    setViewStart((prev) => {
      if (prev === null) return prev
      const oldT1 = prev + span
      return clampViewStart(oldT1 - nextSpan, panoramaStart, panoramaEnd, nextSpan)
    })
    setSpan(nextSpan)
  }

  const rangeLabel =
    viewStart === null
      ? `最近 ${span === DAY_MS ? '24 小时' : '3 天'}`
      : `${mmdd(t0)} ${hhmm(t0)} – ${mmdd(t1)} ${hhmm(t1)}`

  return (
    <div className="gantt">
      <div className="gantt-head">
        <div className="gantt-title">{rangeLabel} · 每根条是一次「你发出去的话 → agent 干完」</div>
        <div className="gantt-span-toggle">
          {SPAN_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={span === opt.ms ? 'active' : ''}
              onClick={() => changeSpan(opt.ms)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="gantt-scroll">
        <div className="gantt-grid" ref={plotRef}>
          <div className="gantt-axis">
            {ticks.map((t) => (
              <div key={t} className="gantt-tick" style={{ left: pct(t) + '%' }}>
                <span>{hhmm(t)}</span>
              </div>
            ))}
          </div>
          {rows.length === 0 && (
            <div className="gantt-empty">
              这段时间还没有记录。数据从装上这一版才开始记 —— 让 agent 跑一件事就会出现。
            </div>
          )}
          {rows.map((p) => {
            const layers = layer(byProject.get(p.id) ?? [], now)
            return (
              <div className="gantt-row" key={p.id}>
                <div className="gantt-rowname" title={p.name}>
                  {p.name}
                </div>
                <div className="gantt-lanes">
                  {ticks.map((t) => (
                    <div key={t} className="gantt-vline" style={{ left: pct(t) + '%' }} />
                  ))}
                  {layers.map((ln, li) => (
                    <div className="gantt-lane" key={li}>
                      {ln.map((t) => {
                        const s = Math.max(t.startAt, t0)
                        const e = Math.min(t.endAt ?? now, t1)
                        const left = pct(s)
                        const w = Math.max(pct(e) - left, 0)
                        const state = t.aborted ? 'aborted' : t.endAt === null ? 'running' : 'done'
                        const wide = (w / 100) * 900 > LABEL_INSIDE_MIN_PX
                        const label = t.prompt.slice(0, 10)
                        return (
                          <div
                            key={t.id}
                            className={`gantt-bar ${state}${wide ? ' wide' : ''}`}
                            style={{ left: left + '%', width: `max(${MIN_BAR_PX}px, ${w}%)` }}
                            onMouseEnter={(ev) =>
                              setHover({
                                t,
                                x: ev.clientX,
                                y: ev.currentTarget.getBoundingClientRect().bottom
                              })
                            }
                            onMouseLeave={() => setHover(null)}
                            onClick={() => jump(t)}
                          >
                            {state === 'aborted' && (
                              <svg
                                className="gantt-abort-ico"
                                viewBox="0 0 24 24"
                                width="10"
                                height="10"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.6"
                              >
                                <path d="M12 8v5M12 16.5v.5" />
                                <circle cx="12" cy="12" r="9" />
                              </svg>
                            )}
                            <span className="gantt-bar-label">{label}</span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <GanttNavigator
        tasks={tasks}
        now={now}
        span={span}
        viewStart={viewStart}
        dragging={dragging}
        onDragStart={beginDrag}
        onDragPreview={previewDrag}
        onCommit={commitView}
      />
      {hover && (
        <div className="gantt-pop" style={{ left: hover.x, top: hover.y + 8 }}>
          <div className="gantt-pop-time">
            {hhmm(hover.t.startAt)} → {hover.t.endAt ? hhmm(hover.t.endAt) : '进行中'}
            {hover.t.endAt && <span className="gantt-pop-dur">{dur(hover.t.endAt - hover.t.startAt)}</span>}
          </div>
          {hover.t.aborted && <div className="gantt-pop-abort">上次没有正常结束，结束时间未知</div>}
          <div className="gantt-pop-text">{hover.t.prompt}</div>
          {hover.t.follow?.map((f, i) => (
            <div className="gantt-pop-follow" key={i}>
              追加：{f}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
