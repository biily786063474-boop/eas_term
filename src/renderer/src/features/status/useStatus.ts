// 状态机与 store 之间唯一的那道门。四个视图都从这里拿数据，
// 谁都不许自己去 store 里捞那六个字段——那样又会长出第二套推导。
import { useMemo } from 'react'
import { useStore } from '../../store'
import { planFocus, type FocusMode } from './focusPlan'
import type { AppState } from '../../store'
import { byProject, locate, sortRows, statusOf, urgencyCmp } from './machine'
import type { LocateCtx, Located, ProjectRow, RawSignals, TermState } from './machine'

/** 把 store 里那六个字段取成一份快照。
 *
 *  **逐字段订阅，不订阅整个 store。** 订阅整个 store 的话，任何无关变化
 *  （比如别的终端标题变了）都会让所有消费者重渲染一轮。 */
function useRaw(): RawSignals {
  const runningPtys = useStore((s) => s.runningPtys)
  const attentionPtys = useStore((s) => s.attentionPtys)
  const ptyApproval = useStore((s) => s.ptyApproval)
  const ptyTiming = useStore((s) => s.ptyTiming)
  return useMemo(
    () => ({ runningPtys, attentionPtys, ptyApproval, ptyTiming }),
    [runningPtys, attentionPtys, ptyApproval, ptyTiming]
  )
}

/** 组出 locate 需要的上下文快照。纯取值，不是 hook——给下面 useStore 的 selector
 *  内部调用，每次 selector 跑都现取，不需要额外记忆化。 */
function ctxOf(s: AppState): LocateCtx {
  return { tabs: s.tabs, frames: s.canvas.frames, projects: s.projects }
}

/** 把一份对象数组压成一个字符串 key——ProjectRow/PendingRow 都适用。
 *
 *  这是绕开下面这个限制的办法：zustand 5 把自定义 equalityFn 那条路
 *  （`useStoreWithEqualityFn`，来自 `zustand/traditional`）单独拆出去了，
 *  它要装 `use-sync-external-store` 这个包（peerDependency，不是直接依赖），
 *  这个仓库没装，也不为了这一处订阅优化新增运行时依赖。
 *
 *  但只要 selector 吐出来的是一个 primitive（字符串），标准 useStore 默认的
 *  Object.is 比较就天然够用——字符串是按值比较的，即使每次都是 new 出来的
 *  字符串对象，内容一样就相等。selector 内部该怎么算还怎么算（tabs/frames
 *  拖分隔条/拖画布节点时引用会变，跟终端状态无关，见 useProjectRows 里的说明），
 *  只是最后不返回数组本身，返回它的「指纹」。
 *
 *  直接用 JSON.stringify，不手写拼接：ProjectRow 的字段都是 id/枚举/数字，
 *  手写怎么拼都没事，但 PendingRow 继承 Located 的 project/term——分别是项目名和
 *  终端标题（后者来自 shell 标题，是任意文本），手写拼接理论上存在两份不同的
 *  行序列拼出同一个字符串的碰撞（比如某个值里恰好含分隔符）。JSON.stringify
 *  对特殊字符做转义，没有这个问题，成本跟手写拼接一个量级，没有理由不用严格
 *  无碰撞的那个。 */
function rowsKey<T>(rows: readonly T[]): string {
  return JSON.stringify(rows)
}

/** 所有有状态的项目，已排好序（approval > done > running）
 *
 *  **不是「算完再 useMemo」，是「先订阅一个指纹」。** 拖分隔条（setSplitRatio）、
 *  拖画布节点（moveNode/resizeNode）时 tabs/frames 引用会变，但内容往往跟
 *  终端状态毫无关系——如果先订阅 tabs/frames 本身再拿 useMemo 收尾，
 *  useMemo 只能省重算，省不了这次重渲染：它的依赖数组一变，包住它的组件
 *  已经被判定「要重渲染」了，memo 跑不跑都晚了。
 *
 *  所以反过来：useStore 的 selector 直接把整个计算跑一遍算出 rowsKey（一个
 *  字符串），拖拽期间这个字符串前后不变——默认的 Object.is 比较就在订阅这层
 *  把「没有实质变化」拦下来，组件本身都不重渲染。真的变了（key 不一样）才会
 *  让下面这个 useMemo 重新算出实际要用的数组。 */
