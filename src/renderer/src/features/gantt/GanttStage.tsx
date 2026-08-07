// 甘特图：横轴时间，一行一个项目，同项目并行的任务在行内上下堆叠。
//
// 为什么并行要堆叠而不是重叠半透明：叠住的标题读不出来，非 hover 不可，
// 而这张图的价值就在于扫一眼知道当时在干什么。
import { useEffect, useMemo, useState } from 'react'

import { useStore } from '../../store'
import type { GanttTask } from '../../../../shared/types'
import './gantt.css'

/** 一屏的时间跨度：默认最近 8 小时。刻度到分。 */
const SPAN_MS = 8 * 60 * 60 * 1000
const MIN_BAR_PX = 3
/** 条内放得下 10 个字大约需要这么宽；不够就把标签移到条右边 */
const LABEL_INSIDE_MIN_PX = 86

const two = (n: number): string => String(n).padStart(2, '0')
const hhmm = (t: number): string => {
  const d = new Date(t)
  return two(d.getHours()) + ':' + two(d.getMinutes())
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

  // 进来读一次，之后每 20 秒刷一次（有任务在跑时右端要跟着长）
  useEffect(() => {
    let alive = true
    const pull = (): void => {
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
  }, [])

  const t1 = now
  const t0 = now - SPAN_MS

  const byProject = useMemo(() => {
    const m = new Map<string, GanttTask[]>()
    for (const t of tasks) {
      if ((t.endAt ?? now) < t0) continue // 整条都在窗口左边，跳过
      const arr = m.get(t.projectId) ?? []
      arr.push(t)
      m.set(t.projectId, arr)
    }
    return m
  }, [tasks, t0, now])

  /** 刻度：每小时一根，标到分 */
  const ticks = useMemo(() => {
    const out: number[] = []
    const first = Math.ceil(t0 / 3600000) * 3600000
    for (let t = first; t <= t1; t += 3600000) out.push(t)
    return out
  }, [t0, t1])

  const pct = (t: number): number => ((t - t0) / SPAN_MS) * 100

  const jump = (t: GanttTask): void => {
    setViewMode('board')
    setBoardFullscreen(t.leafId)
  }

  const rows = projects.filter((p) => byProject.has(p.id))

  return (
    <div className="gantt">
      <div className="gantt-head">
        <div className="gantt-title">最近 8 小时 · 每根条是一次「你发出去的话 → agent 干完」</div>
      </div>
      <div className="gantt-grid">
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
                            setHover({ t, x: ev.clientX, y: ev.currentTarget.getBoundingClientRect().bottom })
                          }
                          onMouseLeave={() => setHover(null)}
                          onClick={() => jump(t)}
                        >
                          {state === 'aborted' && (
                            <svg className="gantt-abort-ico" viewBox="0 0 24 24" width="10" height="10"
                              fill="none" stroke="currentColor" strokeWidth="2.6">
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
