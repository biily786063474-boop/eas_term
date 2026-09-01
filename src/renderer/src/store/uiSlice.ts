// UI 切片：主题、危险操作确认弹窗、跨面板的「最近活动终端」标记

import type { StateCreator } from 'zustand'
import type { ShortcutOverrides } from '../../../shared/shortcuts.ts'
import { ThemeId, loadTheme, applyTheme } from '../themes'
import type { AgentRole, ArchiveItem, BoardColumn, AgentKind } from '../../../shared/types'
import type { PendingConfirm } from './shared'
import type { AppState } from './types'
import type { ApprovalInfo } from '../features/terminal/approvalParse'

/** refreshAgentCli 的节流时间戳。模块级：它是纯副作用节流，不参与渲染 */
let lastAgentCliAt = 0

/** 从字典里去掉一个键，返回新对象（原对象不动）。清 pty 相关的几张表都要用 */
function dropKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj
  const { [key]: _drop, ...rest } = obj
  return rest
}

/** 甘特图轨道右键菜单三选一的目标视图——手动对齐 ViewMode 去掉 'gantt' 自己
 *  （点条不可能"跳到甘特图"，那就是当前所在的视图）。不用 Exclude<ViewMode,'gantt'>
 *  派生：两处独立手写更直白，以后要不要跟着 ViewMode 扩是甘特图跳转这边自己
 *  的决定，不该被 ViewMode 的定义变化顺带牵动。 */
export type GanttJumpMode = 'split' | 'canvas' | 'board'
/** 甘特图主区画什么（2026-08-27 新增）：
 *  · 'session'   一根条 = 一次「你发出去的话 → agent 干完」（一直以来的样子，默认）
 *  · 'project'   一个项目一行，一根条 = 一个工作阶段（30 分钟静默切段）
 *  · 'milestone' 阶段画成淡带，每次发送/每次返回各插一枚菱形 */
export type GanttViewMode = 'session' | 'project' | 'milestone'

/** 双击画布空白弹出的项目列表的排序方式 */
export type ProjectMenuSort = 'default' | 'recent'

export interface UiSlice {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  /** 用户改过的快捷键 `{ id: 组合串 }`，只存改过的。真相源是注册表
   *  （src/shared/shortcuts.ts），这里只放覆盖层。落盘在 prefs。 */
  shortcutOverrides: ShortcutOverrides
  /** 传 null = 恢复这一条的默认键。**写盘失败也保留内存里的改动** ——
   *  下次启动会回到旧键，但当下这一按就生效，比「点了没反应」强。 */
  setShortcutOverride: (id: string, keys: string | null) => void
  /** 启动时从 prefs 灌进来一次 */
  loadShortcutOverrides: (v: ShortcutOverrides) => void
  /** 危险操作确认弹窗（终端运行中关闭/退出时触发） */
  pendingConfirm: PendingConfirm | null

