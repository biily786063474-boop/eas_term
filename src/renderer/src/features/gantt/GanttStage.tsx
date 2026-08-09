// 甘特图：横轴时间，纵轴按项目分组、组内按终端分行（Task 18 改造，见下方
// 「按终端分行」大注释）。同一个终端在同一时刻本不该有两条任务重叠（采集器
// 保证），万一历史数据有坏数据导致重叠，仍然在那一行内上下堆叠而不是拿半透明
// 盖住——叠住的标题读不出来，非 hover 不可，而这张图的价值就在于扫一眼知道
// 当时在干什么。
//
// 按终端分行（Task 18 改造）：原来"一行一个项目、同项目任务混在一行里堆叠"上线
// 一段时间后用户改主意——多个终端的任务堆在同一行，扫一眼分不清哪条是哪个终端
// 干的，要的是当初设计三选项里的另一个：一个终端一行。改造的核心决策记在这里，
// 分散在各处的注释只补充各自局部的"为什么"：
//
// 1. 分组键必须是 (runId, ptyId) 复合键，不能只用 ptyId——主进程 pty.ts 的
//    ptyId 是每次启动都从 1 重新自增的小整数，两次运行之间必然会撞号；runId
//    是主进程随机生成、每次启动必换的，两者一起才能唯一标识"跨越一次运行始终
//    的那一个终端"。旧数据没有 runId 字段——跟 shared/types.ts GanttTask.runId
//    注释里同一个道理："旧数据没有这个字段→必然来自更早的运行→天然判定不
//    一致"，这里分到独立的 'legacy' 桶，不强行兼容（那类数据会在 7 天保留期
//    内自然老化掉）。见 terminalKey()。
// 2. 终端叫什么名字：GanttTask 本身没存标题，现从 tabs 里查——复用 BoardStage.tsx
//    "一个终端一行"卡片已经在用的同一个信源（tab.title，shell OSC 写的、agent
//    干活时会同步写入当前任务，比让用户另外取名更新鲜）。但直接照搬 BoardStage
//    的 `t.title || 终端 N` 在这里不够用：新开终端的默认标题就是项目名（见
//    tabsSlice.ts openTerminal），同一项目下好几个终端如果都还没被 OSC 或用户
//    改过名，每一行都写一遍项目名——分组头已经写了项目名，子行再写一遍等于
//    没有区分度。所以这里在"标题存在"之外多加一条："标题得是用户手动改的，
//    或者内容跟项目名不一样"才采信，否则退回序号。见 terminalLabel()。
// 3. 已关闭的终端：那段历史真实发生过，仍然占一行——titleByLeaf 在 tabs 里查
//    不到时直接落到序号兜底，不是把它从图上抹掉。
// 4. 行数会随终端数翻倍，两条对策：①子行只在"当前时间窗口内有活动"时才出现
//    （复用 byProject 本来就有的视窗过滤，从"项目级"下沉到"终端级"，逻辑
//    对称）；②项目只要终端数 >1 就给一个可折叠的分组头，折叠态把该项目全部
//    终端的任务合并画回一行（数学上等于改造前的样子），展开/折叠都不额外占
//    行高预算，纯粹是"要不要看到按终端拆开的细节"。终端数=1 的项目完全不
//    显示分组头/折叠按钮——没有第二个终端可比较，加一层"分组"只会多一行
//    空对比的标题。
// 5. 编号("终端 N")的 N 来自 groupsByProject——用**全量**任务(不看当前时间
//    窗口)按"这个终端最早一条任务的时间"稳定排出来，不会因为拖动/缩放时间轴、
//    临时看不见某个终端而重新洗牌编号。
//
// 导航带（GanttNavigator.tsx）故意不跟着改：它是横跨 7 天保留期的全局密度概览，
// 计算只依赖 tasks+now，从没按项目/终端分过组，这次改造没有理由让它知道"终端"
// 这个概念——细节见该文件的密度桶注释。
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
//
// 连续缩放（Task 17 新增）：⌃+滚轮 / 触控板双指捏合，span 从两档预设变成
// [MIN_SPAN, MAX_SPAN] 区间内连续可调，以光标为锚（缩放前后光标下的时间点屏幕
// 位置不变）。手感上是"拖拽"和"缩放"两件事共享同一套硬要求——transform 不碰
// left/width、连续手势中不 setState、松手/静默后再提交一次——但缩放没有
// mousedown/mouseup 这种明确的"手势边界"，wheel 事件是连续打进来的一串，只能靠
// "静默一段时间"倒推"松手了"（ZOOM_COMMIT_IDLE_MS）。两套状态机分开写
// （dragging vs zooming，dragBaseRef vs zoomSessionRef），原因和 GanttNavigator
// 里"取景框拖自己 vs 主区拖拽同步过来"故意不共用一套的理由一样：手势的触发/收尾
// 信号本质不同，硬揉成一套反而让"这次该不该清某个 ref"变得含糊。
//
// 缩放不该打断"跟随实时"（复审修复）：commitZoom 提交时不能无条件把 viewStart
// 写成具体数字——那等于缩放一下就把"贴住 now"的直播视图静默冻结成死值，没有
// 任何提示，用户毫无察觉地不再看到新任务。changeSpan（点预设按钮）从 Task 6
// 起就用 `if (prev===null) return prev` 保留了这条，缩放这条路径当初漏掉了。
// 修法见 commitZoom 内部注释，结论：手势开始时若贴着 now（wasLive），且
// ①结果的右边缘精确贴着 now（缩小方向靠 clampViewStart 天然成立）或
// ②光标指向的时间点本身离 now 足够近（放大方向没有 clamp 帮忙，只能看光标
// 本身指向的点够不够"新"，不能看结果的时间差——那个差值是跨度的函数,大跨度
// 下几像素的锚点误差换算出来能有几十分钟），才保持 null；手动定位过的历史
// 视图（viewStart 已经是具体值）缩放不会被巧合拉回直播。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useStore } from '../../store'
import type { GanttClearRange, GanttTask } from '../../../../shared/types'
import { attachBlurGuard } from '../../blurGuard'
// collectLeaves：只读，取"leafId → 所在标签页标题"这份映射用（见 titleByLeaf）。
// 不改这个文件——按纪律只碰 features/gantt/ 下的文件，这里纯粹是读别处已有的
// 布局树遍历工具，跟 BoardStage.tsx 取终端名用的是同一个函数、同一种读法。
import { collectLeaves } from '../../layout'
import { ChevronDownIcon, ChevronRightIcon, TrashIcon } from '../../ui/Icons'
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
/** 主区跨度预设：24 小时 / 3 天两个快捷跳转按钮。连续缩放（⌃+滚轮/双指捏合）
 *  上线后这两个按钮不再是"唯二两档"，是这段连续区间里的两个常用书签——点一下
 *  直接跳过去，不用滚半天。导航带那 7 天全景不在这个列表里——全景固定不可切，
 *  只有主区看多宽是可切的。 */
