// 甘特图：横轴时间，一行一个项目，同项目并行的任务在行内上下堆叠。
//
// 为什么并行要堆叠而不是重叠半透明：叠住的标题读不出来，非 hover 不可，
// 而这张图的价值就在于扫一眼知道当时在干什么。
//
// 时间跨度（Task 6 新增）：主区默认看最近 24 小时，可切 3 天；底部导航带画完整
// 7 天全景（对齐主进程 gantt.ts 的保留期），拖取景框选看哪一段。「丝滑」那几条
// 硬要求（transform 不改 left/width、拖拽中不 setState、取景框跟手无延迟等）
// 的实现细节写在 GanttNavigator.tsx 顶部，这里只用它暴露的几个回调。
//
// 双向绑定（Task 7 新增）：主区空白处（不是条上）也能直接拖着平移，取景框会
// 实时同步跟着动——两个入口共用同一个 viewStart，beginDrag/previewDrag/endDrag/
// commitView 这几个函数两边都在用，没有另起一套。取景框侧的同步走命令式 ref
// （GanttNavigator 暴露的 previewFrame/resetFrame），理由和取景框自己拖自己时
// 直接改 DOM 是同一个——拖拽中不能 setState。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useStore } from '../../store'
import type { GanttTask } from '../../../../shared/types'
import { attachBlurGuard } from '../../blurGuard'
import {
  GanttNavigator,
  PANORAMA_MS,
  DRAG_MOVE_THRESHOLD_PX,
  clampViewStart,
  mmdd,
  type GanttNavigatorHandle
} from './GanttNavigator'
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
/** hover 浮层跟条的间距、跟视口边缘的最小间距——数值沿用 useMenuAnchor
 *  （CanvasContextMenu.tsx）的 8px，两处视觉语言保持一致 */