export function useProjectRows(): ProjectRow[] {
  const raw = useRaw()
  const key = useStore((s) => {
    const ids = [...new Set([...raw.runningPtys, ...raw.attentionPtys])]
    return rowsKey(sortRows(byProject(ids, raw, ctxOf(s))))
  })
  return useMemo(() => {
    const ids = [...new Set([...raw.runningPtys, ...raw.attentionPtys])]
    return sortRows(byProject(ids, raw, ctxOf(useStore.getState())))
    // key 变了才重算；raw 已经含在 key 的输入里，不用重复列进依赖数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * 待处理列表要显示的一条。**approval、done、以及「还在跑但叫了你」都算，approval 排前面。**
 *
 * 原来这里只列 done（那时叫 `DoneRow` / `useDoneRows`），右上角气泡数也只数 done。
 * 那是个回归：**画布模式下这个气泡是 approval 唯一的常驻提示**——标题栏铃铛在画布
 * 模式根本不挂载（App.tsx 的 `viewMode !== 'canvas'`），运行监视只显示 running，
 * 灵动岛只在应用切到后台时才出现，而气泡只在资源抽屉收起时渲染（收起是干活的常态）。
 * 换成只数 done 之后，「CLI 停在权限确认框上」响一声提示音，屏幕上却没有任何东西
 * 告诉你响的是哪里——而 approval 恰恰是规格 §1.1 里唯一「不管就永远卡着」的状态，
 * 那一条还写着它「在任何排序里都排最前」。
 *
 * 改名也是这个原因：一个叫 done 的东西里装着 approval，下一个人读到名字就会判断错。
 */
export interface PendingRow extends Located {
  /** 这一条此刻的执行状态：approval / done，或者 **running**——
   *  「还在跑，但 agent 叫了你一声」（onBell / MCP notify）。
   *  决定用哪个 icon 形态，也决定排在哪一档（running 排最后）。 */
  state: TermState
  at: number
}

function computePendingRows(raw: RawSignals, ctx: LocateCtx): PendingRow[] {
  const out: PendingRow[] = []
  // 直接遍历 attentionPtys —— 「在等你的」就是这个集合，不再按 statusOf 过滤掉 running。
  // 画布模式下这个列表是气泡的内容，而气泡是标题栏铃铛的画布版（铃铛在画布模式
  // 不挂载，见 App.tsx）：铃铛认的是 row.attn，这里也必须认同一件事，
  // 否则同一条提醒在分屏看得见、切到画布就没了。
  for (const ptyId of raw.attentionPtys) {
    const st = statusOf(ptyId, raw)
    if (!st) continue // 在 attentionPtys 里就必然有状态，纯防御
    const loc = locate(ptyId, ctx)
    if (!loc) continue
    out.push({ ...loc, state: st, at: raw.ptyTiming[ptyId]?.lastDoneAt ?? 0 })
  }
  // 顺序直接用 machine.ts 的 URGENCY 口径，不另写一套：
  // approval > done > running（还在跑的那种最不急，它自己还在推进），同档内最近的在前
  return out.sort((a, b) => urgencyCmp(a.state, a.at, b.state, b.at))
}

/** 列出所有 approval / done 的终端，approval 在前。理由同 useProjectRows：先订阅一份
 *  rowsKey 指纹，拖拽造成的引用变化产出同一个 key 时不该让这里的消费者跟着重渲染，
 *  key 真的变了才用 useMemo 重新算出实际数组。 */
export function usePendingRows(): PendingRow[] {
  const raw = useRaw()
  const key = useStore((s) => rowsKey(computePendingRows(raw, ctxOf(s))))
  return useMemo(
    () => computePendingRows(raw, ctxOf(useStore.getState())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
}

/**
 * 跳到某个终端并清掉它的状态。
 *
 * **清除就发生在这里，只发生在这里。** 规格 §1.2 第四条：
 * 「被聚焦到眼前」= 发生了一次指向该终端的聚焦动作，
 * **「它在画布上可见」不算**——画布模式下 PaneLayer 把所有 leaf 都渲染着，
 * 拿可见性当判据的话 done 会在产生的同一帧被清掉，整个功能等于没有。
 *
 * **同一条规则还有另一半：「跳了」不等于「看得见」，得先把目标切到真会显示
 * 出来的地方，再清状态。** openTerminal（⌘T / 侧栏 / 抽屉双击……几乎所有开
 * 终端的入口）只建 tab，不建画布节点，所以「没有 frameId/nodeId」是主流情况，
 * 不是边角。这类终端如果只切 activeLeaf 不切 viewMode：用户正开着画布，点了
 * 抽屉里一行 → clearAttention 已经把提醒吃掉了，但 Sidebar/TabBar/tab-stack
 * 全部按 `viewMode === 'split'` 才挂载（App.tsx），画面上什么反应都没有——
 * 通知消失、用户根本没看见，正是这条规则要防的失败，只是从另一条路走到的。
 * 所以两支各自负责把目标切到真能看见的地方，都做完才清：
 *  - 终端在画布上（有 frameId/nodeId）→ 切画布模式 + focusCanvasNode
 *  - 不在画布上 → 切分屏模式；分屏下 setActiveLeaf 不会自动跟 activeProject
 *    （那是留给用户手动点标签用的，见 tabsSlice.ts 里的注释），但 TabBar 按
 *    activeProjectId 严格过滤标签、App.tsx 的 hasProjectTabs 同理，不手动切
 *    的话跳过去的标签压根不会出现，所以要跟着切 activeProject。
 * 跟 useIslandFeed.ts 灵动岛跳转是同一套处理。
 *
 * **setActiveProject 不再顺手清提醒。** 它原来默认会把目标项目全部终端的
 * attentionPtys 一并清掉（语义写的是「这个项目我来看了」），这里靠传
 * `keepAttention: true` 躲开。后来查实那条默认行为在**四个**调用点上都是错的
 * （侧栏、看板两处、抽屉项目行——每一处都只把其中一个终端摆到眼前，却清掉全部），
 * 于是整条删掉了，参数也一并去掉，见 projectsSlice.ts 的说明。
 * 清除现在只发生在两处，都是逐终端的：这个函数的最后一行，
 * 以及终端拿到输入焦点时 TerminalView 的 focusin。
 */
export function focusTerminal(ptyId: string): void {
  const st = useStore.getState()
  const loc = locate(ptyId, { tabs: st.tabs, frames: st.canvas.frames, projects: st.projects })
  if (!loc) return
  // **模式隔离**：能在当前模式里看见这个终端，就别把用户拽走。
  // 判据在 focusPlan.ts（纯函数、可单测）——原来判的是「终端在画布上有节点」，
  // 而画布和分屏共享同一批 leaf，于是在分屏里用得好好的也会被切到画布。
  const plan = planFocus(st.viewMode as FocusMode, !!(loc.frameId && loc.nodeId))
  if (plan.switchTo) st.setViewMode(plan.switchTo)
  if (plan.target === 'canvas') {
    // **fit**：通知把用户叫过来，就得让他一眼看到整个终端。
    // 原来是保持当前缩放只平移，稍大的缩放下节点比视口还高 ——
    // 屏幕上全是那一个终端，看不到全貌，四周也没有空地能抓着拖画布
    //（按下去全落进 xterm 了）。2026-08-31 用户报的就是这个。
    st.focusCanvasNode(loc.frameId!, loc.nodeId!, { fit: true })
  } else {
    // 必须排在下面 setActiveLeaf 之前：setActiveProject 自己也会顺手挑一个
    // 「该项目上次激活的标签」写回 activeTabId（pickActiveTab，不一定是 loc.tabId）。
    // 顺序对了，setActiveLeaf 才是最后一个写 activeTabId 的，落点精确到 loc.tabId；
    // 顺序反了，刚设对的 activeTabId 会被这行的猜测覆盖掉。
    //
    // **loc.projectId 可能是 null（散终端，没有项目归属）——这时不能调
    // setActiveProject(null, ...)。** 那样会把用户正看着的项目上下文（侧栏高亮、
    // 文件树）清空，跟 setActiveLeaf 里 `tab?.projectId ?? s.activeProjectId`
    // 那种「没有项目就保留原值」的处理方式相悖，也跟 useIslandFeed.ts 灵动岛
    // 跳转的既有写法（同样是 `if (loc.projectId) st.setActiveProject(...)`）不一致。
    if (loc.projectId) st.setActiveProject(loc.projectId)
  }
  st.setActiveLeaf(loc.tabId, loc.leafId)
  st.clearAttention(ptyId)
}
