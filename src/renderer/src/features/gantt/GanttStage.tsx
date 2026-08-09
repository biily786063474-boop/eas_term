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
import type { GanttClearRange, GanttTask } from '../../../../shared/types'
import { attachBlurGuard } from '../../blurGuard'
import { TrashIcon } from '../../ui/Icons'
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
/** 浮层加了内部滚动之后，鼠标要能从条移到浮层上（拖滚动条/滚滚轮），中间隔着
 *  POP_GAP 那段无接触区——onMouseLeave 不能立刻清空 hover，否则鼠标还没走到
 *  浮层就已经判定"离开"，浮层先一步消失，永远够不着。给"离开"一段宽限期，
 *  期内如果重新进入（条或浮层本身）就撤销这次隐藏；宽限期内没人接住才真的清空。 */
const POP_HIDE_DELAY = 150

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

/** 容错隔离（2026-08-08 新需求）第二道防线：主进程 gantt.ts 的 valid() 只校验
 *  字段类型（是不是字符串/数字），不校验数值是否有意义——startAt 是 NaN、
 *  ±Infinity、或者 endAt 早于 startAt 这类"类型对但数值离谱"的记录能穿透那层
 *  校验直达这里。分行(layer)、时间换算(pct)、导航带的密度桶全是这些数字的
 *  纯算术，NaN/Infinity 混进去不会真的抛异常炸整个视图（JS 算术对这些值是
 *  "安静地"产出更多 NaN/Infinity，React 也不会因为一个无效的 CSS 值
 *  如"NaN%"而崩溃），但会画出脱离视觉意义的东西（一根不知道飘去哪儿的条、
 *  导航带被一条脏数据点亮整条 7 天）。逐条挡在这里，比事后再去分析"为什么
 *  这根条长得这么怪"划算。
 *
 *  挡掉的记录不删除——删不删是用户自己的决定（"清空全部/清空这段"），渲染层
 *  没资格替他做主，这里只是这一次不把它画出来。真正在数据里作恶的记录，
 *  用户仍然可以通过"清空全部"把它连同其他记录一起清掉（这条兜底路径不依赖
 *  这里的过滤——见 clearAll，它操作的是未过滤的原始 tasks）。 */