const POP_GAP = 8
const POP_MARGIN = 8

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
  /** top/bottom 是条的 getBoundingClientRect()，不是单个 y——下边缘要判断
   *  "翻到条上方"，得同时知道条的上下沿，光一个点不够表达翻转。 */
  const [hover, setHover] = useState<{
    t: GanttTask
    x: number
    top: number
    bottom: number
  } | null>(null)
  // 浮层实测尺寸后夹回可视区、必要时翻到条上方；量出真实位置前用 visibility
  // 盖住，避免"先在错误位置画一帧再跳过去"。popRef 量尺寸，popPos 是算出来的
  // 最终位置（null = 还没量完）。这套技巧和 useMenuAnchor 是同一个配方，但没有
  // 直接调那个 hook——原因见下面 useLayoutEffect 前的注释。
  const popRef = useRef<HTMLDivElement>(null)
  const [popPos, setPopPos] = useState<{ x: number; y: number } | null>(null)

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
  // 导航带的命令式句柄（Task 7 新增）：主区拖拽时用它同步挪取景框、复位取景框，
  // 全程绕开 React state——细节见 GanttNavigator.tsx 里 GanttNavigatorHandle 的注释。
  const navRef = useRef<GanttNavigatorHandle>(null)
  /** 主区拖拽会话的收尾函数，供组件卸载时兜底摘监听器——跟 GanttNavigator 里同名
   *  机制对称（万一拖拽中途整个视图被切走，不能让 window 上残留的监听器继续摸一个
   *  已经卸载的组件）。 */
  const stageDragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stageDragCleanupRef.current?.(), [])

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

  // hover 浮层定位：为什么没有直接复用 useMenuAnchor（CanvasContextMenu.tsx），
  // 而是照它的做法另写一份——三个原因，前两个是行为不匹配，第三个是会让"表面复用
  // 成功、实际没修好 bug"：
  //
  // 1. useMenuAnchor 的"hidden 直到测量完"要生效，前提是每次打开都全新挂载
  //    （pos 状态从 null 起步——ModeSwitch.tsx 里 ModeMenu 特意拆成独立子组件，
  //    就是为了保证这一点，见那个文件里的注释）。这个浮层不满足这个前提：
  //    GanttStage 在整个甘特图视图的生命周期里只挂载一次，鼠标在相邻两根条
  //    之间移动时 hover 直接从任务 A 的数据变成任务 B 的数据（不经过 null），
  //    .gantt-pop 这个 DOM 节点全程不 unmount。如果把 useMenuAnchor 原样挂在
  //    这一级调用，它内部的 pos 状态会跨多次 hover 一直复用，不是每次都能从
  //    "位置未知"重新起步。
  // 2. useMenuAnchor 只夹回单点 (x, y)，没有"翻转"的概念——夹到视口边缘附近
  //    即可，不关心离锚点多远。下边缘这里要求的是翻到条的上方（贴着条），翻转
  //    需要同时知道条的 top 和 bottom，单点签名表达不出来。
  // 3. 最关键的一条：.gantt-pop 只设了 max-width，没有 min-width——宽度是内容
  //    撑开的（shrink-to-fit）。position:fixed 只给 left、不给 right 时，浏览器
  //    算 shrink-to-fit 宽度会参照"从 left 到视口右边缘还剩多少空间"；条在窗口
  //    右侧时鼠标离右边缘很近，这份"剩余空间"被挤到只剩几十像素，此时量出来的
  //    offsetWidth 就是被压扁之后的假宽度（用户截图里文字竖排、每行 3-5 个字，
  //    根源就是这个——见下方实测记录）。如果照搬 useMenuAnchor"就地量、算完再
  //    夹"的顺序，量出来的假宽度会让夹回算法误以为"反正已经很窄，不用怎么挪"，
  //    浮层还是被压扁在原地。解法是让 .gantt-pop 在布局上永远钉在 left:0/top:0
  //    （见 gantt.css 里的注释——那里离右边缘最远，shrink-to-fit 不会被挤压，
  //    量出来的永远是内容真实想要的尺寸），可视位置全部交给 transform:
  //    translate() 表达——transform 只影响绘制、不参与宽度的布局计算，"量多宽"
  //    和"摆哪儿"两件事因此互不干扰。
  useLayoutEffect(() => {
    if (!hover) {
      setPopPos(null) // 下次 hover 出现前不留旧坐标，重新从"隐藏"起步
      return
    }
    const el = popRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    // 优先展开到条下方；下方放不下就翻到条上方，让浮层始终贴着条，而不是飘去
    // 屏幕上一个"不出界但离条很远"的地方。两边都放不下（极端矮窗口）时兜底夹回
    // 视口内，不让浮层彻底飞出屏幕。
    const fitsBelow = hover.bottom + POP_GAP + h <= window.innerHeight - POP_MARGIN
    const y = fitsBelow ? hover.bottom + POP_GAP : Math.max(POP_MARGIN, hover.top - POP_GAP - h)
    const x = Math.max(POP_MARGIN, Math.min(hover.x, window.innerWidth - w - POP_MARGIN))
    setPopPos({ x, y })
  }, [hover])

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

  /** 拖拽会话收尾的公共部分：清掉预览用的基准、退出"正在拖拽"状态（恢复
   *  transition、恢复 20 秒轮询），并且清掉预览阶段可能留下的临时 transform。
   *  commitView 那条路径本可以指望"t0 变了"去触发下面按 [t0] 的 useLayoutEffect
   *  顺带清掉，但纯点击（位移没过阈值，直接走 endDrag、不改 viewStart）时 t0
   *  不变，那个 effect 不会重新跑——而只要 mousemove 哪怕只触发过一次，
   *  previewDrag 就已经在 .gantt-axis/.gantt-lanes 上写过 transform
   *  （导航带 1px 位移换算到主区是好几 px，不是可以忽略的量），不主动清会在
   *  主区留下一条松手后再也清不掉的偏移。这里直接清一次，比等 t0 变更稳妥；
   *  commitView 路径重复清一次是幂等操作，不会有副作用。 */
  const endDrag = (): void => {
    dragBaseRef.current = null
    setDragging(false)
    const root = plotRef.current
    if (root) {
      root.querySelectorAll<HTMLElement>('.gantt-axis, .gantt-lanes').forEach((el) => {
        el.style.transform = ''
      })
    }
  }

  const commitView = (finalViewStart: number): void => {
    endDrag()
    setViewStart(clampViewStart(finalViewStart, panoramaStart, panoramaEnd, span))
  }

  /** 主区空白处拖拽平移（Task 7 新增）：跟拖导航带取景框是同一个 viewStart、
   *  双向绑定的另一个入口，全程复用 beginDrag/previewDrag/endDrag/commitView——
   *  这几个函数已经把"缓存基准 t0/宽度""按候选 viewStart 换算 transform""收尾复位"
   *  "提交"这几件事做完了，这里只需要把"鼠标位移"换算成"候选 viewStart"接进去，
   *  再多一步把结果同步给取景框。
   *
   *  方向感照"拖地图"来，不是"拖滚动条"：往右拖 = 内容跟手往右走 = 左边露出更早
   *  之前卷进来的时间，所以候选 viewStart 要往回退（减号）。这个换算刚好是
   *  previewDrag 内部换算的逆运算——把这里算出的 latest 喂回 previewDrag，两次
   *  换算首尾相消，主区在整个拖拽过程中会跟鼠标位移严格 1:1（可以代数验证：
   *  previewDrag 的 deltaPx = -(candidateViewStart - base.t0)/span*base.widthPx，
   *  代入这里的 candidateViewStart = base.t0 - (deltaPx/base.widthPx)*span，
   *  化简后 deltaPx 原样冒出来），不是"大致跟手"，是精确跟手。
   *
   *  是否在 .gantt-bar 上按下决定要不要启动这次拖拽：选了"不启动"而不是"启动但
   *  过阈值才吃掉点击"——完全不用碰 .gantt-bar 自己的 onClick/hover，零风险；
   *  空白处（坐标轴一整条、行与行之间、没被条盖住的区域、空状态提示）本来就有
   *  足够大的可拖拽面积，不需要靠"抢"条上的按下事件换更大的命中区。这样"点条
   *  跳回终端"完全不受影响，因为拖拽逻辑压根不会在条上启动。 */
  const handleStageMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return // 只处理左键拖拽
    if ((e.target as HTMLElement).closest('.gantt-bar')) return // 落在条上：交给条自己的 onClick
    e.preventDefault() // 防止拖拽时选中项目名文字
    beginDrag()
    const base = dragBaseRef.current
    if (!base || base.widthPx <= 0) {
      endDrag() // 量不到宽度（比如这一帧还没铺满）：撤回刚设的 dragging，安全放弃
      return
    }

    const startClientX = e.clientX
    let moved = false
    let latest = base.t0
    let rafId: number | null = null
    let detachBlur = (): void => {}

    const onMove = (ev: MouseEvent): void => {
      const deltaPx = ev.clientX - startClientX
      if (!moved && Math.abs(deltaPx) > DRAG_MOVE_THRESHOLD_PX) moved = true
      const deltaMs = -(deltaPx / base.widthPx) * span
      latest = clampViewStart(base.t0 + deltaMs, panoramaStart, panoramaEnd, span)
      // 被拖的这一侧（主区自己）跟手无延迟：不等 rAF，每次 mousemove 直接写。
      previewDrag(latest)
      // 另一侧（导航带取景框）rAF 节流到每帧最多一次。
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          navRef.current?.previewFrame(latest)
        })
      }
    }

    const detach = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', finish)
      detachBlur()
      if (rafId !== null) cancelAnimationFrame(rafId)
      stageDragCleanupRef.current = null
    }
    const finish = (): void => {
      detach()
      if (moved) {
        commitView(latest)
        return
      }
      // 未过阈值：两侧都要显式复位，不能指望"没变就自动纠正"——viewStart 没变时
      // 两次渲染算出的 transform 字符串逐字节相同，React 的 style diff 判定"没变"
      // 会跳过重新写 DOM，手动写的偏移不会被这个机制自动清掉（这条坑在取景框
      // 拖自己那条路径上踩过一次，见 GanttNavigator.tsx 里 finish() 的注释）。
      endDrag()
      navRef.current?.resetFrame()
    }

    stageDragCleanupRef.current = detach
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finish)
    // 拖拽中真失焦：当场收尾；hide/show 抖动引起的假 blur 由 attachBlurGuard
    // 过滤掉（见 src/renderer/src/blurGuard.ts 注释），不会误伤正在进行的拖拽
    detachBlur = attachBlurGuard(finish)
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
      <div
        className={`gantt-scroll${dragging ? ' dragging' : ''}`}
        onMouseDown={handleStageMouseDown}
      >
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
                            onMouseEnter={(ev) => {
                              const r = ev.currentTarget.getBoundingClientRect()
                              setHover({ t, x: ev.clientX, top: r.top, bottom: r.bottom })
                            }}
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
        ref={navRef}
        tasks={tasks}
        now={now}
        span={span}
        viewStart={viewStart}
        dragging={dragging}
        onDragStart={beginDrag}
        onDragPreview={previewDrag}
        onCommit={commitView}
        onDragEnd={endDrag}
      />
      {hover && (
        <div
          ref={popRef}
          className="gantt-pop"
          style={{
            transform: popPos ? `translate(${popPos.x}px, ${popPos.y}px)` : undefined,
            visibility: popPos ? 'visible' : 'hidden'
          }}
        >
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
