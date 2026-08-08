// 甘特图导航带：7 天全景 + 可拖取景框，选主区看哪一段。
//
// 这里是「丝滑」那五条硬要求真正落地的地方，先把道理说清楚，下面的实现都是照这个来的：
//
// 1. 取景框只用 transform 移动、只用 width 变宽——绝不碰 left/width 做位移。
//    336 个密度桶 + 主区一堆条，每帧走 layout 必卡。
// 2. 拖拽过程中，取景框自己的位置是在 mousemove 里直接改 DOM（ref.style.transform），
//    不经过 React state；只有松手那一刻才 setState 提交。
// 3. 主区跟随是节流的：每帧最多把候选位置往上报一次（rAF），由 GanttStage 直接改
//    它自己那部分 DOM 的 transform 做预览，同样不 setState。取景框本身不等这个节流，
//    每次 mousemove 都立刻动——这是「跟手无延迟」的关键。
// 4. 拖拽期间这一段全程关掉 CSS transition（.dragging 类），否则会变成橡皮筋。
//    松手 / 点击跳转时用同一条 transition 曲线把过渡还回来。
//
// 密度桶的计算只依赖全量 tasks + now，跟取景框拖到哪儿完全无关——所以拖拽本身
// 不会触发这坨重算，真正贵的东西压根不在这条链路上。
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import type { GanttTask } from '../../../../shared/types'
import { attachBlurGuard } from '../../blurGuard'

/** 导航带画完整 7 天——正好是主进程 gantt.ts 的保留期（KEEP_MS），
 *  超出这个范围的数据本来就已经被清掉了，画多了也没有意义。 */
export const PANORAMA_MS = 7 * 24 * 60 * 60 * 1000
/** 7 天 × 每天 48 个半小时桶 */
const BUCKET_COUNT = 336
const BUCKET_MS = PANORAMA_MS / BUCKET_COUNT
/** 哪怕一个桶里只有 1 个任务，也不能被当前时段里最忙的那个桶"稀释"到肉眼看不见——
 *  导航带首先要回答的是「这段时间有没有干过活」，全透明会被读成"没有"。 */
const MIN_BUCKET_OPACITY = 0.22
/** 取景框拖拽的最小生效位移（px）。低于这个值算「纯点击」——只是碰了一下、
 *  没有真的拖动，不该把 viewStart 从"贴住 now"冻结成具体值。触控板点击经常
 *  带 1-2px 的手抖漂移，阈值要能容忍这个，但 3px 已经足够跟"故意拖一下"分开。
 *  导出给 GanttStage 用——主区空白处拖拽（Task 7 新增）复用同一个阈值，两个
 *  入口"多大位移才算真拖拽"的判定标准必须一致，不能各写各的数字。 */
export const DRAG_MOVE_THRESHOLD_PX = 3

/** 取景框左边缘允许的范围：不能早于全景起点，也不能让右边缘超出全景终点。
 *  拖拽、点击跳转、切跨度三处收口都要过这一个函数，不然某一处忘了夹会漏出 7 天范围。 */
export function clampViewStart(
  v: number,
  panoramaStart: number,
  panoramaEnd: number,
  span: number
): number {
  const maxStart = Math.max(panoramaStart, panoramaEnd - span)
  return Math.min(Math.max(v, panoramaStart), maxStart)
}

export const mmdd = (t: number): string => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