const SPAN_OPTIONS = [
  { key: '24h', label: '24 小时', ms: DAY_MS },
  { key: '3d', label: '3 天', ms: 3 * DAY_MS }
] as const

/** 连续缩放的两端硬边界：最细一小时一屏，最粗跟"3 天"预设看齐——用户要求就是
 *  "最大 3 天，最小一小时"，没有再往外扩到导航带 7 天全景的必要（那本来就是
 *  全景专用，不是给主区当第三档）。 */
const MIN_SPAN = 60 * 60 * 1000
const MAX_SPAN = 3 * DAY_MS

/** wheel 事件不像 mousedown/mouseup 那样有天然的"手势结束"信号——触控板捏合会
 *  连续打进来一长串事件，只能靠"静默了一段时间"倒推"这次缩放松手了"。每个 tick
 *  都会重置这个计时器（debounce 而不是节流），静默超过这个时长才真正提交一次
 *  state。150ms 这个量级跟本文件后面 hover 浮层的 POP_HIDE_DELAY 一样，都是
 *  "扛得住手势里的自然停顿、又不会让提交肉眼可感知地滞后"的经验值——两处场景
 *  不同，没有共用同一个常量的必要，但取值思路是一回事。 */
const ZOOM_COMMIT_IDLE_MS = 150

/** 缩放提交时判断"结果是否仍贴着 now"要用两条互补的判据（见 commitZoom），
 *  这个是第一条——clampViewStart 保证 nextT1（=nextT0+nextSpan）永远
 *  <= panoramaEnd(=now)，"贴着"就是这个不等式几乎取等。这条判据只在"缩小"
 *  方向真正管用：往外缩且锚点没顶在最右侧时，多出来的部分想往"未来"那边长，
 *  被 clamp 精确砍在 panoramaEnd（(panoramaEnd-span)+span，同一个值先减后加，
 *  理论零误差），跟锚点具体在哪儿无关——这里留一点余量纯粹防御 IEEE 双精度在
 *  极端输入下的舍入，1 秒相对 MIN_SPAN(1 小时) 是 1/3600，不会把"明显没贴住
 *  now"的情况误判成贴住。 */
const LIVE_EDGE_EPSILON_MS = 1000

/** 第二条判据——"放大"方向没有 clamp 帮忙，nextT1 离 now 多远纯粹取决于光标
 *  离右边缘差几像素，换算成毫秒后跟当前跨度成正比：跨度越大，同样几像素的
 *  偏差换算出的时间差越大。改用"光标指向的时间点（tCursor）离 now 多近"
 *  （手势最后一次 tick 里算出来的，存在 session.current 里）来判断——只问
 *  这一个点本身够不够"新"，不看结果的时间差。多近算近，用 nextSpan 的固定
 *  比例（NEAR_LIVE_FRACTION）而不是一个写死的绝对时长：
 *
 *  第一版写死 30 分钟，真机测下来不够用——光标已经贴在"正在跑"那条任务上
 *  （肉眼看就是贴着最右边）都只有 f≈0.997，(1-f)*24h≈4 分钟，看起来该稳稳
 *  过关；但换一个跨度更大的场景（比如已经缩小到 3 天档）同样的"贴着某条最近
 *  任务"的像素级精度，换算出的时间差可以到几个小时，绝对量的窗口没法两头
 *  兼顾。改成跨度的固定比例（10%——时间轴最右十分之一算"贴近 now"）之后就
 *  是跟跨度脱钩的相对判据：不管当前放大到多细，"光标落在最近这一段"这件事
 *  在视觉上永远对应同一块屏幕区域，用户"随手" (casual) 落在那儿的概率是稳定
 *  的，不会因为跨度不同而忽紧忽松。NEAR_LIVE_MIN_MS 给一个绝对下限——
 *  MIN_SPAN(1 小时) 的 10% 只有 6 分钟，对最细的档位来说太苛刻，下限保底到
 *  半小时（这个值本身没有更精确的依据，两害相权：错判成"该冻结却保持了
 *  live"的代价（多跟随一会儿，用户自己再拖走就是）比反过来（该 live 却
 *  冻结、且没有任何提示，是这次复审揪出来的那个 Critical）小得多，宁可放
 *  宽）。
 *
 *  这条判据换来一个代价，记在这里省得以后被当成新 bug 重新排查一遍：nearLiveEdge
 *  命中但 f 没有精确等于 1 时，提交后画面会有一次小幅"回正"——因为 viewStart
 *  归 null 之后，下一帧渲染用的是 `now - nextSpan`（null 分支的公式），不是
 *  手势里锚点算出来的 nextT0，两者相差 (1-f)*nextSpan。真机量过：锚点落在
 *  "12 分钟前"这条任务上（f≈0.9917）、放大到 15.25 小时，这个回正量实测
 *  7.3px（对着约 950px 宽的时间轴，不到 1%）。跟"停在锚点算出来的 nextT0、
 *  但不再跟随 now"（这次复审要修的那个问题）比，回正这几像素肉眼很难察觉，
 *  换来的是缩放完之后画面仍然真的在往前走——这笔账划算，没有再进一步花精力
 *  消除它（要消除得让 null 分支的公式也认锚点，等于又长出一套新逻辑，
 *  对几像素的视觉差价不值当）。 */
