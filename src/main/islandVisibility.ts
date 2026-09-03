// 灵动岛该不该出现在屏幕上。
//
// 抽成纯函数是因为这条判定横跨两个进程、四五个事件源（窗口 focus/blur、主窗口里的
// mousedown、岛自己的展开/折叠、Dock 菜单、状态推送），散在 island.ts 里靠读代码
// 对不出来它在某个组合下到底给什么答案 —— 而它一旦给错，表现是「岛压在软件顶上
// 抢走那一片的点击」，用户会当成软件坏了。
//
// 这里不引 electron，`node --test` 直接跑。
//
// ── 唯一的总规则（2026-09-01 用户定的）────────────────────────────────────────
//
//   **岛和前台的主体软件互斥，绝不共存。**
//
// 「前台」= 主窗口 focused 且没最小化、可见（island.ts 的 mainInForeground 实时查，
// 不维护镜像 —— 见那里的注释，维护镜像栽过一次）。
//
// 前台时唯一的例外是 `held`，而 held **只能由用户的主动动作置起**：
// 从 Dock 菜单点「显示灵动岛」，或者用户自己把岛展开着在读。
// 岛的渲染层**不能**靠自己（比如来了新通知就自动展开）在前台把它顶出来 ——
// 那是 acceptHold() 挡的事。
//
// 而 held 一旦置起，下面任何一件事都当场把它清掉（island.ts 里的 releaseHold）：
//   · 从岛上点了某条进主体软件（那是「我来处理了」）
//   · 主窗口拿到焦点（cmd-tab / 点 Dock / 全屏切回来，都走这条）
//   · 主窗口里点了任何地方（App.tsx 的 capture 阶段 mousedown）
//   · 岛的窗口被销毁（不清的话 held 会**留到下一次**，那时岛会凭空压在前台软件上）

export interface IslandVisibility {
  /** 设置里的总开关（prefs.island）。关掉就根本不建那扇窗口 */
  enabled: boolean
  /** 主窗口在不在前台 */
  mainForeground: boolean
  /** 有没有东西可显示：有终端在跑，或有待处理通知 */
  hasContent: boolean
  /** 通知里有没有「等审批」那种 —— 后台时它有特权，见下 */
  hasApproval: boolean
  /** 用户主动要它留着（Dock 菜单叫出来 / 自己展开着在读）。**只在前台这一档起作用** */
  held: boolean
  /** 用户刚点了「进软件」，正在激活途中。**压过下面所有规则。**
   *
   *  2026-09-02 用户报的那个：「最大化软件的情况下，点灵动岛进入软件的时候，
   *  灵动岛没退、主软件的点击（被它接走）。」
   *
   *  为什么单开一个字段、不复用 held：`dispatchAction` 的 focus 分支一直在清 held，
   *  但清了**没用** —— 那一刻 `mainForeground` 还是 false（激活是异步的），
   *  判定落到后台分支 `return hasContent`，**那条分支不看 held**。
   *
   *  这段空窗有多长取决于激活要多久：窗口态约 100ms；**全屏态是一整次
   *  Space 切换动画**。而展开着的岛有 82px 高、全屏下主窗口从 y=26 起 ——
   *  正好盖住 app 顶上 56px 那条，用户以为点的是软件，点到的是岛。
   *
   *  **必须有超时兜底**（island.ts 里）：macOS 对「后台进程自己切自己到前台」
   *  有节流，激活可能压根不成功（见 verifyRealActivation 那段实测）。
   *  没有超时的话，一次失败的激活会把岛永久藏起来。 */
  enteringApp?: boolean
}

/**
 * 岛该不该在。**所有入口最终都问这一个函数**，island.ts 里不许再有第二处判定。
 */
export function islandShouldShow(v: IslandVisibility): boolean {
  if (!v.enabled) return false
  // 用户已经表态「我要用软件了」。**放在最前面**：后台那条「审批有特权」
  // 也不该盖过它 —— 他正要进去，审批在软件里看得见，岛没有理由再挡在路上。
  if (v.enteringApp) return false
  // 前台：默认让位。只有用户自己叫出来 / 正展开着在读才留着，
  // 且这一档随时会被一次点击掐掉（见文件头）。
  if (v.mainForeground) return v.hasContent && v.held
  // 后台：审批是要人回话的，没它那条终端就一直卡着，所以哪怕别的都空也要露面。
  if (v.hasApproval) return true
  return v.hasContent
}

/**
 * 岛请求「留着别收」时，答不答应。
 *
 * **前台时一律不答应**（除非这次 hold 本身就是用户主动叫出来的，那条路在
 * island.ts 里直接置 held，不经过这里）。
 *
 * 挡的是这条真实路径：岛本来在后台露着、用户展开着在读 → 他 cmd-tab 回主体软件
 * → 主进程清 held、开始播退场动画 → 就在这 200ms 里岛的渲染层因为来了条新通知
 * **自动展开**、发来 hold(true) → 退场被撤销，岛重新压在前台软件的标题栏上。
 * 用户没做任何要它出来的动作，它自己回来了。
 *
 * 松手（false）任何时候都答应 —— 「收起来」这件事不需要许可。
 */
export function acceptHold(next: boolean, mainForeground: boolean): boolean {
  if (!next) return true
  return !mainForeground
}