interface GanttNavigatorProps {
  /** 全量任务（7 天保留期内的全部），不按当前取景窗口过滤——密度桶要看的是全景 */
  tasks: GanttTask[]
  now: number
  /** 当前主区跨度档位（24 小时 / 3 天的毫秒数），决定取景框宽度 */
  span: number
  /** 取景框左边缘；null = 贴住右端、跟随 now */
  viewStart: number | null
  /** 是否正在拖——由 GanttStage 统一管理，驱动 CSS 过渡开关和光标 */
  dragging: boolean
  /** 拖拽开始（mousedown 在取景框上）：GanttStage 借这个时机缓存主区当前的
   *  t0 和轨道宽度，作为预览位移换算的基准 */
  onDragStart: () => void
  /** 拖拽中，节流到每帧最多一次：把候选的取景框左边缘告诉主区，
   *  主区据此直接改 transform 做预览（不 setState） */
  onDragPreview: (candidateViewStart: number) => void
  /** 拖拽松手 / 点导航带空白处跳转，且确实发生了有效位移：这时才真正提交
   *  （setState viewStart），带过渡动画 */
  onCommit: (viewStart: number) => void
  /** mousedown 后没有发生有效位移就松手了（纯点击）：只需要把"正在拖拽"这个
   *  状态收尾（恢复轮询、恢复 transition），不改 viewStart——否则贴住 now 的
   *  视图会被一次无意义的点击静默冻结成固定区间。 */
  onDragEnd: () => void
}

/** 主区空白处拖拽（Task 7 新增，见 GanttStage.tsx 的 handleStageMouseDown）需要
 *  在拖拽过程中把取景框同步挪过去、松手未过阈值时把取景框收回——这两件事都要
 *  绕开 React state（否则违反"拖拽中不 setState"这条硬要求），所以用命令式 ref
 *  暴露给 GanttStage，不是再加一堆 props。取景框拖自己（handleFrameMouseDown）
 *  不用这层——那条路径本来就直接改自己的 DOM，不需要经过 ref 出去一圈再回来。 */
export interface GanttNavigatorHandle {
  /** 把取景框直接挪到 candidateViewStart 对应的位置（内部会 clamp），
   *  给主区拖拽预览用，每帧最多调一次（GanttStage 那边已经 rAF 节流过）。 */
  previewFrame: (candidateViewStart: number) => void
  /** 把取景框收回到当前 viewStart 对应的位置——主区拖拽松手但未过阈值
   *  （纯点击/手抖）时调用，对称于主区自己 endDrag() 里清理
   *  .gantt-axis/.gantt-lanes 残留 transform 那一步。 */
  resetFrame: () => void
}