  /**
   * 当前占据全屏的覆盖层是谁（没有就是 null）。值是模块名，只为排查时看得懂。
   *
   * 存在的理由：设计模块打开后是一个 portal 到 body 的 fixed 全屏层，画布在它下面
   * **看不见也够不着**，但画布那几个 window 级键盘监听照样在收键 —— 于是在设计模块里
   * 按 Delete 会删掉画布上的节点、按空格会切成画布平移手势、按 Esc 会两边一起响应。
   * 用户的说法是「设计模块全屏的时候画板上的操作不要劫持设计模块内的操作」。
   *
   * **用状态而不是判 DOM 祖先**：覆盖层 portal 到了 body，`closest('.design-node')`
   * 根本够不着它；改判它自己的根 class 又得逐个视图去认（.ua / .uc__… 各不相同，
   * 而且那是移植过来的 jsx，以后同步上游会变）。状态与 DOM 结构无关，也让下一个
   * 全屏模块直接复用这条守卫。
   */
  fullscreenOverlay: string | null
  setFullscreenOverlay: (who: string | null) => void
  requestConfirm: (c: PendingConfirm) => void
  cancelConfirm: () => void
  /** 最近聚焦过的终端（供名词词典等非终端面板把文本插入光标处；打开词典后 activeLeaf 是词典自己，故单独记）。
   *  由 TerminalView 的 focusin 处理器直接 setState 写入。 */
  lastActiveTerminal: { tabId: string; ptyId: string } | null
  /** 最近聚焦过的 **AI 对话输入框**的「把文本追加进去」回调（2026-08-26）。
   *
   *  **存回调不存 id**：对话有两个输入框 —— 空态那个在 AgentChatView、对话态那个在
   *  ChatToolbar（见 SlashPicker.tsx 开头那句），两者的 text 各自是组件内 state，
   *  连标识都不一样（一个只有 leafId、一个只有 sessionId）。存 id 的话这边还得再按
   *  id 分发一次，等于把同一件事写两遍；存回调则谁聚焦谁注册自己的 setText。
   *
   *  **和 lastActiveTerminal 互斥**：聚焦终端时由 TerminalView 一并置 null。
   *  没有这条互斥的话，「先点对话、再点终端、然后点词典」会插回对话里 ——
   *  用户看着终端却什么都没出现。null = 当前该插终端。
   *
   *  不持久化（函数本来也存不下），uiSlice 只手动存特定字段，不走 persist。 */
  composerAppend: ((text: string) => void) | null
  setComposerAppend: (fn: ((text: string) => void) | null) => void
  /** 往当前对话输入框挂一个辞典 chip。**和 composerAppend 是两条通道，不是一条**：
   *  append 收纯文本（终端也走这条），chip 只在 AI 对话成立 —— 终端是字节流，
   *  没有 DOM，挂不了一个能点掉的块。
   *
   *  登记方式和 composerAppend 一样：谁聚焦谁注册自己的 addChip。
   *  为 null 时 DictView 退回插纯文本（终端 / 没有输入框可插）。 */
  composerAddChip: ((chip: { id: string; label: string; text: string }) => void) | null
  setComposerAddChip: (fn: ((chip: { id: string; label: string; text: string }) => void) | null) => void
  /** 最近一次快照。给终端输入框上方的浮层用 —— 只在同项目的终端里显示。
   *  不持久化：它是「刚拍完这一下」的临时状态，重启后没有意义 */
  lastSnapshot: { path: string; projectId: string; at: number } | null
  setLastSnapshot: (v: { path: string; projectId: string; at: number } | null) => void
  /** 需要用户处理的终端 ptyId（终端响铃触发、聚焦后清除）——供抽屉项目呼吸提示 */
  /** 看板里每个项目当前显示哪个终端（键=projectId，值=leafId）。
   *  一个项目开了好几个终端时，卡片只放得下一个，用卡片头的下拉换。
   *  不持久化：终端本身重启后要重开，记着一个失效的 leafId 没有意义 */
  boardLeafByProject: Record<string, string>
  setBoardLeaf: (projectId: string, leafId: string) => void
  /** 看板的列定义。全局，存 board.json —— 项目只记自己在哪一列的 id */
  boardColumns: BoardColumn[]
  loadBoardColumns: () => Promise<void>
  /** 整表落盘。增删改序都走它：每个动作一个方法的话，「顺序」没法原子地表达 */
  saveBoardColumns: (list: BoardColumn[]) => Promise<void>
  addBoardColumn: () => Promise<void>
  renameBoardColumn: (id: string, name: string) => Promise<void>
  /** 删列。**列上的项目不跟着删** —— 它们回到「未分类」，
   *  删一个分类顺手删掉里面的项目是没人想要的行为 */
  removeBoardColumn: (id: string) => Promise<void>
  /** 看板里点开全屏的那个终端（leafId）。null = 回到卡片总览。
   *  看板本身**不显示终端** —— 卡片只是摘要，点开才铺满干活。
   *  小卡片里嵌终端看不清也用不了，还要为它做一整套跟随定位，不划算。 */
  boardFullscreen: string | null
  setBoardFullscreen: (leafId: string | null) => void
  /** 甘特图左键点条要跳到哪个视图——右键菜单（终端/画布/看板）选完记这里，
   *  下次左键跟着走。纯 UI 偏好，不跟甘特图数据（gantt.json，主进程管）混在
   *  一起；存 localStorage，参考 dictBubbleHidden 的存法。默认 'board'，
   *  跟这个功能上线前"左键固定跳看板全屏"的老行为一致——没设置过这项偏好的人
   *  （含老用户）体验不变。 */
  ganttJumpMode: GanttJumpMode
  setGanttJumpMode: (mode: GanttJumpMode) => void
  /** 甘特图主区的画法。纯 UI 偏好，存 localStorage，同 ganttJumpMode 的存法。
   *  默认 'session' —— 跟这个功能上线前一模一样，老用户切过去打开看不出区别。 */
  ganttViewMode: GanttViewMode
  setGanttViewMode: (mode: GanttViewMode) => void
  /** 双击画布空白弹出的项目列表按什么排。'default' = 添加顺序，
   *  'recent' = 最近点过的排前面。两种都**保留「有状态的排最前」**，
   *  差别只在没有状态的那一批 —— approval 是唯一「不管就永远卡着」的状态，
   *  规格里写着它在任何排序里都排最前，不能因为半天没碰这个项目就把它沉下去。
   *  纯 UI 偏好，存 localStorage，参考 ganttJumpMode 的存法。 */
  projectMenuSort: ProjectMenuSort
  setProjectMenuSort: (mode: ProjectMenuSort) => void
  /** 最近点过的项目 id，最近的在最前。**不进 projects.json** ——
   *  它是「我最近在弄哪个」这种本机偏好，不是项目自身的属性，
   *  为它扩一条主进程 IPC 不划算。用有序数组而不是时间戳：
   *  天然有序、不用比较、也不会因为改系统时间而错乱。 */
  /** 新的 AI 对话会话要不要装审批保护（逐次审批那套 PreToolUse hook）。
   *  **默认关**：装它要往用户项目里写 `.claude/settings.json`，而且每次工具调用都要
   *  停下来等确认——对日常使用是很重的打断。想要的人在设置里开，不再在对话框里问。
   *  关掉这个开关时会顺带把所有已注册项目里装过的审批 hook 一起卸掉（见 SettingsPanel）。 */
  agentApprovalHook: boolean
  setAgentApprovalHook: (on: boolean) => void
  projectMru: string[]
  /** 记一次「用户主动打开/聚焦了这个项目」。
   *  **只在 UI 的点击处调，不要埋进 store action** ——
   *  `setActiveProject` 在 loadProjects 之后会被自动调一次（取 projects[0]），
   *  埋在那里会把「启动」记成「你点过」，第一次打开菜单顺序就是错的。 */
  touchProject: (id: string) => void
  attentionPtys: string[]
  flagAttention: (ptyId: string) => void
  clearAttention: (ptyId: string) => void
  /** 在灵动岛上点过「知道了」的通知 id。
   *
   *  **这不等于处理完了。** 它只让灵动岛别再为这一条冒出来 ——
   *  终端的待处理标记（侧栏红点、抽屉呼吸、标题栏铃铛）照旧留着，
   *  真正消掉要等你去那个终端。
   *
   *  按 notice id 记而不是 ptyId：id 里带着这一轮的耗时，
   *  同一个终端下一轮再完成时 id 就变了，于是会重新提醒——不需要手动解除静音。 */
  silencedNotices: string[]
  silenceNotice: (id: string) => void
  /** 把已经不存在的通知 id 从静音表里摘掉，防止它随使用无限增长 */
  pruneSilenced: (liveIds: string[]) => void
  /** 正在自动跑 agent 任务的终端 ptyId。判据同「任务完成」提醒：Claude Code 干活时
   *  把终端标题设成「<盲文 spinner> 名字」，停下等人时是非 spinner。纯 shell 永不误报。 */
  runningPtys: string[]
  setPtyRunning: (ptyId: string, running: boolean) => void
  /** 每个终端的耗时账本（灵动岛通知卡显示「跑了多久」）。
   *  跟 runningPtys 同源——记账的时机就是 spinner 起落的那一刻，
   *  分到别处去就得再监听一遍同一个信号，两份状态迟早对不上。
   *  不持久化：重启后终端要重开，旧的耗时没有意义。 */
  ptyTiming: Record<
    string,
    { firstAt: number; roundStart?: number; lastRoundMs?: number; lastDoneAt?: number }
  >
  /** 每个终端里跑着哪个 AI CLI（认不出 = null，纯 shell 或别的东西）。
   *  **判据是 controlling terminal 上的进程名**（主进程 pty:agentOf），不是终端标题、
   *  也不是用户敲了什么 —— 标题格式随 CLI 版本变，敲了什么漏掉从控制台启动/alias/npx 那几条。
   *  命令按钮据此决定显不显示、发哪一套命令；分屏没有 Agent 控制台，全靠它。
   *  不持久化：重启后终端要重开，旧值没有意义。 */
  ptyAgent: Record<string, AgentKind | null>
  setPtyAgent: (ptyId: string, kind: AgentKind | null) => void
  /** 停下来等审批的终端：解析屏幕得到的问句与选项（认不出就是 null = 只通知不直通）。
   *  和 attentionPtys 同生共死——那个清了，这里也该清，否则灵动岛会拿着
   *  上一轮的旧选项给用户点。 */
  ptyApproval: Record<string, ApprovalInfo>
  setPtyApproval: (ptyId: string, info: ApprovalInfo | null) => void
  /** 在灵动岛上按下的选项写回 pty 之后，记一下等待复活的时刻。
   *  1.5 秒内 spinner 没重新转起来 = 写回没生效（多半是解析错了行号），
   *  灵动岛据此把卡片降级成「跳回终端处理」。 */
  approvalSentAt: Record<string, number>
  markApprovalSent: (ptyId: string) => void
  /** MCP 调用流水（AI 通过 MCP 操作画板时留痕）：标题栏指示灯据此亮起 + 展开查看做了什么。
   *  只留最近 20 条，不持久化——它是「刚才 AI 动了什么」的即时可见性，不是审计日志。 */
  mcpLog: { id: number; tool: string; detail: string; ok: boolean; at: number }[]
  /** MCP 总开关：关掉后所有工具调用一律拒绝（不用改 Claude 配置就能立刻断开） */
  mcpEnabled: boolean
  setMcpEnabled: (v: boolean) => void
  logMcp: (e: { tool: string; detail: string; ok: boolean }) => void
  clearMcpLog: () => void
  /** Claude Code / Codex 这两个 CLI 装没装。null = 还没探测出结果。
   *  一个都没有时 agent 相关控件整体隐藏——摆一堆点了没反应的按钮比没有更糟。 */
  agentCli: { claude: boolean; codex: boolean } | null
  refreshAgentCli: () => Promise<void>
  /** **右侧**知识库抽屉开着没有。提到 store 是因为画布上别的浮层
   *  （右下角的缩放条与工具条、右上角的待处理气泡）要跟着让位——
   *  那些组件和抽屉没有父子关系，靠 class 传状态最省事（见 canvas.css 的 `.app.wiki-open`）。 */
  wikiDrawerOpen: boolean
  setWikiDrawerOpen: (v: boolean) => void
  /** **左侧**资源抽屉开着没有。同上：左下角的缩略图会被它压住，得跟着往右让。
   *
   *  这两条的左右在 2026-08-13 对调过（资源从右挪到左、知识库从左挪到右），
   *  实际定位以 canvas.css 的 `.canvas-drawer { left: 8px }` /
   *  `.wiki-drawer { right: 8px }` 为准。 */
  resDrawerOpen: boolean
  setResDrawerOpen: (v: boolean) => void
  /** 分屏模式左侧「项目 + 文件树」收起来了没有。
   *
   *  存 localStorage：收起侧栏是为了把宽度让给终端，属于明确的工作方式偏好，
   *  重启又弹回来等于没听见（同 dictBubbleHidden 的理由）。
   *
   *  **收起后留一条 38px 的窄边，不是彻底消失** —— 没有入口的隐藏等于藏起来，
   *  下次想调出来只能靠记快捷键。窄边上有展开钮和当前项目的首字。 */
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  /** 词典悬浮球被右键藏起来了。存 localStorage：藏它是个明确的意愿表达，
   *  重启就冒出来等于没听见。藏起来后标题栏会出现一个恢复按钮。 */
  dictBubbleHidden: boolean
  setDictBubbleHidden: (v: boolean) => void
  /** 辞典面板开着没有。**不持久化** —— 重启后自动弹出一个面板是打扰，
   *  而它是「随手查」的工具，该由用户每次主动叫出来 */
  dictOpen: boolean
  setDictOpen: (v: boolean) => void
  /** 辞典面板上次停在哪。**存 localStorage** ——
   *  用户明确要求「下次出现的位置和上次收回的位置一样」，
   *  只放内存的话切个视图就忘了 */
  dictPos: { x: number; y: number } | null
  setDictPos: (p: { x: number; y: number }) => void
  /** Agent 角色表（~/.eas/roles.json）。启动 app 时拉一次，改完重拉。 */
  roles: AgentRole[]
  loadRoles: () => Promise<void>
  /** 待用户过目的归档计划。agent 提交后挂在这里，界面渲染成审批面板 */
  pendingArchive: { items: ArchiveItem[]; resolve: (approved: ArchiveItem[] | null) => void } | null
  /** MCP 侧调用：提交计划并**等**用户点头。返回 null = 用户取消 */
  requestArchivePlan: (items: ArchiveItem[]) => Promise<ArchiveItem[] | null>
  resolveArchivePlan: (approved: ArchiveItem[] | null) => void
  /** 转录队列。串行跑——CPU 密集，并行只会互相拖慢 */
  ttQueue: { name: string; path: string; state: 'wait' | 'run' | 'done' | 'fail'; done: number; total: number; error?: string }[]
  enqueueTranscribe: (files: { name: string; path: string }[]) => void
  /** 整表写回（编辑器改完调它）。主进程会再 sanitize 一遍，全是坏数据时拒绝写入 */
  saveRoles: (roles: AgentRole[]) => Promise<string | null>
  /** 恢复内置角色（用户自建的保留） */
  resetRoles: () => Promise<void>
}