function isSaneTask(t: GanttTask): boolean {
  if (!Number.isFinite(t.startAt)) return false
  if (t.endAt !== null && !Number.isFinite(t.endAt)) return false
  if (t.endAt !== null && t.endAt < t.startAt) return false
  return true
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
  const requestConfirm = useStore((s) => s.requestConfirm)
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
  // 隐藏浮层走"宽限期定时器"而不是立刻清空——配合浮层新增的 onMouseEnter/
  // onMouseLeave（见下方 JSX），让鼠标能穿过 POP_GAP 那段间隙真正移到浮层上。
  // timer 只操心"要不要真的清空 hover"，跟下面算 popPos 的 useLayoutEffect
  // 完全不碰面：显示仍然是 hover 一变就同步重算位置，没有引入任何延迟，
  // 延迟只加在"清空"这一侧，Part 1 验证过的"无先飞出去再跳回来"结论不受影响。
  const hideTimerRef = useRef<number | null>(null)
  const cancelHide = (): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }
  const scheduleHide = (): void => {
    cancelHide()
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setHover(null)
    }, POP_HIDE_DELAY)
  }
  useEffect(() => {
    // 组件卸载（切走视图）时别让宽限期 timer 之后再摸一个已经不在的 hover
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

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

  // 挪到这里（原来紧贴 return 之前）：下面 clearRange 的确认文案要用它，
  // 声明顺序早于第一个使用点，不依赖"函数体延迟执行"这个虽然安全但绕一圈的事实。
  const rangeLabel =
    viewStart === null
      ? `最近 ${span === DAY_MS ? '24 小时' : '3 天'}`
      : `${mmdd(t0)} ${hhmm(t0)} – ${mmdd(t1)} ${hhmm(t1)}`

  // 渲染安全的子集——geometry（分行/分层/时间映射）和导航带的密度桶都从这里取数，
  // 不直接碰 tasks。见 isSaneTask 顶部注释。
  const safeTasks = useMemo(() => tasks.filter(isSaneTask), [tasks])

  const byProject = useMemo(() => {
    const m = new Map<string, GanttTask[]>()
    for (const t of safeTasks) {
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
  }, [safeTasks, t0, t1, now])

  // 「清空这段」按的是原始 tasks（不是 safeTasks）——数值离谱到被 isSaneTask
  // 挡掉的记录，理应也能被这个按钮连带清掉，不然它们就成了唯一只能靠「清空
  // 全部」才够得着的孤儿数据。判据跟 byProject 上面两个 continue 条件互为镜像
  // （那边是"跳过不在窗口内的"，这里是"选中在窗口内的"），须保持口径一致——
  // 否则会出现"确认框写清空 3 条，实际清掉的条数对不上"这种体验裂缝。
  const inViewCount = useMemo(
    () => tasks.filter((t) => (t.endAt ?? now) >= t0 && t.startAt <= t1).length,
    [tasks, t0, t1, now]
  )

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

  // 用户自行删除错误数据（2026-08-08 新需求）——三个入口共用的收尾：main 进程
  // 删完直接回传最新列表（已经带好 aborted 标记，见 gantt.ts 的 withAbortedFlag），
  // 拿到就地 setTasks，不必等 20 秒轮询——"删除要立刻反映在图上"。顺带清掉 hover：
  // 被删的那条如果正好是当前 hover 的条，浮层还留着旧数据、指向的条却已经从
  // DOM 里消失了，会变成一个悬空的"幽灵浮层"。
  const removeTask = (t: GanttTask): void => {
    requestConfirm({
      message: `删除这条记录？\n\n${hhmm(t.startAt)} · ${t.prompt.slice(0, 40)}${t.prompt.length > 40 ? '…' : ''}\n\n删除后无法恢复，不影响这个终端本身。`,
      confirmLabel: '删除',
      onConfirm: () => {
        void window.api.gantt.remove(t.id).then((list) => {
          setTasks(list)
          setHover(null)
        })
      }
    })
  }

  const clearRange = (): void => {
    if (!inViewCount) return
    const range: GanttClearRange = { from: t0, to: t1 }
    requestConfirm({
      message: `清空「${rangeLabel}」内的 ${inViewCount} 条记录？\n\n删除后无法恢复，不影响终端本身。`,
      confirmLabel: '清空这段',
      onConfirm: () => {
        void window.api.gantt.clear(range).then((list) => {
          setTasks(list)
          setHover(null)
        })
      }
    })
  }

  const clearAll = (): void => {
    if (!tasks.length) return
    requestConfirm({
      message: `清空全部 ${tasks.length} 条甘特图记录？\n\n删除后无法恢复，不影响终端本身、不影响项目文件。`,
      confirmLabel: '清空全部',
      onConfirm: () => {
        void window.api.gantt.clear().then((list) => {
          setTasks(list)
          setHover(null)
        })
      }
    })
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
    // h 这里已经是封顶后的高度——JSX 里 style.maxHeight 按 window.innerHeight -
    // 2*POP_MARGIN 算，且在测量前那一帧就生效（不是量完再加），所以 h 永远
    // <= innerHeight - 2*POP_MARGIN。这一点是下面"两边都放不下"兜底分支不会
    // 溢出视口的数学保证：翻到上方时 y = max(POP_MARGIN, top-GAP-h)，最坏情况
    // y = POP_MARGIN，则 y+h <= POP_MARGIN + (innerHeight-2*POP_MARGIN) =
    // innerHeight-POP_MARGIN，底边恰好卡在边距内，不会二次溢出。
    const h = el.offsetHeight
    // 优先展开到条下方；下方放不下就翻到条上方，让浮层始终贴着条，而不是飘去
    // 屏幕上一个"不出界但离条很远"的地方。两边都放不下（内容本身比整个视口
    // 还高）时兜底夹回视口内——上面的 max-height 已经保证这种情况下 h 有限，
    // 剩下超出可视高度的部分交给 .gantt-pop 的 overflow-y:auto 内部滚动读完，
    // 不会出现"夹回去了但内容还是拖出视口"的二次溢出。
    const fitsBelow = hover.bottom + POP_GAP + h <= window.innerHeight - POP_MARGIN
    const y = fitsBelow ? hover.bottom + POP_GAP : Math.max(POP_MARGIN, hover.top - POP_GAP - h)
    const x = Math.max(POP_MARGIN, Math.min(hover.x, window.innerWidth - w - POP_MARGIN))
    setPopPos({ x, y })
  }, [hover])

  const beginDrag = (): void => {
    // 拖拽平移开始前把浮层立刻清空，不走宽限期——浮层的 top/bottom 是进入那一刻
    // 条的位置快照，拖拽期间条会被 transform 整体挪走，浮层如果还在宽限期里挂着，
    // 会变成一个悬在半空、跟内容脱节的"幽灵浮层"。
    cancelHide()
    setHover(null)
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

  return (
    <div className="gantt">
      <div className="gantt-head">
        <div className="gantt-title">{rangeLabel} · 每根条是一次「你发出去的话 → agent 干完」</div>
        <div className="gantt-head-tools">
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
          {/* 用户自行删除错误数据（2026-08-08 新需求）：批量清理的两个入口。
              「清空这段」复用当前已经在看的时间窗——不用另外造一个选日期的
              UI，用户拖导航带选到想清的那段，点一下就是清那段。 */}
          <button
            className="gantt-clean-btn"
            data-tip={inViewCount ? `清空当前范围内的 ${inViewCount} 条记录` : '当前范围内没有记录'}
            disabled={!inViewCount}
            onClick={clearRange}
          >
            <TrashIcon size={11} />
            清空这段
          </button>
          <button
            className="gantt-clean-btn danger"
            data-tip={tasks.length ? `清空全部 ${tasks.length} 条记录` : '还没有记录'}
            disabled={!tasks.length}
            onClick={clearAll}
          >
            清空全部
          </button>
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
                              cancelHide()
                              const r = ev.currentTarget.getBoundingClientRect()
                              setHover({ t, x: ev.clientX, top: r.top, bottom: r.bottom })
                            }}
                            onMouseLeave={scheduleHide}
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
        tasks={safeTasks}
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
            visibility: popPos ? 'visible' : 'hidden',
            // 内容比整个视口还高的极端情况兜底：这个上限要在测量宽高的这一帧就生效
            // （不能等 popPos 算完才加），否则下面 useLayoutEffect 量出来的
            // offsetHeight 还是没封顶的"虚高"，翻转判断会拿着假数据算错方向——
            // 具体的边界数学见下面 useLayoutEffect 里 `const h = ...` 那段注释。
            // 按 window.innerHeight 现算，静态 CSS 写不出这个值，所以放在内联样式
            // 而不是 gantt.css。
            maxHeight: Math.max(0, window.innerHeight - POP_MARGIN * 2) + 'px'
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="gantt-pop-hd">
            <div className="gantt-pop-time">
              {hhmm(hover.t.startAt)} → {hover.t.endAt ? hhmm(hover.t.endAt) : '进行中'}
              {hover.t.endAt && (
                <span className="gantt-pop-dur">{dur(hover.t.endAt - hover.t.startAt)}</span>
              )}
            </div>
            {/* 用户自行删除错误数据（2026-08-08 新需求）：单条删除入口。
                stopPropagation 不是必须的（.gantt-pop 自己没有 onClick），
                留着是防这块以后长出新的点击行为时被这颗按钮误连带触发。 */}
            <button
              className="gantt-pop-del"
              data-tip="删除这条记录"
              onClick={(e) => {
                e.stopPropagation()
                removeTask(hover.t)
              }}
            >
              <TrashIcon size={11} />
            </button>
          </div>
          {hover.t.aborted && <div className="gantt-pop-abort">上次没有正常结束，结束时间未知</div>}
          <div className="gantt-pop-text">{hover.t.prompt}</div>
          {/* follow 是可选字段，主进程 valid() 不校验它的形状——磁盘上被写坏成
              非数组（比如一个字符串）时，原来的 `?.map` 会在这条记录被 hover 到
              的那一刻抛 TypeError（字符串没有 .map），把整个甘特图炸崩。
              Array.isArray 挡形状，String(f) 挡数组里混进非字符串项（比如
              一个对象——直接当 React 子节点渲染会抛"Objects are not valid as
              a React child"）。 */}
          {Array.isArray(hover.t.follow) &&
            hover.t.follow.map((f, i) => (
              <div className="gantt-pop-follow" key={i}>
                追加：{typeof f === 'string' ? f : String(f)}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