const NEAR_LIVE_FRACTION = 0.1
const NEAR_LIVE_MIN_MS = MIN_SPAN / 2

/** 刻度密度分级候选——单位统一是"整分钟/整小时"，不会出现 10:37 这种断头值。
 *  挑法（见下面 pickTickStepMs）：从最细的候选开始试，选第一个能让"跨度/步长"
 *  落在 10 以内的。为什么这样就能同时保住下限（不会挑出个数量只有 2、3 根的
 *  步长）：相邻候选的比值最大是 2×（10min→15min 是 1.5×，其余都是 2×），而
 *  目标区间 [4,10] 的比值上限是 10÷4=2.5×——比任何相邻候选的跳档幅度都宽，
 *  两档候选各自"合适"的跨度区间必然有重叠，不会漏出"两边都不合适"的空当。
 *  这个证明只在实际会用到的 [MIN_SPAN, MAX_SPAN] 区间内成立；表头 1min/5min
 *  两档细到当前 1 小时下限用不上，留着是给以后万一调低 MIN_SPAN 兜底，不是
 *  当前就会命中的分支。 */
const TICK_STEP_LADDER = [
  60 * 1000, // 1 分钟
  5 * 60 * 1000, // 5 分钟
  10 * 60 * 1000, // 10 分钟
  15 * 60 * 1000, // 15 分钟
  30 * 60 * 1000, // 30 分钟
  60 * 60 * 1000, // 1 小时
  2 * 60 * 60 * 1000, // 2 小时
  3 * 60 * 60 * 1000, // 3 小时
  6 * 60 * 60 * 1000, // 6 小时
  12 * 60 * 60 * 1000, // 12 小时
  24 * 60 * 60 * 1000 // 24 小时——MAX_SPAN=3 天时永远轮不到（12 小时档已经够用），
  // 纯粹是兜底，见上面大注释
]

function pickTickStepMs(span: number): number {
  for (const step of TICK_STEP_LADDER) {
    if (span / step <= 10) return step
  }
  return TICK_STEP_LADDER[TICK_STEP_LADDER.length - 1]
}

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

/** 贴住 now（viewStart===null）时 rangeLabel 要把 span 转成人话——Task 17
 *  连续缩放上线后 span 可以是任意值，不再只有 24h/3d 两个预设，不能再用
 *  「非此即彼」的三元硬猜（复审揪出的 bug：贴住 now 缩放到比如 18.5 小时，
 *  旧代码会把 span!==DAY_MS 一律读成"3 天"，标题说瞎话）。
 *  24h/3d 两个精确值保留原来的措辞——跟预设按钮的文案对得上，按钮高亮和
 *  标题文案用同一套词，不会出现"24 小时"按钮亮着、标题却说"1 天"这种读着
 *  别扭的不一致。其余值用"X 小时 Y 分钟"兜底，分钟取整——跟 hhmm() 的精度
 *  一致，不谎报比这更细的假精度。 */