const SIDEBAR_COLLAPSED_KEY = 'eas.sidebar.collapsed'
const DICT_HIDDEN_KEY = 'eas.dictbubble.hidden'
const DICT_POS_KEY = 'eas.dict.pos'

/** 读上次的位置。坏数据 / 没存过 → null（由组件回落到默认位置）。
 *  **不在这里夹进视口** —— 存的时候窗口可能比现在大，
 *  夹进「当时的」视口没有意义，那件事必须在渲染时按当前窗口做 */
function readDictPos(): { x: number; y: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DICT_POS_KEY) || 'null') as unknown
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (typeof o.x !== 'number' || typeof o.y !== 'number') return null
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return null
    return { x: o.x, y: o.y }
  } catch {
    return null
  }
}
/** MCP 接入开关。存「关」而不是存「开」：默认值是开，只有被明确关掉才需要记住 */
const MCP_OFF_KEY = 'eas.mcp.off'
const GANTT_JUMP_MODE_KEY = 'eas.gantt.jumpmode'
const GANTT_VIEW_MODE_KEY = 'eas.gantt.viewmode'
const AGENT_APPROVAL_HOOK_KEY = 'eas.agentchat.approvalhook'
const PROJECT_MENU_SORT_KEY = 'eas.projectmenu.sort'
const PROJECT_MRU_KEY = 'eas.projectmenu.mru'
/** MRU 只用来排一个菜单，留最近 60 个足够；不设上限的话它会跟着用了几年的
 *  项目数一起长，而且早就删掉的项目 id 会永远赖在 localStorage 里 */