export const GanttNavigator = forwardRef<GanttNavigatorHandle, GanttNavigatorProps>(
  function GanttNavigator(
    { tasks, now, span, viewStart, dragging, onDragStart, onDragPreview, onCommit, onDragEnd },
    ref
  ): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  /** 一次拖拽会话的收尾函数。组件万一在拖拽中被卸载（比如切走视图），
   *  用它兜底摘掉 window 监听器，不让 setState 打到已卸载的组件上。 */
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    setTrackWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') setTrackWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => cleanupRef.current?.(), [])

  const panoramaEnd = now
  const panoramaStart = now - PANORAMA_MS

  // 密度桶：扫一遍任务、把每条任务命中的桶区间累加，而不是每个桶各自过滤一遍
  // tasks——复杂度从 O(336×N) 降到 O(336+N)。这份数据量本来就不大，主要图个清楚。
  const buckets = useMemo(() => {
    const counts = new Array<number>(BUCKET_COUNT).fill(0)
    const aborted = new Array<boolean>(BUCKET_COUNT).fill(false)
    for (const t of tasks) {
      const s = Math.max(t.startAt, panoramaStart)
      const e = Math.min(t.endAt ?? now, panoramaEnd)
      if (e < panoramaStart || s > panoramaEnd) continue
      const bi0 = Math.max(0, Math.floor((s - panoramaStart) / BUCKET_MS))
      const bi1 = Math.min(BUCKET_COUNT - 1, Math.floor((e - panoramaStart) / BUCKET_MS))
      for (let i = bi0; i <= bi1; i++) {
        counts[i]++
        if (t.aborted) aborted[i] = true
      }
    }
    let max = 1
    for (const c of counts) if (c > max) max = c
    return { counts, aborted, max }
  }, [tasks, now, panoramaStart, panoramaEnd])

  // 日期刻度：全景范围内每个本地零点画一根
  const dateTicks = useMemo(() => {
    const out: number[] = []
    const d = new Date(panoramaStart)
    d.setHours(24, 0, 0, 0) // 下一个本地零点
    for (let t = d.getTime(); t <= panoramaEnd; t += 86400000) out.push(t)
    return out
  }, [panoramaStart, panoramaEnd])

  const effectiveViewStart = viewStart === null ? panoramaEnd - span : viewStart
  const clampedStart = clampViewStart(effectiveViewStart, panoramaStart, panoramaEnd, span)
  const frameLeftPx = trackWidth > 0 ? ((clampedStart - panoramaStart) / PANORAMA_MS) * trackWidth : 0
  const frameWidthPct = (span / PANORAMA_MS) * 100

  /** 主区拖拽路径专用：把取景框直接挪到 candidateViewStart 对应位置。故意跟
   *  handleFrameMouseDown 内部那个同名逻辑（局部 paintFrame，闭包着 mousedown
   *  那一刻快照的 widthPx/startViewStart）分开写、不揉成一个共用函数——后者是
   *  已经过三轮真机验证的取景框自身拖拽逻辑，不想为了 DRY 去动它、引入需要重新
   *  跑一遍那套验证矩阵的风险。这里用的是"当前渲染"的 trackWidth/panoramaStart
   *  （不是快照），二者在同一次拖拽手势内数值上等价（拖拽期间 20 秒轮询整个
   *  跳过、now 被冻结），但对"拖拽途中窗口被 resize"这种边缘情况更稳健。 */
  const paintFrameFromStage = (candidateViewStart: number): void => {
    if (!frameRef.current || trackWidth <= 0) return
    const clamped = clampViewStart(candidateViewStart, panoramaStart, panoramaEnd, span)
    frameRef.current.style.transform = `translateX(${((clamped - panoramaStart) / PANORAMA_MS) * trackWidth}px)`
  }

  useImperativeHandle(
    ref,
    () => ({
      previewFrame: paintFrameFromStage,
      resetFrame: () => paintFrameFromStage(clampedStart)
    }),
    [trackWidth, panoramaStart, panoramaEnd, span, clampedStart]
  )

  const handleFrameMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return // 只处理左键拖拽
    e.preventDefault() // 防止拖拽时选中文字
    if (trackWidth <= 0) return

    const startClientX = e.clientX
    const startViewStart = clampedStart
    const widthPx = trackWidth
    onDragStart()

    let latest = startViewStart
    let rafId: number | null = null
    // 记录这次拖拽会话里，是否曾经出现过超过阈值的位移——一旦发生过就不会再变回
    // false（哪怕后面鼠标又挪回原位），这样才能正确识别"拖出去又拖回来"也算真拖拽。
    let moved = false
    let detachBlur = (): void => {}

    const paintFrame = (v: number): void => {
      if (!frameRef.current) return
      const px = ((v - panoramaStart) / PANORAMA_MS) * widthPx
      frameRef.current.style.transform = `translateX(${px}px)`
    }

    const onMove = (ev: MouseEvent): void => {
      const deltaPx = ev.clientX - startClientX
      if (!moved && Math.abs(deltaPx) > DRAG_MOVE_THRESHOLD_PX) moved = true
      const deltaMs = (deltaPx / widthPx) * PANORAMA_MS
      latest = clampViewStart(startViewStart + deltaMs, panoramaStart, panoramaEnd, span)
      // 取景框本身：每次 mousemove 都直接改——「跟手无延迟」的关键，不等 rAF
      paintFrame(latest)
      // 主区跟随：节流到每帧最多一次
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          onDragPreview(latest)
        })
      }
    }

    const detach = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', finish)
      detachBlur()
      if (rafId !== null) cancelAnimationFrame(rafId)
      cleanupRef.current = null
    }
    const finish = (): void => {
      detach()
      // 零位移（或位移没过阈值）的纯点击：不提交 viewStart，只收尾拖拽状态——
      // 否则贴住 now 的视图会被一次无意义的点击静默冻结成固定区间（且这里如果
      // 走 onCommit(latest)，latest 在零位移时就是原封不动的 startViewStart，
      // 提交它本身就没有意义，只会把 null 意外坐实成一个具体值）。
      if (moved) {
        onCommit(latest)
        return
      }
      // 没过阈值也可能已经真的挪动过 DOM——onMove 里 paintFrame(latest) 不看
      // moved，每次 mousemove 都会画（哪怕只有 1-2px）。不提交意味着 viewStart
      // 不变，下一次渲染算出的 transform 字符串跟拖拽前逐字节相同：React 的
      // style diff 比较的是"上一次渲染值 vs 这一次渲染值"，不是"当前 DOM
      // 实际值"，判定"没变"就会跳过重新写 DOM，手动写进去的偏移不会被这个
      // 机制纠正回去（20 秒轮询也救不了——viewStart 为 null 时 frameLeftPx
      // 公式里的 now 项被减法抵消掉了，是个只取决于 span 的常量，poll 多少次
      // 值都不变）。这里只在手势结束时补一次性的收回，不在 onMove 里按 moved
      // 分支改写每帧的画法——那样会让阈值内的每次 mousemove 都重复写入同一个
      // 值，多了没意义的开销，一次性收尾更省。
      paintFrame(startViewStart)
      onDragEnd()
    }

    cleanupRef.current = detach
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finish)
    // 拖拽中真失焦：当场收尾，别留悬空的拖拽状态；hide/show 抖动引起的假 blur
    // 由 attachBlurGuard 过滤掉（见该文件注释），不会误伤正在进行的拖拽
    detachBlur = attachBlurGuard(finish)
  }

  // 点导航带空白处：直接跳过去，交给 CSS 过渡做平滑滑动（不是瞬移）。
  // e.target === e.currentTarget 用来排除点在取景框上的情况——密度桶是纯装饰
  // （pointer-events:none）会穿透到轨道本身，取景框自己接鼠标事件、不会让这个判断误通过。
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    if (trackWidth <= 0) return
    const rect = trackRef.current!.getBoundingClientRect()
    const clickMs = panoramaStart + ((e.clientX - rect.left) / trackWidth) * PANORAMA_MS
    onCommit(clampViewStart(clickMs - span / 2, panoramaStart, panoramaEnd, span))
  }

  return (
    <div className="gantt-nav">
      <div className="gantt-nav-track" ref={trackRef} onClick={handleTrackClick}>
        {buckets.counts.map((c, i) => {
          const isAborted = buckets.aborted[i]
          if (c === 0 && !isAborted) return null // 0 个 = 透明，索性不画
          const left = (i / BUCKET_COUNT) * 100
          const width = (1 / BUCKET_COUNT) * 100
          return (
            <div
              key={i}
              className={`gantt-nav-bucket${isAborted ? ' aborted' : ''}`}
              style={{
                left: left + '%',
                width: width + '%',
                opacity: isAborted
                  ? 1
                  : MIN_BUCKET_OPACITY + (1 - MIN_BUCKET_OPACITY) * (c / buckets.max)
              }}
            />
          )
        })}
        <div
          ref={frameRef}
          className={`gantt-nav-frame${dragging ? ' dragging' : ''}`}
          style={{ width: frameWidthPct + '%', transform: `translateX(${frameLeftPx}px)` }}
          onMouseDown={handleFrameMouseDown}
        />
      </div>
      <div className="gantt-nav-ticks">
        {dateTicks.map((t) => (
          <div
            key={t}
            className="gantt-nav-tick"
            style={{ left: ((t - panoramaStart) / PANORAMA_MS) * 100 + '%' }}
          >
            <span>{mmdd(t)}</span>
          </div>
        ))}
      </div>
    </div>
  )
  }
)

GanttNavigator.displayName = 'GanttNavigator'