const formatSpan = (ms: number): string => {
  if (ms === DAY_MS) return '24 小时'
  if (ms === 3 * DAY_MS) return '3 天'
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
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

/** 一个终端跨越它整个生命周期的分组键——见文件顶部大注释第 1 条。分号(':')
 *  不会出现在 ptyId（主进程 nextId 生成的纯数字字符串）里，用它做分隔符不会
 *  跟真实值混淆。 */
function terminalKey(t: GanttTask): string {
  return (t.runId ?? 'legacy') + ':' + t.ptyId
}

/** 一个终端名下的全部任务（不看当前时间窗口）。leafId 在组内任意一条任务上
 *  取都一样——同一个 ptyId 从创建到销毁只会绑定同一个 leaf（见 tabsSlice.ts
 *  openTerminal/splitLeaf/setPaneKind：ptyId 和 leafId 总是一起诞生），
 *  collector.ts 传给 noteRunning 的 ctx.leafId 对同一个 ptyId 不会变。 */
interface TermGroup {
  key: string
  leafId: string
  tasks: GanttTask[]
  /** 组内最早一条任务的 startAt——给同项目下的终端排序编号用，见文件顶部
   *  大注释第 5 条：算的是全量，不随当前时间窗口变化而重新洗牌。 */
  firstStart: number
}

/** 视窗过滤后的终端组：view 是落在当前 [t0,t1] 内、真正要画的那部分任务；
 *  ordinal 是"终端 N"里的 N，来自 groupsByProject 的全量顺序，不是 view 内的
 *  顺序（否则同一个终端会因为拖动时间轴、暂时没有任务落入视窗而被重新编号）。 */
interface VisibleGroup extends TermGroup {
  view: GanttTask[]
  ordinal: number
}

export function GanttStage(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const setViewMode = useStore((s) => s.setViewMode)
  const setBoardFullscreen = useStore((s) => s.setBoardFullscreen)
  const requestConfirm = useStore((s) => s.requestConfirm)
  // 取终端名用（titleByLeaf）。跟 BoardStage.tsx 订阅同一个字段——那边已经证明
  // 了这个订阅的刷新频率可接受（tabsSlice.setTabTitle 标题没变就原样返回，不
  // 造新数组，OSC 高频刷屏不会导致这里跟着高频重渲染）。
  const tabs = useStore((s) => s.tabs)
  const [tasks, setTasks] = useState<GanttTask[]>([])
  const [now, setNow] = useState(() => Date.now())
  /** 哪些项目的"按终端分行"分组被用户折叠了（见文件顶部大注释第 4 条）。
   *  纯本地 UI 状态，不落盘——跟 hover/dragging 这些其他瞬时状态同等待遇，
   *  切走视图再切回来会回到"全部展开"（默认态就是这次改造要交付的东西，
   *  折叠是用户自己按需收起，不该悄悄变成下次打开时的默认）。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (projectId: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }
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
  /** 是否正在走"⌃+滚轮/双指缩放"这条手势。语义上跟 dragging 是同一类信号
   *  （"正被 transform 预览接管，此刻的 span/viewStart 还没提交，画面显示的是
   *  临时态"），但特意用独立的 state，不复用 dragging——拖拽由 mouseup 这个明确
   *  事件收尾，缩放靠"静默一段时间"倒推"松手了"，两条状态机的驱动方式不同。
   *  唯一需要"两者其一为真"的地方（GanttNavigator 要不要关掉取景框的 CSS
   *  过渡）在调用处用 `dragging || zooming` 合流，不需要让 GanttNavigator
   *  认识第二个概念。 */
  const [zooming, setZooming] = useState(false)

  // 主区里"跟着时间轴走"的那部分（顶部刻度 + 每行的 lanes）的容器。拖拽/缩放预览
  // 期间直接对着里面匹配到的节点改 transform，不碰 React state——见 previewDrag
  // 和下面的缩放 wheel 监听器。
  const plotRef = useRef<HTMLDivElement>(null)
  /** .gantt-scroll 本身的 ref——⌃+滚轮/双指缩放要用原生 wheel 监听器
   *  + passive:false 才能拦住浏览器默认的页面缩放（React 合成事件那层 wheel
   *  默认走 passive，onWheel prop 里调 preventDefault 不生效，CanvasStage.tsx
   *  的画布缩放已经踩过这个坑，做法照抄）。挂在 .gantt-scroll 而不是更内层的
   *  plotRef（.gantt-grid），是因为空白处拖拽平移（handleStageMouseDown）也是
   *  挂在 .gantt-scroll 上——两种手势的命中区域保持一致，行尾之后的空白同样能
   *  滚轮缩放，不是只有条和刻度能响应。 */
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragBaseRef = useRef<{ t0: number; widthPx: number; els: HTMLElement[] } | null>(null)
  /** 一次"⌃+滚轮/双指缩放"手势的运行态。base 是手势开始那一刻的快照——固定不变，
   *  锚点数学要靠它换算"相对手势起点的屏幕位移"（跟 previewDrag 用 dragBaseRef.t0
   *  而不是"上一帧"做基准是同一个道理）。current 是每个 wheel tick 累积出来的
   *  "如果现在提交，会提交成什么"——分开存两份，是因为算这一 tick 该定到哪个新
   *  时间点，用的是"最新累积结果"（current），但换算成屏幕上的 transform，用的是
   *  "相对固定起点的偏移"（base）；揉成一份会让连续多次缩放（一次 pinch 里几十个
   *  tick）的锚点计算错位。 */
  const zoomSessionRef = useRef<{
    base: {
      t0: number
      span: number
      leftPx: number
      widthPx: number
      els: HTMLElement[]
      panoramaStart: number
      panoramaEnd: number
      /** 手势开始那一刻 viewStart 是不是 null（贴住 now、跟随实时）——commitZoom
       *  要不要把结果写回 null 得看这个，不能凭"这一刻算出来的 t1 恰好等于 now"
       *  就反推"应该 live"：拖过取景框之后（viewStart 已经是具体值）如果缩放
       *  凑巧也落在 t1===now，不该被这个巧合拉回 live——用户手动定位的视图，
       *  缩放不该替他做主"恢复跟随"。见 commitZoom 里 stillLive 的注释。 */
      wasLive: boolean
    }
    /** tCursor：最新这一 tick 里光标指向的时间点（= cur.t0 + f*cur.span，onWheel
     *  里已经算过一次，这里存一份供 commitZoom 判断 nearLiveEdge 用，
     *  见 NEAR_LIVE_FRACTION 顶上的注释）。 */
    current: { t0: number; span: number; tCursor: number }
  } | null>(null)
  /** 缩放手势"松手"的静默计时器——见 ZOOM_COMMIT_IDLE_MS 的注释。 */
  const zoomTimerRef = useRef<number | null>(null)
  // 导航带的命令式句柄（Task 7 新增）：主区拖拽/缩放时用它同步挪取景框、复位
  // 取景框，全程绕开 React state——细节见 GanttNavigator.tsx 里
  // GanttNavigatorHandle 的注释。
  const navRef = useRef<GanttNavigatorHandle>(null)
  /** 主区拖拽会话的收尾函数，供组件卸载时兜底摘监听器——跟 GanttNavigator 里同名
   *  机制对称（万一拖拽中途整个视图被切走，不能让 window 上残留的监听器继续摸一个
   *  已经卸载的组件）。 */
  const stageDragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stageDragCleanupRef.current?.(), [])
  // 缩放静默计时器的兜底同理：万一计时器还没触发就卸载了整个视图，别让它之后
  // 再摸一个已经不在的组件。
  useEffect(
    () => () => {
      if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current)
    },
    []
  )

  // 进来读一次，之后每 20 秒刷一次（有任务在跑时右端要跟着长）。
  // 拖拽/缩放中跳过这次刷新：既不给"手势进行中不 setState"的规则开口子，也避免
  // 轮询数据和预览 transform 用的是两套不同基准、同一帧里打架（表现为轻微跳动）。
  // 缩放同样要挡：它的锚点数学假定 now（进而 panoramaStart/End）在整个手势期间
  // 不变——手势通常远短于 20 秒，命中窗口很窄，但挡上不费事，比事后排查"缩放中
  // 突然轻微跳了一下"划算。
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      if (dragging || zooming) return
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
  }, [dragging, zooming])

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
      ? `最近 ${formatSpan(span)}`
      : `${mmdd(t0)} ${hhmm(t0)} – ${mmdd(t1)} ${hhmm(t1)}`

  // 渲染安全的子集——geometry（分行/分层/时间映射）和导航带的密度桶都从这里取数，
  // 不直接碰 tasks。见 isSaneTask 顶部注释。
  const safeTasks = useMemo(() => tasks.filter(isSaneTask), [tasks])

  // 全量分组（不看当前时间窗口）：项目 → 按终端(runId+ptyId)分的组，只在
  // safeTasks 变化时重算，拖动/缩放时间轴不会碰它。用它取"这个终端最早一条
  // 任务是什么时候"做稳定排序编号，以及任一条任务的 leafId 拿去查终端名——
  // 两者都不该随当前看的是哪一段时间窗口而改变（见文件顶部大注释第 5 条）。
  const groupsByProject = useMemo(() => {
    // 项目 -> (终端键 -> 组) 两层 Map，不拼接分隔符字符串当复合键——终端键
    // 本身已经带冒号（terminalKey 的 runId:ptyId），项目 id 是随机 uuid，
    // 两者硬拼在一起还得挑一个保证两边都不会出现的分隔符，不如老实嵌套一层
    // Map，省掉这道"选分隔符"的麻烦（也是这次顺手修正：早先直接拼接用单个
    // 空格当分隔符的写法在写入时被观察到会产生非法字节，不值得为了省一层
    // Map 冒这个险）。
    const byProjectRaw = new Map<string, Map<string, TermGroup>>()
    for (const t of safeTasks) {
      let terms = byProjectRaw.get(t.projectId)
      if (!terms) {
        terms = new Map()
        byProjectRaw.set(t.projectId, terms)
      }
      const tk = terminalKey(t)
      const g = terms.get(tk)
      if (!g) {
        terms.set(tk, { key: tk, leafId: t.leafId, tasks: [t], firstStart: t.startAt })
      } else {
        if (t.startAt < g.firstStart) g.firstStart = t.startAt
        g.tasks.push(t)
      }
    }
    const m = new Map<string, TermGroup[]>()
    for (const [projectId, terms] of byProjectRaw) {
      m.set(projectId, [...terms.values()].sort((a, b) => a.firstStart - b.firstStart))
    }
    return m
  }, [safeTasks])

  // 视窗过滤：从全量分组里筛出"当前 [t0,t1] 内有任务"的终端组，且只保留组内
  // 落在窗口内的那部分任务（view）。两条 continue 的口径跟改造前的 byProject
  // 一模一样，只是从"项目级"下沉到"终端级"——整条都在窗口左边/右边的任务
  // 不计入这个终端这一刻要不要出现在图上。
  const byProject = useMemo(() => {
    const m = new Map<string, VisibleGroup[]>()
    for (const [projectId, groups] of groupsByProject) {
      const visible: VisibleGroup[] = []
      groups.forEach((g, i) => {
        const view = g.tasks.filter((t) => (t.endAt ?? now) >= t0 && t.startAt <= t1)
        if (view.length) visible.push({ ...g, view, ordinal: i + 1 })
      })
      if (visible.length) m.set(projectId, visible)
    }
    return m
  }, [groupsByProject, t0, t1, now])

  // leafId → 这个终端所在标签页的标题 + 是否用户手动改过名。信源跟
  // BoardStage.tsx"一个终端一行"卡片用的是同一个（tabs 里的 leaf），复用既有
  // 约定：标题优先用 tab.title，因为 shell OSC 会在 agent 干活时把当前任务写
  // 进去，比这里另起一套命名更新鲜。只读 tabs/layout.ts，不改它们。
  const titleByLeaf = useMemo(() => {
    const m = new Map<string, { title: string; customTitle?: boolean }>()
    for (const tab of tabs) {
      for (const leaf of collectLeaves(tab.root)) {
        if (leaf.pane.kind === 'terminal') {
          m.set(leaf.id, { title: tab.title, customTitle: tab.customTitle })
        }
      }
    }
    return m
  }, [tabs])

  /** 终端子行的显示名——见文件顶部大注释第 2 条。标题存在、且（用户手动改过名
   *  或内容不等于项目名）才采信；否则退回"终端 N"（N 见 VisibleGroup.ordinal）。
   *  终端已关闭（titleByLeaf 查不到）同样落到这条兜底，不显示裸 ptyId。 */
  const terminalLabel = (g: VisibleGroup, projectName: string): string => {
    const info = titleByLeaf.get(g.leafId)
    const title = info?.title?.trim()
    if (title && (info?.customTitle || title !== projectName)) return title
    return `终端 ${g.ordinal}`
  }

  // 「清空这段」按的是原始 tasks（不是 safeTasks）——数值离谱到被 isSaneTask
  // 挡掉的记录，理应也能被这个按钮连带清掉，不然它们就成了唯一只能靠「清空
  // 全部」才够得着的孤儿数据。判据跟 byProject 上面两个 continue 条件互为镜像
  // （那边是"跳过不在窗口内的"，这里是"选中在窗口内的"），须保持口径一致——
  // 否则会出现"确认框写清空 3 条，实际清掉的条数对不上"这种体验裂缝。
  const inViewCount = useMemo(
    () => tasks.filter((t) => (t.endAt ?? now) >= t0 && t.startAt <= t1).length,
    [tasks, t0, t1, now]
  )

  /** 刻度密度按当前跨度连续自适应——span 现在可以是任意值（⌃+滚轮/双指缩放），
   *  不再是只有两档，选步长的算法见 pickTickStepMs 顶部注释。 */
  const tickStepMs = pickTickStepMs(span)

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
    // 万一有一个"⌃+滚轮/双指缩放"手势还没静默提交（罕见——两种手势通常来自不同
    // 输入设备/手指，理论上才会撞在一起），鼠标拖拽这个更"实打实"的手势（按钮
    // 真被按下了）应该赢：丢弃那个还没提交的缩放预览，不能让它事后用一份过时的
    // 快照悄悄覆盖掉拖拽刚提交的结果。
    cancelZoomSession()
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
   *  跳回终端"完全不受影响，因为拖拽逻辑压根不会在条上启动。
   *
   *  .gantt-group-toggle（Task 18 新增：多终端项目的分组折叠按钮）同一个道理
   *  排除在外——它也有自己的 onClick，不排除的话点一下会先被当成"位移未过
   *  阈值的拖拽"处理一遍：虽然最终 endDrag() 不会阻止 onClick 照常触发，
   *  但会在中途多打一轮 beginDrag/dragBaseRef 的读写，没必要让点一个折叠
   *  按钮牵扯上时间轴拖拽的状态机。 */
  const handleStageMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return // 只处理左键拖拽
    // 落在条上/分组折叠按钮上：交给它们自己的 onClick，不抢这次按下事件
    if ((e.target as HTMLElement).closest('.gantt-bar, .gantt-group-toggle')) return
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
    // 理由同 beginDrag 顶部那句：预设按钮的点击应该以"这一下"为准,不能被一个
    // 还没静默提交的缩放手势事后覆盖。
    cancelZoomSession()
    setViewStart((prev) => {
      if (prev === null) return prev
      const oldT1 = prev + span
      return clampViewStart(oldT1 - nextSpan, panoramaStart, panoramaEnd, nextSpan)
    })
    setSpan(nextSpan)
  }

  /** 缩放手势要放弃时的公共收尾：清计时器、清运行态、把可能已经画上去的预览
   *  transform/宽度摆回手势开始前的样子，不提交任何 state。用 previewZoom(base.t0,
   *  base.span) 而不是 navRef.resetFrame()——后者只复位取景框的 transform，缩放
   *  预览还额外写过取景框的 width 内联样式，resetFrame 不认得那部分；直接用
   *  base 的原始快照重画一次，transform 和 width 一次性都归位，不用另外扩一个
   *  只清 width 的方法。 */
  const cancelZoomSession = (): void => {
    if (zoomTimerRef.current !== null) {
      window.clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = null
    }
    const session = zoomSessionRef.current
    if (!session) return
    zoomSessionRef.current = null
    for (const el of session.base.els) el.style.transform = ''
    navRef.current?.previewZoom(session.base.t0, session.base.span)
    setZooming(false)
  }

  /** ⌃+滚轮 / 触控板双指捏合缩放时间跨度。原生 wheel 监听器 + passive:false
   *  的理由见 scrollRef 声明处的注释。挂在 [t0, span, panoramaStart, panoramaEnd,
   *  dragging, viewStart] 上——这几个值只在"两次手势之间"的正常渲染里变化
   *  （手势进行中我们刻意不 setState，见下方 onWheel 内部），所以监听器不会在
   *  一次连续手势中途被摘掉重挂，只会在手势与手势之间刷新成最新的基准值，跟
   *  "每次开始新手势都要用最新状态"这个需求正好对上。viewStart 单独列进来
   *  （不是靠 t0 联带触发)：正常情况下 viewStart 变了 t0 几乎总是跟着变，但
   *  存在一个巧合边界——viewStart 从 null 变成某个具体值、又恰好等于
   *  "此刻 now 换算出的 t0"，这种情况下 t0 数值不变，只靠 t0 当依赖会让下面
   *  onWheel 闭包里读到的 viewStart 是过期的 null，新手势的 wasLive 判断可能
   *  用错快照。直接把 viewStart 摆进依赖数组，不去赌这个巧合不会发生。 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    // 手势静默超过 ZOOM_COMMIT_IDLE_MS 才真正提交——定义在 onWheel 闭包内部
    // （而不是跟 cancelZoomSession 一样挂在组件顶层),是因为它唯一的调用点就是
    // 下面这个 setTimeout,不需要暴露给组件里其它地方,也就不需要操心"要不要把它
    // 塞进某个 useEffect 的依赖数组"这类问题——它摸的 zoomSessionRef/zoomTimerRef
    // 是 ref、setSpan/setViewStart/setZooming 是 setState 函数,两者在 React 里
    // 都是"跨渲染保持同一个引用"的东西,天然不会有闭包过期的风险。
    const commitZoom = (): void => {
      const session = zoomSessionRef.current
      zoomSessionRef.current = null
      zoomTimerRef.current = null
      setZooming(false)
      if (!session) return
      // 内容侧（.gantt-axis/.gantt-lanes）的预览 transform 不在这里清——提交
      // 必然让 t0 变化（span 变了,t0=t1-span 这个式子里 span 本身就是被减数,
      // 必然跟着动),下面按 [t0] 的 useLayoutEffect 会接管清理,不重复做。
      setSpan(session.current.span)

      // 复审揪出的 Critical bug：这里原来无条件 setViewStart(具体数字)，等于
      // 缩放这一下就把"贴住 now、跟随实时"的状态永久冻结成一个死值——用户在
      // 直播视图上随手滚一下就静默停止跟踪，没有任何提示，唯一恢复方式是切走
      // 视图再切回来（组件卸载重挂载）。changeSpan（点 24h/3d 预设按钮）从
      // Task 6 起就明确保留了这一条（`if (prev === null) return prev`），
      // 缩放这条路径漏掉了同一件事,不是有意为之的设计差异。
      //
      // 判据是两条 OR 起来（各自的道理见 LIVE_EDGE_EPSILON_MS / NEAR_LIVE_FRACTION
      // 顶上的注释，这里只留结论）：
      //   ① clampBound——结果的右边缘 nextT1 精确贴着 panoramaEnd(=now)。
      //      这条只在"缩小"方向天然成立（clampViewStart 把想探到"未来"的部分
      //      砍掉了，跟锚点在哪儿无关），"放大"方向几乎不可能精确命中。
      //   ② nearLiveEdge——光标指向的时间点（tCursor）离 now 足够近（结果
      //      跨度 nextSpan 的 10%，至少半个 MIN_SPAN）。这条专门补"放大"方向：
      //      锚点贴着最右侧缩放时，nextT1 离 now 的差距是跨度的函数（差几像素
      //      在大跨度下换算成分钟甚至小时级的缺口），用结果的时间差做判据会
      //      时紧时松，改用"光标本身指向的点够不够新"、且门槛跟着跨度走，
      //      才能在任意缩放层级下都对应同一块屏幕区域。
      // 两条都要求 AND 上 wasLive（手势开始时 viewStart 是不是已经是 null）——
      // 否则会出另一种错：用户已经拖动取景框手动定位到某段历史（viewStart 是
      // 具体值），这时候如果缩放凑巧也让结果落在 now 附近，不该被这个巧合
      // "悄悄拉回直播"，那是在替用户做他没做过的决定。wasLive 是手势开始那
      // 一刻的快照（session.base 里），不是缩放中途会变的东西，用它做门槛正确。
      //
      // 都不满足时（比如锚点在时间轴中段，缩放进了一段明确的历史切片）冻结
      // 才是对的——用户缩放进了一段过去，视图不该在他松手后悄悄自己往前滑走。
      const { t0: nextT0, span: nextSpan, tCursor } = session.current
      const nextT1 = nextT0 + nextSpan
      const clampBound = nextT1 >= session.base.panoramaEnd - LIVE_EDGE_EPSILON_MS
      const nearLiveWindow = Math.max(NEAR_LIVE_MIN_MS, nextSpan * NEAR_LIVE_FRACTION)
      const nearLiveEdge = session.base.panoramaEnd - tCursor <= nearLiveWindow
      const stillLive = session.base.wasLive && (clampBound || nearLiveEdge)
      setViewStart(stillLive ? null : nextT0)
    }

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return // 不是缩放（双指滑动/普通滚轮）：交给浏览器原生垂直滚动
      e.preventDefault() // 挡掉浏览器自己的页面缩放/后退前进手势
      if (dragging) return // 鼠标拖拽平移进行中：这一格滚轮让路，不跟它抢 transform

      let session = zoomSessionRef.current
      if (!session) {
        // 新手势的第一个 tick：量一次基准几何、缓存要一起变换的元素。
        const axisEl = plotRef.current?.querySelector<HTMLElement>('.gantt-axis')
        if (!plotRef.current || !axisEl) return
        const rect = axisEl.getBoundingClientRect()
        if (rect.width <= 0) return // 量不到宽度（比如这一帧还没铺满）：这次先放弃
        const els = Array.from(
          plotRef.current.querySelectorAll<HTMLElement>('.gantt-axis, .gantt-lanes')
        )
        // 手势开始前把浮层清空，理由同 beginDrag：条会在静止的光标下面缩放/滑动，
        // 挂着的浮层会变成一个跟内容脱节的"幽灵浮层"。
        cancelHide()
        setHover(null)
        session = {
          base: {
            t0,
            span,
            leftPx: rect.left,
            widthPx: rect.width,
            els,
            panoramaStart,
            panoramaEnd,
            wasLive: viewStart === null
          },
          // tCursor 这里随便填一个合法值就行——本次 tick 走到下面会立刻按
          // 真实公式重算并覆盖，这个初值不会被读到任何计算里。
          current: { t0, span, tCursor: t0 }
        }
        zoomSessionRef.current = session
        setZooming(true)
      }

      const { base } = session
      const cur = session.current

      // deltaMode：0=像素（Chromium 常态）、1=行、2=页——同 CanvasStage.tsx
      // 150-172 行那段缩放手柄，不折算的话行/页模式下步长会小得动不了。
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
      // **鼠标滚轮和触控板必须分开处理**——原因和数值全部照抄 CanvasStage.tsx
      // 那段注释，这里不重复整套推导：Windows 鼠标滚轮一格就是 100~120，按触控板
      // 那套 `1-dy*0.01` 的连续小量公式会直接把 factor 拉到 0 或负数，表现成
      // "轻轻一滚，一步到底"。判据是单次跨度 ≥40（触控板再快也是连续小步）。
      const byWheel = Math.abs(dy) >= 40
      const factor = byWheel
        ? dy > 0
          ? 1 / 1.12 // 滚轮：每格固定 ±12%，跟 dy 具体是 100 还是 120 无关
          : 1.12
        : Math.exp(-dy * 0.01) // 触控板：小量下手感连续，且永远为正
      // factor 是"画面放大倍率"的语言（>1=放大）；span 是"看多久"，跟放大倍率
      // 成反比——放大即看得更细即 span 变小，所以是除不是乘。
      const nextSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, cur.span / factor))

      // 锚点：光标在（不会变的）基准几何里的相对位置，据此换算出光标当前指向的
      // 时间点，缩放后要让同一个时间点仍然落在这个相对位置上。夹到 [0,1] 防御
      // 光标碰巧落在轴外（比如行名列、纵向滚动条）时的越界外推。
      const f = Math.min(1, Math.max(0, (e.clientX - base.leftPx) / base.widthPx))
      const tCursor = cur.t0 + f * cur.span
      const rawT0 = tCursor - f * nextSpan
      const nextT0 = clampViewStart(rawT0, base.panoramaStart, base.panoramaEnd, nextSpan)

      // tCursor 也存进去——commitZoom 要用它判断"光标指向的这个时间点离 now
      // 够不够近"（见 NEAR_LIVE_FRACTION 的注释），不是这里算完就扔。
      session.current = { t0: nextT0, span: nextSpan, tCursor }

      // 内容预览：把 .gantt-axis/.gantt-lanes 当一整块刚性图层做"绕锚点缩放"——
      // 数学上等价于先按锚点位移再整体缩放，具体推导见 GanttStage 顶部这次改动
      // 的设计记录（task-17 报告）；这里只留结论：k 是相对手势起点的累计缩放倍率，
      // txPx 是配套的位移，两者一起用能保证锚点时间在缩放前后屏幕位置不变。
      const k = base.span / nextSpan
      const txPx = ((base.t0 - nextT0) / nextSpan) * base.widthPx
      for (const node of base.els) {
        node.style.transform = `translateX(${txPx}px) scaleX(${k})`
      }
      // 导航带取景框同步：宽度和位置都要跟着连续变，不能等提交才跳一下。
      navRef.current?.previewZoom(nextT0, nextSpan)

      if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = window.setTimeout(() => {
        zoomTimerRef.current = null
        commitZoom()
      }, ZOOM_COMMIT_IDLE_MS)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [t0, span, panoramaStart, panoramaEnd, dragging, viewStart])

  /** 一行里"刻度网格 + 分层的条"那一整块。改造前只有一处调用点（每项目一行），
   *  现在要在三处复用同样的渲染：单终端项目的整行、多终端项目折叠态的合并行、
   *  展开态每条终端子行——抽出来是因为三份字面复制的 JSX 会让"改一处漏两处"
   *  从抽象风险变成具体会发生的事。喂给它的任务集合不同，渲染逻辑完全一样，
   *  逐条任务的定位/配色/hover/点击跳转都不变。 */
  const renderLanes = (rowTasks: GanttTask[]): JSX.Element => {
    const layers = layer(rowTasks, now)
    return (
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
    )
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
        className={`gantt-scroll${dragging ? ' dragging' : ''}${zooming ? ' zooming' : ''}`}
        ref={scrollRef}
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
            const groups = byProject.get(p.id) ?? []
            // 只有一个终端在当前窗口有活动：跟改造前一模一样的单行，不额外
            // 加分组头——没有第二个终端可比较，标题栏重复写一遍项目名毫无
            // 信息量，折叠按钮也没有意义（收起唯一的内容等于把整行藏起来，
            // 不是"精简"）。见文件顶部大注释第 4 条。
            if (groups.length === 1) {
              return (
                <div className="gantt-row" key={p.id}>
                  <div className="gantt-rowname" title={p.name}>
                    {p.name}
                  </div>
                  {renderLanes(groups[0].view)}
                </div>
              )
            }
            const isCollapsed = collapsedGroups.has(p.id)
            return (
              <div className="gantt-group" key={p.id}>
                <div className="gantt-row gantt-group-hd">
                  <div
                    className="gantt-rowname gantt-group-toggle"
                    title={`${p.name} · ${groups.length} 个终端 · 点击${isCollapsed ? '展开' : '折叠'}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleGroup(p.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      toggleGroup(p.id)
                    }}
                  >
                    {isCollapsed ? <ChevronRightIcon size={10} /> : <ChevronDownIcon size={10} />}
                    <span className="gantt-group-name">{p.name}</span>
                  </div>
                  {/* 折叠态：把这个项目全部终端的任务合并回一行——数学上等于
                      改造前"一项目一行"的老样子，折叠只是临时切回旧行为，
                      不丢信息（条还在，只是不再按终端分开摆）。这一行的
                      高度跟"只显示标题不显示条"是同一个高度预算，合并画条
                      纯粹是多出来的免费信息量，不占额外空间。 */}
                  {isCollapsed && renderLanes(groups.flatMap((g) => g.view))}
                </div>
                {!isCollapsed &&
                  groups.map((g) => (
                    <div className="gantt-row gantt-subrow" key={g.key}>
                      <div className="gantt-rowname sub" title={terminalLabel(g, p.name)}>
                        {terminalLabel(g, p.name)}
                      </div>
                      {renderLanes(g.view)}
                    </div>
                  ))}
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
        dragging={dragging || zooming}
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