const MRU_MAX = 60

let mcpSeq = 1
let ttRunning = false

/**
 * 串行消费转录队列。
 *
 * 这一步是「预处理」：本机跑、不花 token、**不往 wiki 正文写东西**
 * （逐字稿落在收件箱的隐藏目录里）。按定的时机纪律，这类动作可以自动跑；
 * 真正花钱和动文件的归档必须等人点头。
 */
async function runTranscribeQueue(
  set: (fn: (s: UiSlice) => Partial<UiSlice>) => void,
  get: () => UiSlice
): Promise<void> {
  if (ttRunning) return
  ttRunning = true
  try {
    const { transcribeFile } = await import('../features/wiki/transcribe')
    for (;;) {
      const next = get().ttQueue.find((x) => x.state === 'wait')
      if (!next) break
      const upd = (patch: Partial<(typeof next)>): void =>
        set((s) => ({
          ttQueue: s.ttQueue.map((x) => (x.path === next.path ? { ...x, ...patch } : x))
        }))
      upd({ state: 'run' })
      const r = await transcribeFile(next.path, (p) => upd({ done: p.done, total: p.total }))
      if (r.ok) {
        await window.api.wiki.saveTranscript(next.name, r.text)
        upd({ state: 'done' })
      } else {
        upd({ state: 'fail', error: r.error })
      }
    }
  } finally {
    ttRunning = false
  }
}

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  theme: loadTheme(),
  shortcutOverrides: {},
  pendingConfirm: null,
  fullscreenOverlay: null,
  lastActiveTerminal: null,
  composerAppend: null,
  // set 的对象形式：函数是**值**不是 updater（updater 是 set(fn) 那种写法）
  setComposerAppend: (fn) => set({ composerAppend: fn }),
  composerAddChip: null,
  setComposerAddChip: (fn) => set({ composerAddChip: fn }),
  lastSnapshot: null,
  setLastSnapshot: (v) => set({ lastSnapshot: v }),
  boardLeafByProject: {},
  setBoardLeaf: (projectId, leafId) =>
    set((s) => ({ boardLeafByProject: { ...s.boardLeafByProject, [projectId]: leafId } })),
  boardColumns: [],
  loadBoardColumns: async () => set({ boardColumns: await window.api.board.list() }),
  saveBoardColumns: async (list) => {
    // 先本地改再落盘：拖拽/改名要立刻见效，等 IPC 往返回来会有一帧的滞后感
    set({ boardColumns: list })
    set({ boardColumns: await window.api.board.save(list) })
  },
  addBoardColumn: async () => {
    const id = await window.api.board.newId()
    const cur = get().boardColumns
    await get().saveBoardColumns([...cur, { id, name: '新看板' }])
  },
  renameBoardColumn: async (id, name) => {
    const cur = get().boardColumns
    await get().saveBoardColumns(
      cur.map((c) => (c.id === id ? { ...c, name: name.trim().slice(0, 24) || c.name } : c))
    )
  },
  removeBoardColumn: async (id) => {
    // 这一列上的项目挨个清成未分类，否则它们的 status 指向一个不存在的列，
    // 四列里哪列都不显示 —— 项目就这么「消失」了
    const s2 = get()
    for (const p of s2.projects.filter((x) => x.status === id)) {
      await s2.setProjectStatus(p.id, null)
    }
    await get().saveBoardColumns(get().boardColumns.filter((c) => c.id !== id))
  },
  boardFullscreen: null,
  setBoardFullscreen: (leafId) => set({ boardFullscreen: leafId }),
  // 存过的值才信；本地存储被手改/来自更早版本的脏值一律回落默认，不盲目 cast——
  // 三个候选值之外的任何东西读出来都当成"没设置过"处理。
  ganttJumpMode: (() => {
    const v = localStorage.getItem(GANTT_JUMP_MODE_KEY)
    return v === 'split' || v === 'canvas' || v === 'board' ? v : 'board'
  })(),
  setGanttJumpMode: (mode) => {
    localStorage.setItem(GANTT_JUMP_MODE_KEY, mode)
    set({ ganttJumpMode: mode })
  },
  // 同 ganttJumpMode：存过的值才信，之外的一律回落 'session'
  ganttViewMode: (() => {
    const v = localStorage.getItem(GANTT_VIEW_MODE_KEY)
    return v === 'project' || v === 'milestone' ? v : 'session'
  })(),
  setGanttViewMode: (mode) => {
    localStorage.setItem(GANTT_VIEW_MODE_KEY, mode)
    set({ ganttViewMode: mode })
  },
  // 同 ganttJumpMode：存过的值才信，之外的一律回落 'default'
  projectMenuSort: localStorage.getItem(PROJECT_MENU_SORT_KEY) === 'recent' ? 'recent' : 'default',
  setProjectMenuSort: (mode) => {
    localStorage.setItem(PROJECT_MENU_SORT_KEY, mode)
    set({ projectMenuSort: mode })
  },
  // 存「开」而不是存「关」：默认值是关，只有被明确打开才需要记住
  agentApprovalHook: localStorage.getItem(AGENT_APPROVAL_HOOK_KEY) === '1',
  setAgentApprovalHook: (on) => {
    if (on) localStorage.setItem(AGENT_APPROVAL_HOOK_KEY, '1')
    else localStorage.removeItem(AGENT_APPROVAL_HOOK_KEY)
    set({ agentApprovalHook: on })
  },
  projectMru: (() => {
    // 手改过的 localStorage / 更早版本的脏值都可能不是字符串数组，
    // 解析失败或形状不对一律当「没有记录」，不让它把菜单排崩
    try {
      const v = JSON.parse(localStorage.getItem(PROJECT_MRU_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })(),
  touchProject: (id) => {
    set((s) => {
      // 已经在最前就什么都不做 —— 连点同一个项目不该每次都写一遍 localStorage
      if (s.projectMru[0] === id) return {}
      const next = [id, ...s.projectMru.filter((x) => x !== id)].slice(0, MRU_MAX)
      localStorage.setItem(PROJECT_MRU_KEY, JSON.stringify(next))
      return { projectMru: next }
    })
  },
  attentionPtys: [],
  silencedNotices: [],
  mcpLog: [],
  mcpEnabled: localStorage.getItem(MCP_OFF_KEY) !== '1',
  runningPtys: [],
  ptyTiming: {},
  ptyAgent: {},
  ptyApproval: {},
  approvalSentAt: {},
  agentCli: null,
  roles: [],
  wikiDrawerOpen: false,
  setWikiDrawerOpen: (v) => set({ wikiDrawerOpen: v }),
  resDrawerOpen: false,
  setResDrawerOpen: (v) => set({ resDrawerOpen: v }),
  sidebarCollapsed: localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  setSidebarCollapsed: (v) => {
    if (v) localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
    else localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
    set({ sidebarCollapsed: v })
  },
  dictOpen: false,
  setDictOpen: (v) => set({ dictOpen: v }),
  dictPos: readDictPos(),
  setDictPos: (p) => {
    try {
      localStorage.setItem(DICT_POS_KEY, JSON.stringify(p))
    } catch {
      /* 隐私模式下写不了，位置不记也不该报错 */
    }
    set({ dictPos: p })
  },
  dictBubbleHidden: localStorage.getItem(DICT_HIDDEN_KEY) === '1',
  setDictBubbleHidden: (v) => {
    if (v) localStorage.setItem(DICT_HIDDEN_KEY, '1')
    else localStorage.removeItem(DICT_HIDDEN_KEY)
    set({ dictBubbleHidden: v })
  },
  pendingArchive: null,
  ttQueue: [],

  enqueueTranscribe: (files) => {
    const have = new Set(get().ttQueue.map((x) => x.path))
    const add = files.filter((f) => !have.has(f.path))
    if (!add.length) return
    set((s) => ({
      ttQueue: [...s.ttQueue, ...add.map((f) => ({ ...f, state: 'wait' as const, done: 0, total: 0 }))]
    }))
    void runTranscribeQueue(set, get)
  },

  requestArchivePlan: (items) =>
    new Promise((resolve) => {
      // 同一时刻只允许一份待审计划：第二份进来时先把上一份当作取消，
      // 免得两个面板叠在一起、用户点了哪个都说不清
      const prev = get().pendingArchive
      prev?.resolve(null)
      set({ pendingArchive: { items, resolve } })
    }),

  resolveArchivePlan: (approved) =>
    set((s) => {
      s.pendingArchive?.resolve(approved)
      return { pendingArchive: null }
    }),

  loadRoles: async () => {
    try {
      set({ roles: await window.api.roles.list() })
    } catch {
      set({ roles: [] }) // 读不到就当没有角色，界面回落成「无角色」的裸终端
    }
  },

  saveRoles: async (roles) => {
    const r = await window.api.roles.save(roles)
    if (r.ok && r.roles) {
      set({ roles: r.roles })
      return null
    }
    return r.error ?? '保存失败'
  },

  resetRoles: async () => {
    const r = await window.api.roles.reset()
    if (r.ok && r.roles) set({ roles: r.roles })
  },

  refreshAgentCli: async () => {
    // 节流：现在每次窗口获得焦点都会调它，来回切窗口时别把 skill.status()
    // 打成连发。5 秒够挡住手滑级的重复，又不影响「去装完回来」这种真实场景。
    const now = Date.now()
    if (now - lastAgentCliAt < 5000) return
    lastAgentCliAt = now
    try {
      const s = await window.api.skill.status()
      set({ agentCli: { claude: s.claude.hasCli, codex: s.codex.hasCli } })
    } catch {
      // 探测失败按「有」处理：宁可多显示控件，也别把已经装了 CLI 的用户的功能藏起来
      set({ agentCli: { claude: true, codex: true } })
    }
  },

  setPtyAgent: (ptyId, kind) =>
    set((s) => (s.ptyAgent[ptyId] === kind ? s : { ptyAgent: { ...s.ptyAgent, [ptyId]: kind } })),

  setPtyRunning: (ptyId, running) =>
    set((s) => {
      const has = s.runningPtys.includes(ptyId)
      if (has === running) return s
      // 顺手记账：起跑记开始时间，停下算出这一轮跑了多久。
      // firstAt 只在第一次见到这个终端时写，之后不动——它是「会话累计」的起点。
      const now = Date.now()
      const prev = s.ptyTiming[ptyId]
      const entry = running
        ? {
            firstAt: prev?.firstAt ?? now,
            roundStart: now,
            lastRoundMs: prev?.lastRoundMs,
            lastDoneAt: prev?.lastDoneAt
          }
        : {
            firstAt: prev?.firstAt ?? now,
            roundStart: undefined,
            lastRoundMs: prev?.roundStart ? now - prev.roundStart : prev?.lastRoundMs,
            // 这一轮结束的时刻。通知的排序要用它——
            // 之前拿不到 transcript 时间就退化成 Date.now()，每帧重算，
            // 同一帧内多条通知的时间戳全都相等，排序等于没排。
            lastDoneAt: now
          }
      // 重新跑起来 = 这个终端不再等人了，待处理标记连同审批解析一起清掉。
      // 不管是你在灵动岛上点的、还是自己回终端按的回车，只要它又动起来，
      // 那件「等你处理的事」就结束了——留着标记只会让通知栏挂着一条假的。
      const cleared = running
        ? {
            attentionPtys: s.attentionPtys.filter((p) => p !== ptyId),
            ptyApproval: dropKey(s.ptyApproval, ptyId),
            approvalSentAt: dropKey(s.approvalSentAt, ptyId)
          }
        : null
      return {
        runningPtys: running
          ? [...s.runningPtys, ptyId]
          : s.runningPtys.filter((p) => p !== ptyId),
        ptyTiming: { ...s.ptyTiming, [ptyId]: entry },
        ...cleared
      }
    }),

  setMcpEnabled: (v) => {
    // 存盘：这是个**安全开关**，关掉它是明确的意愿表达，不该重启就悄悄恢复成开。
    // 同步给主进程：/secret-env 走主进程直通，渲染层这份状态它查不到。
    if (v) localStorage.removeItem(MCP_OFF_KEY)
    else localStorage.setItem(MCP_OFF_KEY, '1')
    window.api.mcp.setEnabled(v)
    set({ mcpEnabled: v })
  },
  logMcp: (e) =>
    set((s) => ({
      mcpLog: [{ id: mcpSeq++, ...e, at: Date.now() }, ...s.mcpLog].slice(0, 20)
    })),
  clearMcpLog: () => set({ mcpLog: [] }),

  flagAttention: (ptyId) =>
    set((s) => (s.attentionPtys.includes(ptyId) ? s : { attentionPtys: [...s.attentionPtys, ptyId] })),
  silenceNotice: (id) =>
    set((s) => (s.silencedNotices.includes(id) ? s : { silencedNotices: [...s.silencedNotices, id] })),
  pruneSilenced: (liveIds) =>
    set((s) => {
      const live = new Set(liveIds)
      const next = s.silencedNotices.filter((id) => live.has(id))
      // 长度没变就返回原对象：这个函数每帧都会被调，返回新数组会让订阅者白白重渲染
      return next.length === s.silencedNotices.length ? s : { silencedNotices: next }
    }),
  clearAttention: (ptyId) =>
    set((s) => {
      if (!s.attentionPtys.includes(ptyId)) return s
      // 连带清掉这一轮的审批解析：提醒消了还留着旧选项，下次灵动岛会把
      // 上一轮的按钮画出来，点下去写回的是对不上号的序号。
      return {
        attentionPtys: s.attentionPtys.filter((p) => p !== ptyId),
        ptyApproval: dropKey(s.ptyApproval, ptyId),
        approvalSentAt: dropKey(s.approvalSentAt, ptyId)
      }
    }),

  setPtyApproval: (ptyId, info) =>
    set((s) => {
      if (!info) return { ptyApproval: dropKey(s.ptyApproval, ptyId) }
      return { ptyApproval: { ...s.ptyApproval, [ptyId]: info } }
    }),

  markApprovalSent: (ptyId) =>
    set((s) => ({ approvalSentAt: { ...s.approvalSentAt, [ptyId]: Date.now() } })),

  setFullscreenOverlay: (who) => set({ fullscreenOverlay: who }),

  requestConfirm: (c) => set({ pendingConfirm: c }),
  cancelConfirm: () => set({ pendingConfirm: null }),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  loadShortcutOverrides: (v) => set({ shortcutOverrides: v }),
  setShortcutOverride: (id, keys) => {
    const next = { ...get().shortcutOverrides }
    // 传 null（恢复默认）就把这一条删掉，而不是记一个「等于默认值」的覆盖 ——
    // 那样以后改了默认键，用户这条还压着旧的，而他并不知道自己「改过」。
    if (keys) next[id] = keys
    else delete next[id]
    set({ shortcutOverrides: next })
    void window.api.prefs.set('shortcutOverrides', next)
  }
})
