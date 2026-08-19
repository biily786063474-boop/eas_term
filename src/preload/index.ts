import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type {
  Project,
  DirEntry,
  RecentFile,
  UserTerm,
  DictPending,
  DictSinkStatus,
  PtyCreateOptions,
  TextFileResult,
  ImageFileResult,
  BizoneCheck,
  BizoneProject,
  BizoneMedia,
  InsertResult,
  OpResult,
  PathProbe,
  GitStatus,
  GitDiffResult,
  GitCommit,
  GitCommitFile,
  AiResult,
  SessionIndex,
  SessionExchange,
  SessionLast,
  IslandState,
  IslandAction,
  AgentProbe,
  SkillStatus,
  HookStatus,
  AgentRole,
  SecretMeta,
  SecretReveal,
  SecretSaveInput,
  SecretsStatus,
  WikiStatus,
  WikiQueryResult,
  WikiInboxItem,
  Backlink,
  WikiHit,
  ArchiveItem,
  WikiCommit,
  WikiGraph,
  LintFinding,
  WikiStats,
  RulesStatus,
  Footprint,
  InstallPlan,
  UpdateInfo, ProjectStatus, BoardColumn, GanttTask, GanttClearRange, TodoItem,
  RenameFolderResult, SnapshotRect, SnapshotResult,
  SkillDirEntry, SkillDirAddResult, SkillListResult,
  SkillCopyResult, SkillDisableResult, SkillLibrarySnapshot, SkillCategorizeResult, AgentKind } from '../shared/types'
import { AGENT_CHAT_EVENT_CHANNEL } from '../shared/agentChat.ts'
import type {
  ChatEvent,
  AgentChatStartParams,
  AgentChatStartResult,
  AgentChatSendResult,
  AgentApprovalHookStatus,
  AgentChatEventEnvelope,
  CliInfo
} from '../shared/agentChat.ts'

// PTY 创建后到 xterm 挂载订阅前，shell 的首批输出（提示符等）会经 IPC 到达，
// 这里先缓冲，等 onData 注册时一次性回放，避免丢失。
//
// **必须有上限。** 这个缓冲只在「创建完到 TerminalView 挂载」这几十毫秒里有用，
// 正常情况下几 KB 就到头了。但它的清空只发生在 onData / kill 两处 ——
// 一旦某个 pty 的视图始终没挂上（创建后 leaf 立刻被关、组件抛错被 ErrorBoundary 兜住、
// MCP 建的终端节点还没渲染就被删），这个数组就再没人来取，
// 而主进程那边还在源源不断往这个 channel 推。跑一晚上的 agent 输出全堆在这儿，
// 表现就是「用着用着内存涨到崩」——且没有任何报错线索。
// 超过上限就丢最老的：这几十毫秒的提示符丢了无所谓，内存爆了是事故。
const PENDING_MAX_BYTES = 256 * 1024

const pendingBuffers = new Map<
  string,
  { chunks: string[]; bytes: number; listener: (e: IpcRendererEvent, d: string) => void }
>()

function startBuffering(id: string): void {
  const buf = {
    chunks: [] as string[],
    bytes: 0,
    listener: (_e: IpcRendererEvent, data: string): void => {
      buf.chunks.push(data)
      buf.bytes += data.length
      while (buf.bytes > PENDING_MAX_BYTES && buf.chunks.length > 1) {
        buf.bytes -= buf.chunks.shift()!.length
      }
    }
  }
  ipcRenderer.on(`pty:data:${id}`, buf.listener)
  pendingBuffers.set(id, buf)
}

/** pty 自己退出时也要收摊：以前只在 onData / kill 里清，自然退出的那条路会漏下监听器 */
function stopBuffering(id: string): void {
  const pending = pendingBuffers.get(id)
  if (!pending) return
  ipcRenderer.removeListener(`pty:data:${id}`, pending.listener)
  pendingBuffers.delete(id)
}

// ── agentChat 的事件通道：单一常驻频道 + 模块加载期就挂好的永久监听器 ──────────────
//
// 上面 pty 那套「invoke 一 resolve 就开始缓冲」的范式**不能照搬到这里**，2026-08-17
// 全分支最终评审 C1 实测（隔离 Electron 探针，30 次采样）证实了这一点：
//   - `pty:create` 的主进程 handler 里**没有**同步 `wc.send`，第一批数据要等 pty 真的
//     吐字节，那时 await 早就回来了——范式成立的前提是这个，不是「await 之后就安全」。
//   - `agentChat:start` 的 handler 在 `return` **之前**就同步走完 deliverMessage →
//     restartAndDeliver → handleEvent → wc.send。事件先于 invoke 的 reply 到达渲染进程，
//     此刻按 sessionId 命名的动态频道上一个监听器都没有 → Electron 直接丢弃。
//     探针数字：同步推的一组 30 条只捕获到 1 条；把 send 推迟到 handler 返回之后的
//     对照组 30/30。丢掉的正好是「你选了这次不装，本次会话没有审批保护」那条硬验收
//     notice——用户以为自己受保护，其实没有。
//
// 所以这里不再有「什么时候开始缓冲」这个问题：频道是固定的 AGENT_CHAT_EVENT_CHANNEL，
// 监听器在**模块加载期**（preload 执行的第一时间，远早于任何 invoke）就挂上，按 payload
// 里的 sessionId 路由——有订阅者直接投递，没有就先缓冲，等 onEvent 来取。
// 「订阅之前的事件」结构上不可能丢，不依赖任何时序假设。
//
// 按事件条数而不是字节数设上限：ChatEvent 是结构化对象不是原始字节流。正常情况下
// 缓冲窗口只有毫秒级（start() 返回后的同一个 tick 里就会调 onEvent），远碰不到这个
// 上限；留着只是防"调用方一直不订阅"这种极端情况把内存吃穿，跟 pty 的字节上限同一用途。
const AGENT_CHAT_PENDING_MAX_EVENTS = 1000

/** sessionId → 已注册的订阅回调。用 Set 而不是单个回调：动态频道时代 `ipcRenderer.on`
 *  允许同一个会话挂多个监听器，换成 Map<string, cb> 会让"第二个订阅者静默顶掉第一个"
 *  变成一个没有任何信号的新行为差异。 */
const agentChatListeners = new Map<string, Set<(e: ChatEvent) => void>>()
/** sessionId → 还没人订阅时先攒下的事件。第一个订阅者取走后即删除。 */
const agentChatPendingEvents = new Map<string, ChatEvent[]>()

/** 已经调用过 stop() 的会话 id——只增不删。2026-08-17 全分支最终评审 Minor-1 实测：
 *  `agentChat:stop` 在主进程只是 `sessions.delete(id)` + `proc.kill()`，管道里已经在飞
 *  的 stdout 仍会被 `wireProc` 的 `data` 回调继续翻译、`emitEvent` 只判 `wc.isDestroyed()`
 *  不判会话还在不在表里——于是 stop() 之后仍可能有尾随事件送到这个常驻监听器。这些
 *  sessionId 在下面的监听器里如果按老规矩"没有订阅者就缓冲"，会在 agentChatPendingEvents
 *  里建一条**永远没人来取**的条目（实测：`stop` 后 pending 从 1 涨到 2 且不再清，
 *  其中 `exec.done.output` 是未截断的全量工具输出）——这个 app 是长跑工具，用户全天
 *  开着，关一个 agent 节点漏一点、渲染进程活多久就攒多久。
 *
 *  这个集合本身只增不删，是刻意的取舍：每项只有一个 sessionId 字符串（sessionId 由
 *  session.ts 用 `ac-${nextId++}` 递增生成，进程内不会重复，见 src/main/agentChat/
 *  session.ts），代价是几十字节；换来的是防住一整条 ChatEvent（可能带着未截断的工具
 *  输出）永久滞留在 agentChatPendingEvents 里。用一个有界的小代价换一个无界的大代价——
 *  跟本仓库「长跑资源」那份立档同一个判断依据："不是泄漏是固定成本×规模"，这里的规模是
 *  "这个渲染进程活着的这段时间里，用户关过多少个 agent 会话"，比 PTY scrollback 那个
 *  量级小得多，不值得为了摊平这几十字节再引入一个定时器去清它、平添一个新的时序假设。
 *
 *  **绝不能反过来做成白名单**（只有 start() resolve 之后才允许缓冲）——那样会把 C1
 *  刚修好的窗口重新打开：最早那批事件正是在 start() 的 promise resolve 之前就同步
 *  到达的，此时还不知道 sessionId 是"活的"，白名单里不会有它。 */
const stoppedAgentChatSessionIds = new Set<string>()

ipcRenderer.on(AGENT_CHAT_EVENT_CHANNEL, (_e: IpcRendererEvent, envelope: AgentChatEventEnvelope) => {
  if (!envelope || typeof envelope.sessionId !== 'string') return
  const subs = agentChatListeners.get(envelope.sessionId)
  if (subs && subs.size > 0) {
    for (const cb of subs) cb(envelope.event)
    return
  }
  // 会话已经 stop() 过：不会再有人订阅，尾随事件直接丢弃，不再建缓冲条目
  // （见上面 stoppedAgentChatSessionIds 的注释）。
  if (stoppedAgentChatSessionIds.has(envelope.sessionId)) return
  let buf = agentChatPendingEvents.get(envelope.sessionId)
  if (!buf) {
    buf = []
    agentChatPendingEvents.set(envelope.sessionId, buf)
  }
  buf.push(envelope.event)
  if (buf.length > AGENT_CHAT_PENDING_MAX_EVENTS) buf.shift()
})

/** 会话被主动关闭时收摊——订阅表与缓冲区都留着也没人取了，跟 pty 的 stopBuffering 同一处理。
 *  额外记一笔"这个会话已经死了"（见 stoppedAgentChatSessionIds），挡住关闭之后的尾随事件
 *  重新建一条没人取的缓冲。 */
function stopAgentChatBuffering(sessionId: string): void {
  agentChatListeners.delete(sessionId)
  agentChatPendingEvents.delete(sessionId)
  stoppedAgentChatSessionIds.add(sessionId)
}

/** 从 additionalArguments 里取主进程塞进来的构建信息（同步，界面首帧就能用） */
function argOf(name: string): string {
  const p = `--${name}=`
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length) ?? ''
}

/** 跟 main/prefs.ts 的 Prefs 手动保持同步——那边字段变了这里也要跟着改。
 *  没有直接 import type { Prefs }：preload 和 main 各自的类型入口，历史上这里
 *  就是手抄一份最小形状，这次新增字段沿用同一约定，不引入新的跨进程类型耦合。 */
interface PrefsSnapshot {
  autoUpdateCheck: boolean
  telemetry: boolean
  /** 快照后怎么处理标记。未设置 = 每次都问 */
  clearShapesAfterSnapshot?: 'keep' | 'clear'
  recentDocsOnly: boolean
}

const api = {
  platform: process.platform,
  /** 这个包是哪一版、是不是打包过的。界面底部的水印用它 —— 装了三个版本还开着旧包
   *  这种事真发生过，排查时先怀疑代码、最后才发现开的不是新包，白花很多时间。 */
  build: { version: argOf('eas-version'), packaged: argOf('eas-packaged') === '1' },
  // 从访达拖进来的 File 取真实路径。
  // Electron 32 起 File.path 被移除了，直接读会拿到 undefined 且**不报错**——
  // 结果是一堆空路径还以为代码写对了。必须走 webUtils。
  pathForFile: (f: File): string => {
    try {
      return webUtils.getPathForFile(f)
    } catch {
      return ''
    }
  },
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
    addViaDialog: (): Promise<Project[]> => ipcRenderer.invoke('projects:addViaDialog'),
    remove: (id: string): Promise<Project[]> => ipcRenderer.invoke('projects:remove', id),
    /** 只改侧栏显示名，不动磁盘目录名 */
    rename: (id: string, name: string): Promise<Project[]> =>
      ipcRenderer.invoke('projects:rename', id, name),
    /** 真改盘上的目录名。和上面的 rename（只改显示名）是两件事 */
    renameFolder: (id: string, newName: string): Promise<RenameFolderResult> =>
      ipcRenderer.invoke('projects:renameFolder', id, newName),
    /** 打/清状态标签（null = 回到未分类）。看板、画布、分屏三处共用 */
    setStatus: (id: string, status: ProjectStatus | null): Promise<Project[]> =>
      ipcRenderer.invoke('projects:setStatus', id, status)
  },
  board: {
    /** 看板列定义（叫什么、什么颜色、排第几）。全局，和项目分开存 */
    list: (): Promise<BoardColumn[]> => ipcRenderer.invoke('board:list'),
    /** 整表落盘：增删改序都走它，「顺序」这种跨条目的改动没法拆成单条 */
    save: (list: BoardColumn[]): Promise<BoardColumn[]> => ipcRenderer.invoke('board:save', list),
    newId: (): Promise<string> => ipcRenderer.invoke('board:newId')
  },
  todos: {
    // 终端输入框右键插入的待办清单。key 由渲染层决定（画布节点 id 优先，
    // 见 features/terminal/useTerminalTodos.ts），这里只管按 key 存取。
    /** null = 这个 key 从没插过清单；[] = 插了但一条没加。两者要分清楚 */
    get: (key: string): Promise<TodoItem[] | null> => ipcRenderer.invoke('todos:get', key),
    /** 整份清单落盘：增删改都走它 */
    save: (key: string, items: TodoItem[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('todos:save', key, items),
    /** 删掉整份清单（不是清空条目） */
    remove: (key: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('todos:remove', key)
  },
  gantt: {
    list: (): Promise<GanttTask[]> => ipcRenderer.invoke('gantt:list'),
    push: (t: GanttTask): Promise<void> => ipcRenderer.invoke('gantt:push', t),
    finish: (id: string, endAt: number): Promise<void> =>
      ipcRenderer.invoke('gantt:finish', id, endAt),
    follow: (id: string, text: string): Promise<void> =>
      ipcRenderer.invoke('gantt:follow', id, text),
    /** 删单条记录。返回值是删完之后的最新列表（已经打好 aborted 标记），
     *  渲染层直接拿它 setState，不用等下一轮 20 秒轮询才反映到图上 */
    remove: (id: string): Promise<GanttTask[]> => ipcRenderer.invoke('gantt:remove', id),
    /** 批量清理：不传 range = 清空全部；传了就只清这段范围内的。同样直接回最新列表 */
    clear: (range?: GanttClearRange): Promise<GanttTask[]> =>
      ipcRenderer.invoke('gantt:clear', range)
  },
  canvas: {
    // 画布场景持久化：整场景存 / 读（结构由渲染层定义，此处按 unknown 透传）
    load: (): Promise<unknown> => ipcRenderer.invoke('canvas:load'),
    save: (scene: unknown): Promise<void> => ipcRenderer.invoke('canvas:save', scene),
    // 同步落盘：退出/刷新前(beforeunload)调,阻塞到写完再放行,防「改完就退」丢失
    saveSync: (scene: unknown): void => {
      ipcRenderer.sendSync('canvas:save-sync', scene)
    },
    /** 截画板区域存进项目。rect 是相对窗口左上角的 CSS 像素 */
    snapshot: (projectPath: string, rect: SnapshotRect): Promise<SnapshotResult> =>
      ipcRenderer.invoke('canvas:snapshot', projectPath, rect)
  },
  agent: {
    // 开终端时探测：从 `claude --help` 真实解析 模型别名 / effort 档位（不硬编码）
    probe: (): Promise<AgentProbe> => ipcRenderer.invoke('agent:probe'),
    // Codex 起完之后按 cwd 捞它的 session id（Codex 没有指定会话 id 的启动参数）
    captureCodexSession: (cwd: string, sinceMs: number): Promise<{ id: string | null }> =>
      ipcRenderer.invoke('codex:captureSession', cwd, sinceMs),
    // 用户配了哪些 Codex MCP server（禁用清单要按它过滤：名字不存在 codex 会拒绝启动）
    codexServers: (): Promise<string[]> => ipcRenderer.invoke('agent:codexServers')
  },
  browser: {
    // 迷你浏览器里链接开新窗被拦成同 view 导航时,主进程通知渲染层聚焦该浏览器节点(传 guest webContents id)
    onFocus: (cb: (guestId: number) => void): (() => void) => {
      const h = (_e: unknown, guestId: number): void => cb(guestId)
      ipcRenderer.on('browser:focus', h)
      return () => ipcRenderer.removeListener('browser:focus', h)
    }
  },
  stt: {
    // 离线语音转文字(sherpa-onnx 流式)。渲染进程采麦送 16kHz Int16 PCM,主进程回传 partial/final。
    start: (): Promise<{ ok: boolean; error?: string; needDownload?: boolean }> =>
      ipcRenderer.invoke('stt:start'),
    sendAudio: (buf: ArrayBuffer): void => ipcRenderer.send('stt:audio', buf),
    stop: (): Promise<{ text: string }> => ipcRenderer.invoke('stt:stop'),
    /** 识别一段 16kHz 单声道 Float32 音频（文件转录用） */
    transcribeChunk: (buf: ArrayBuffer): Promise<string> =>
      ipcRenderer.invoke('stt:transcribeChunk', buf),
    onPartial: (cb: (text: string) => void): (() => void) => {
      const h = (_e: unknown, t: string): void => cb(t)
      ipcRenderer.on('stt:partial', h)
      return () => ipcRenderer.removeListener('stt:partial', h)
    },
    onFinal: (cb: (text: string) => void): (() => void) => {
      const h = (_e: unknown, t: string): void => cb(t)
      ipcRenderer.on('stt:final', h)
      return () => ipcRenderer.removeListener('stt:final', h)
    },
    // 模型「首次使用下载」：查状态 / 触发下载 / 订阅进度
    modelStatus: (): Promise<{ ready: boolean; missing: string[] }> =>
      ipcRenderer.invoke('stt:modelStatus'),
    downloadModels: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('stt:downloadModels'),
    onDownloadProgress: (
      cb: (p: { phase: string; received?: number; error?: string }) => void
    ): (() => void) => {
      const h = (_e: unknown, p: { phase: string; received?: number; error?: string }): void => cb(p)
      ipcRenderer.on('stt:downloadProgress', h)
      return () => ipcRenderer.removeListener('stt:downloadProgress', h)
    }
  },
  mcp: {
    // MCP 桥：主进程把 AI 的工具调用转过来，渲染层执行 store action 后回传结果
    onInvoke: (
      cb: (p: { id: number; tool: string; args: unknown; ctx: { ptyId?: string; project?: string } }) => void
    ): (() => void) => {
      const h = (_e: unknown, p: { id: number; tool: string; args: unknown; ctx: { ptyId?: string; project?: string } }): void => cb(p)
      ipcRenderer.on('mcp:invoke', h)
      return () => ipcRenderer.removeListener('mcp:invoke', h)
    },
    reply: (r: { id: number; ok: boolean; data?: unknown; error?: string }): void =>
      ipcRenderer.send('mcp:result', r),
    /** 移除写进用户全局配置的 MCP 条目（画板工具随之不可用，属于用户的选择） */
    removeConfig: (): Promise<void> => ipcRenderer.invoke('mcp:removeConfig'),
    /** 把「MCP 接入」开关同步给主进程 —— /secret-env 走主进程直通，查不到渲染层那份状态 */
    setEnabled: (v: boolean): void => ipcRenderer.send('mcp:setEnabled', v)
  },
  skill: {
    // 配套技能包（告诉 AI 什么时候该用画板工具）：查状态 / 关掉启动提醒。
    // 安装走 rules.sync —— 这里原来还有个 install，写法和 rules.sync 不一致，已删
    status: (): Promise<SkillStatus> => ipcRenderer.invoke('skill:status'),
    mute: (muted: boolean): Promise<SkillStatus> => ipcRenderer.invoke('skill:mute', muted),
    // 一个 CLI 都没装时，按这台机器的实际情况给出该跑哪条安装命令（只给命令，不代执行）
    installPlan: (): Promise<InstallPlan> => ipcRenderer.invoke('agent:installPlan')
  },
  hook: {
    // 「提交即复盘」钩子：查状态 / 装 / 卸。这是侵入性最高的一项，必须能一键卸干净
    status: (): Promise<HookStatus> => ipcRenderer.invoke('hook:status'),
    install: (
      targets: (AgentKind)[]
    ): Promise<{ ok: boolean; error?: string; done?: string[]; status?: HookStatus }> =>
      ipcRenderer.invoke('hook:install', targets),
    uninstall: (
      targets: (AgentKind)[]
    ): Promise<{ ok: boolean; error?: string; status?: HookStatus }> =>
      ipcRenderer.invoke('hook:uninstall', targets)
  },
  dict: {
    // 自动补全词条：默认关，开启会花 token（模型要写解释和示意图）
    sinkStatus: (): Promise<DictSinkStatus> => ipcRenderer.invoke('dict:sinkStatus'),
    setSink: (on: boolean): Promise<DictSinkStatus> => ipcRenderer.invoke('dict:setSink', on),
    pending: (): Promise<DictPending[]> => ipcRenderer.invoke('dict:pending'),
    add: (
      terms: unknown[]
    ): Promise<{ ok: boolean; added: string[]; rejected: { name: string; why: string }[] }> =>
      ipcRenderer.invoke('dict:add', terms),
    remove: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('dict:remove', id)
  },
  wiki: {
    // 个人知识库（用户自选位置的 markdown 文件夹）
    status: (): Promise<WikiStatus> => ipcRenderer.invoke('wiki:status'),
    // 给 wiki_query 这个 MCP 工具用：知识库内容离开本机进程边界的唯一通道
    query: (): Promise<WikiQueryResult> => ipcRenderer.invoke('wiki:query'),
    suggestPath: (): Promise<string> => ipcRenderer.invoke('wiki:suggestPath'),
    pickPath: (): Promise<string | null> => ipcRenderer.invoke('wiki:pickPath'),
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke('wiki:pickFiles'),
    init: (
      root: string
    ): Promise<{ ok: boolean; error?: string; created?: string[]; skipped?: string[]; status?: WikiStatus }> =>
      ipcRenderer.invoke('wiki:init', root),
    forget: (): Promise<WikiStatus> => ipcRenderer.invoke('wiki:forget'),
    /** 在访达/资源管理器里打开（sub 可给子目录名，如收件箱） */
    reveal: (sub?: string): Promise<void> => ipcRenderer.invoke('wiki:reveal', sub),
    inbox: (): Promise<WikiInboxItem[]> => ipcRenderer.invoke('wiki:inbox'),
    /** 往收件箱放文件。默认复制不移动——移动会让用户原来的位置文件消失 */
    addToInbox: (
      files: string[],
      move?: boolean
    ): Promise<{
      ok: boolean
      error?: string
      done?: string[]
      failed?: { file: string; error: string }[]
      /** 收件箱在盘上的实际目录名（新库 00-inbox / 老库 00-收件箱）。拼完整路径用它，别写死 */
      inboxDir?: string
      status?: WikiStatus
    }> => ipcRenderer.invoke('wiki:addToInbox', files, move),
    backlinks: (target: string): Promise<Backlink[]> => ipcRenderer.invoke('wiki:backlinks', target),
    search: (q: string, limit?: number): Promise<WikiHit[]> =>
      ipcRenderer.invoke('wiki:search', q, limit),
    /** 换位置：只改指向，不搬文件 */
    setPath: (root: string): Promise<{ ok: boolean; error?: string; status?: WikiStatus }> =>
      ipcRenderer.invoke('wiki:setPath', root),
    // ── 归档的安全底座：git 快照 / 提交 / 回滚 ──
    gitInit: (): Promise<{ ok: boolean; error?: string; sha?: string | null; status?: WikiStatus }> =>
      ipcRenderer.invoke('wiki:gitInit'),
    snapshot: (label: string): Promise<{ ok: boolean; error?: string; sha?: string }> =>
      ipcRenderer.invoke('wiki:snapshot', label),
    commit: (message: string): Promise<{ ok: boolean; error?: string; sha?: string }> =>
      ipcRenderer.invoke('wiki:commit', message),
    history: (limit?: number): Promise<WikiCommit[]> => ipcRenderer.invoke('wiki:history', limit),
    rollback: (sha: string): Promise<{ ok: boolean; error?: string; status?: WikiStatus }> =>
      ipcRenderer.invoke('wiki:rollback', sha),
    /** 只搬文件到 素材/<年月>/，笔记由 agent 写 */
    archive: (
      items: ArchiveItem[]
    ): Promise<{
      ok: boolean
      error?: string
      moved?: { from: string; to: string }[]
      failed?: { name: string; error: string }[]
      status?: WikiStatus
    }> => ipcRenderer.invoke('wiki:archive', items),
    /** 归档落点的预检，不搬文件。`wiki_archive_plan` 用它在阻塞用户确认之前
     *  就知道有没有地方能接归档的文件——没有的话直接报错，别让用户白点一遍确认。 */
    archiveDirCheck: (): Promise<{ ok: boolean; name?: string; error?: string }> =>
      ipcRenderer.invoke('wiki:archiveDirCheck'),
    /** 逐字稿存 素材/<年月>/逐字稿/ —— 不进 wiki 正文，那是中间产物不是知识 */
    saveTranscript: (
      mediaName: string,
      text: string
    ): Promise<{ ok: boolean; error?: string; path?: string; rel?: string }> =>
      ipcRenderer.invoke('wiki:saveTranscript', mediaName, text),
    transcript: (mediaName: string): Promise<string | null> =>
      ipcRenderer.invoke('wiki:transcript', mediaName),
    graph: (): Promise<WikiGraph> => ipcRenderer.invoke('wiki:graph'),
    /** 结构体检（免费瞬时）；语义那半边是 agent 的活 */
    lint: (): Promise<LintFinding[]> => ipcRenderer.invoke('wiki:lint'),
    /** 往 log.md 追加一条：`## [日期] 动作 | 标题` */
    log: (action: 'ingest' | 'query' | 'lint', title: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('wiki:log', action, title),
    stats: (): Promise<WikiStats> => ipcRenderer.invoke('wiki:stats')
  },
  // Skill 管理面板。命名故意跟上面 `skill`（Eas-Term 自己那个「配套技能包」的安装状态）
  // 分开——两个是完全不同的概念，撞名字会把人绕晕。
  //
  // 大部分是只读；三个写口子各有各的边界，见 main/skillLibrary/index.ts 文件头：
  //   copySkill / writeFile —— 真的写用户的 skill 目录，边界是「已登记的 skill 目录
  //     + 项目的 .claude/skills」，比 fsGuard 更窄，不走也不改 fsGuard
  //   addDir / removeDir / setDisabled / setCategories —— 只写 app 自己的
  //     <userData>/skills.json，一个字节都不碰用户的 skill 文件
  skillLibrary: {
    listDirs: (): Promise<SkillDirEntry[]> => ipcRenderer.invoke('skillLibrary:listDirs'),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke('skillLibrary:pickDir'),
    addDir: (path: string, label?: string): Promise<SkillDirAddResult> =>
      ipcRenderer.invoke('skillLibrary:addDir', path, label),
    removeDir: (id: string): Promise<SkillDirEntry[]> => ipcRenderer.invoke('skillLibrary:removeDir', id),
    list: (dirPath: string): Promise<SkillListResult> => ipcRenderer.invoke('skillLibrary:list', dirPath),
    /** 把一个 skill 整个目录复制进另一个 skill 目录。重名一律拒绝（不覆盖、不改名） */
    copySkill: (srcPath: string, destDirPath: string): Promise<SkillCopyResult> =>
      ipcRenderer.invoke('skillLibrary:copySkill', srcPath, destDirPath),
    /** 临时禁用 / 恢复。只写清单，不动硬盘上的文件；CLI 那边不受影响 */
    setDisabled: (skillPath: string, disabled: boolean): Promise<SkillDisableResult> =>
      ipcRenderer.invoke('skillLibrary:setDisabled', skillPath, disabled),
    /** 保存一个 skill 里已存在的文件（画布上编辑那条路）。fs.writeTextFile 过 fsGuard，
     *  够不到全局 skill 目录，所以这条口子单独存在 */
    writeFile: (filePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('skillLibrary:writeFile', filePath, content),
    /** 给 agent 的分类口子用：一次看全部目录（含项目 skill） */
    listAll: (): Promise<SkillLibrarySnapshot> => ipcRenderer.invoke('skillLibrary:listAll'),
    // 面板里手动管分类。跟 setCategories（AI 那条）分开：手动的会**锁住**那个 skill，
    // AI 之后不许再改它。分类只是本软件视图里的标记，不动硬盘上的 skill 文件。
    addCategoryName: (name: string): Promise<SkillCategorizeResult> =>
      ipcRenderer.invoke('skillLibrary:addCategoryName', name),
    removeCategoryName: (name: string): Promise<SkillCategorizeResult> =>
      ipcRenderer.invoke('skillLibrary:removeCategoryName', name),
    /** category 传 null = 拿回未分类并解锁（交还给 AI 管） */
    assignCategory: (skillPath: string, category: string | null): Promise<SkillCategorizeResult> =>
      ipcRenderer.invoke('skillLibrary:assignCategory', skillPath, category),
    /** 给 agent 的分类口子用：写回一批分类，任何一条不合格就整批拒绝 */
    setCategories: (
      assignments: { skill: string; category: string }[]
    ): Promise<SkillCategorizeResult> => ipcRenderer.invoke('skillLibrary:setCategories', assignments)
  },
  rules: {
    // 规则托管：查状态 / 重新同步（知识库初始化、改位置、升级后都该同步一次）
    status: (): Promise<RulesStatus> => ipcRenderer.invoke('rules:status'),
    sync: (): Promise<{ ok: boolean; codexChars: number; status: RulesStatus }> =>
      ipcRenderer.invoke('rules:sync'),
    remove: (): Promise<RulesStatus> => ipcRenderer.invoke('rules:remove')
  },
  footprint: {
    // 一处总账：这个软件在用户机器上写过的全部位置（隐私策略以此为准）
    list: (): Promise<Footprint[]> => ipcRenderer.invoke('footprint:list')
  },
  roles: {
    // Agent 角色（~/.eas/roles.json）：列 / 存 / 恢复内置
    list: (): Promise<AgentRole[]> => ipcRenderer.invoke('roles:list'),
    save: (roles: AgentRole[]): Promise<{ ok: boolean; error?: string; roles?: AgentRole[] }> =>
      ipcRenderer.invoke('roles:save', roles),
    reset: (): Promise<{ ok: boolean; error?: string; roles?: AgentRole[] }> =>
      ipcRenderer.invoke('roles:reset'),
    // 角色契约落成文件，供 claude --append-system-prompt-file 引用
    contractFile: (roleId: string): Promise<string | null> =>
      ipcRenderer.invoke('roles:contractFile', roleId)
  },
  statusline: {
    status: (): Promise<{ installed: boolean; wrapped: string | null }> =>
      ipcRenderer.invoke('statusline:status'),
    install: (): Promise<{ ok: boolean; changed: boolean; reason: string }> =>
      ipcRenderer.invoke('statusline:install'),
    uninstall: (): Promise<{ ok: boolean; changed: boolean; reason: string }> =>
      ipcRenderer.invoke('statusline:uninstall'),
    /** 真实额度与上下文占用（由 statusline 转发脚本回传，见 resources/agent-hooks/eas-statusline.mjs）*/
    onData: (h: (d: unknown) => void): (() => void) => {
      const fn = (_e: unknown, d: unknown): void => h(d)
      ipcRenderer.on('statusline:data', fn)
      return () => ipcRenderer.removeListener('statusline:data', fn)
    }
  },
  secrets: {
    // 密钥柜（<userData>/secrets.json，safeStorage 加密）。
    // **注意 list 永远不含值** —— 值只能经 reveal 单独取一次，
    // 或者由主进程在 pty:create 时直接注入 env（那条路根本不经过这里）。
    status: (): Promise<SecretsStatus> => ipcRenderer.invoke('secrets:status'),
    setup: (code: string): Promise<{ ok: boolean; error?: string; status: SecretsStatus }> =>
      ipcRenderer.invoke('secrets:setup', code),
    unlock: (code: string): Promise<{ ok: boolean; error?: string; status: SecretsStatus }> =>
      ipcRenderer.invoke('secrets:unlock', code),
    /** 忘了码：换一个新的，密钥一条不动（六位码本来就不是加密边界，详见主进程注释） */
    resetCode: (code: string): Promise<{ ok: boolean; error?: string; status: SecretsStatus }> =>
      ipcRenderer.invoke('secrets:resetCode', code),
    lock: (): Promise<SecretsStatus> => ipcRenderer.invoke('secrets:lock'),
    list: (): Promise<SecretMeta[]> => ipcRenderer.invoke('secrets:list'),
    /** 查这些变量在不在（柜里 / 这个终端里）。**只回布尔，不回值**，也不要求解锁 */
    has: (
      names: string[],
      ptyId?: string
    ): Promise<{
      vars: { varName: string; inVault: boolean; readable: boolean; inThisTerminal: boolean }[]
      groups: string[]
      locked: boolean
    }> => ipcRenderer.invoke('secrets:has', names, ptyId),
    /** 一条 = 一组变量（AK/SK 这类成对凭证）。某行 value 留空 = 不动那个变量已存的值 */
    save: (input: SecretSaveInput): Promise<{ ok: boolean; error?: string; status: SecretsStatus }> =>
      ipcRenderer.invoke('secrets:save', input),
    remove: (id: string): Promise<{ ok: boolean; error?: string; status: SecretsStatus }> =>
      ipcRenderer.invoke('secrets:remove', id),
    /** 闲置到期自动上锁时主进程会推一下 —— 不订阅的话标题栏那把钥匙会一直显示「已解锁」 */
    onLocked: (cb: () => void): (() => void) => {
      const h = (): void => cb()
      ipcRenderer.on('secrets:locked', h)
      return () => ipcRenderer.removeListener('secrets:locked', h)
    },
    /** 用户当场把这一组授权给某个终端（request_secret 存完调）—— 没这步它取不到刚填的密钥 */
    grantToPty: (ptyId: string | undefined, group: string): Promise<void> =>
      ipcRenderer.invoke('secrets:grantToPty', ptyId, group),
    /** 选一个 .env 文件并解析。**只回变量名不回值** —— 值扣在主进程等确认 */
    pickEnvFile: (
      testFile?: string
    ): Promise<{ ok: boolean; file?: string; varNames?: string[]; error?: string }> =>
      ipcRenderer.invoke('secrets:pickEnvFile', testFile),
    /** 把上一步选中的变量存成一条。值从主进程暂存取，一步都不进渲染层 */
    commitImport: (input: {
      name: string
      varNames: string[]
      autoInject?: boolean
    }): Promise<{ ok: boolean; error?: string; status: SecretsStatus }> =>
      ipcRenderer.invoke('secrets:commitImport', input),
    /** 上传一个密钥文件（SSH 私钥 / .p8 / .pem）。整个文件就是密钥，用时解成临时文件给路径 */
    pickKeyFile: (
      testFile?: string
    ): Promise<{ ok: boolean; file?: string; name?: string; bytes?: number; error?: string }> =>
      ipcRenderer.invoke('secrets:pickKeyFile', testFile),
    commitKeyFile: (input: {
      groupName: string
      varName: string
    }): Promise<{ ok: boolean; error?: string; status: SecretsStatus }> =>
      ipcRenderer.invoke('secrets:commitKeyFile', input),
    /** 查 shell 配置里有没有同名变量在覆盖注入值（rc 在 PTY 启动后执行，会盖掉我们的） */
    rcConflicts: (names: string[]): Promise<{ varName: string; file: string }[]> =>
      ipcRenderer.invoke('secrets:rcConflicts', names),
    /** 这个终端启动时带了哪些变量（终端角标用）。**只有名字** */
    injectedIn: (ptyId: string): Promise<string[]> =>
      ipcRenderer.invoke('secrets:injectedIn', ptyId),
    /** 密钥使用流水。**只有名字和时间，没有值** */
    audit: (): Promise<{ at: number; ptyId?: string; source: string; names: string[] }[]> =>
      ipcRenderer.invoke('secrets:audit'),
    /** 唯一能把值交到渲染层的通道，给「查看 / 复制」用。不传 varName = 整组 */
    reveal: (id: string, varName?: string): Promise<SecretReveal> =>
      ipcRenderer.invoke('secrets:reveal', id, varName)
  },
  design: {
    // 设计模块导出产物落盘到 <项目>/demo/（渲染层传导出 Blob 的 ArrayBuffer）
    exportToDemo: (
      projectPath: string,
      filename: string,
      data: ArrayBuffer
    ): Promise<{ ok: boolean; error?: string; path?: string }> =>
      ipcRenderer.invoke('design:exportToDemo', projectPath, filename, data),
    revealDemo: (filePath: string): Promise<void> => ipcRenderer.invoke('design:revealDemo', filePath)
  },
  fs: {
    readDir: (dirPath: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dirPath),
    recentFiles: (rootPath: string, limit?: number, docsOnly?: boolean): Promise<RecentFile[]> =>
      ipcRenderer.invoke('fs:recentFiles', rootPath, limit, docsOnly),
    // 用户自建词条（~/.eas/dict-user.json）。词典自己的读写在下面的 dict 里，
    // 这个别名保留是因为词典组件一直这么调，改名没有收益
    userTerms: (): Promise<UserTerm[]> => ipcRenderer.invoke('dict:userTerms'),
    readTextFile: (filePath: string): Promise<TextFileResult> =>
      ipcRenderer.invoke('fs:readTextFile', filePath),
    writeTextFile: (filePath: string, content: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:writeTextFile', filePath, content),
    /** 原始字节（给 WebAudio 解码音频用） */
    readBinary: (filePath: string): Promise<{ ok: boolean; data: ArrayBuffer; error?: string }> =>
      ipcRenderer.invoke('fs:readBinary', filePath),
    readImageFile: (filePath: string): Promise<ImageFileResult> =>
      ipcRenderer.invoke('fs:readImageFile', filePath),
    openPath: (target: string): Promise<string> => ipcRenderer.invoke('fs:openPath', target),
    showInFolder: (target: string): Promise<void> => ipcRenderer.invoke('fs:showInFolder', target),
    rename: (oldPath: string, newName: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:rename', oldPath, newName),
    trash: (target: string): Promise<OpResult> => ipcRenderer.invoke('fs:trash', target),
    // 以下四个都只在「项目根 / 知识库根之内」生效，见 main/fsGuard.ts
    mkdir: (parentDir: string, name: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:mkdir', parentDir, name),
    createFile: (parentDir: string, name: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:createFile', parentDir, name),
    move: (src: string, destDir: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:move', src, destDir),
    copy: (src: string, destDir: string): Promise<OpResult> =>
      ipcRenderer.invoke('fs:copy', src, destDir),
    probePaths: (inputs: string[], baseCwd: string): Promise<(PathProbe | null)[]> =>
      ipcRenderer.invoke('fs:probePaths', inputs, baseCwd)
  },
  git: {
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, relPath: string, mode: 'worktree' | 'staged'): Promise<GitDiffResult> =>
      ipcRenderer.invoke('git:diff', cwd, relPath, mode),
    stage: (cwd: string, paths: string[]): Promise<OpResult> =>
      ipcRenderer.invoke('git:stage', cwd, paths),
    unstage: (cwd: string, paths: string[]): Promise<OpResult> =>
      ipcRenderer.invoke('git:unstage', cwd, paths),
    discard: (cwd: string, paths: string[], untracked: boolean): Promise<OpResult> =>
      ipcRenderer.invoke('git:discard', cwd, paths, untracked),
    commit: (cwd: string, message: string): Promise<OpResult> =>
      ipcRenderer.invoke('git:commit', cwd, message),
    log: (cwd: string, limit: number): Promise<GitCommit[]> =>
      ipcRenderer.invoke('git:log', cwd, limit),
    commitFiles: (cwd: string, hash: string): Promise<GitCommitFile[]> =>
      ipcRenderer.invoke('git:commitFiles', cwd, hash),
    commitDiff: (cwd: string, hash: string, relPath: string): Promise<GitDiffResult> =>
      ipcRenderer.invoke('git:commitDiff', cwd, hash, relPath),
    describe: (cwd: string, hash: string): Promise<AiResult> =>
      ipcRenderer.invoke('git:describe', cwd, hash),
    resetHard: (cwd: string, hash: string): Promise<OpResult> =>
      ipcRenderer.invoke('git:resetHard', cwd, hash)
  },
  session: {
    index: (cwd: string): Promise<SessionIndex> => ipcRenderer.invoke('session:index', cwd),
    exchange: (cwd: string, uuid: string, sessionId?: string): Promise<SessionExchange> =>
      ipcRenderer.invoke('session:exchange', cwd, uuid, sessionId),
    /** 最后一轮问答（灵动岛通知卡）。传 sessionId 才能锁定终端自己的那份会话 */
    last: (cwd: string, sessionId?: string): Promise<SessionLast> =>
      ipcRenderer.invoke('session:last', cwd, sessionId)
  },
  /** 灵动岛：主窗口侧只需要「推状态」和「收动作」两件事 */
  island: {
    sync: (state: IslandState): void => {
      ipcRenderer.send('island:sync', state)
    },
    /** 审批框没认全时上报当时的屏幕（dev 下打到主进程日志，供改解析规则） */
    reportParse: (reason: string, sample: string[]): void => {
      ipcRenderer.send('island:parselog', reason, sample)
    },
    onAction: (cb: (a: IslandAction) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, a: IslandAction): void => cb(a)
      ipcRenderer.on('island:action', listener)
      return () => ipcRenderer.removeListener('island:action', listener)
    }
  },
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
    hasImage: (): Promise<boolean> => ipcRenderer.invoke('clipboard:hasImage'),
    // 剪贴板图片 → <项目>/assets/img/pasted-<时间戳>.png
    saveImage: (projectPath: string): Promise<{ ok: boolean; error?: string; path?: string }> =>
      ipcRenderer.invoke('clipboard:saveImage', projectPath)
  },
  /** 匿名使用统计：只能报一个白名单里的计数器名字，别的一律被主进程丢掉。
   *  故意做成「只能加一」——没有传值的余地，就不会有人顺手把内容塞进来 */
  telemetry: {
    bump: (key: string): void => ipcRenderer.send('telemetry:event', key),
    refresh: (): void => ipcRenderer.send('telemetry:refresh')
  },
  /** 主进程侧的偏好（检查更新、匿名统计、画板行为）。这些开关有的在窗口出现之前
   *  就要生效，有的要主进程独立维护状态，所以不放渲染层的 localStorage —— 见 main/prefs.ts */
  prefs: {
    get: (): Promise<PrefsSnapshot> => ipcRenderer.invoke('prefs:get'),
    set: <K extends keyof PrefsSnapshot>(key: K, value: PrefsSnapshot[K]): Promise<PrefsSnapshot> =>
      ipcRenderer.invoke('prefs:set', key, value)
  },
  update: {
    /** 主进程已经查到的新版本（窗口重载后用它恢复状态），没有则 null */
    known: (): Promise<UpdateInfo | null> => ipcRenderer.invoke('update:known'),
    /** 用户手动点「检查更新」。和自动检查不同，失败会把原因报回来 */
    check: (): Promise<{ ok: boolean; info?: UpdateInfo | null; error?: string }> =>
      ipcRenderer.invoke('update:check'),
    /** 下载安装包并打开。装还是用户自己点 */
    download: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('update:download'),
    /** 开关改了之后让主进程重新安排轮询，不用等重启 */
    reschedule: (): Promise<boolean> => ipcRenderer.invoke('update:reschedule'),
    /** info 为 null = 没有（或不再有）新版本，界面上的提示要收回去 */
    onAvailable: (cb: (info: UpdateInfo | null) => void): (() => void) => {
      const h = (_e: unknown, info: UpdateInfo | null): void => cb(info)
      ipcRenderer.on('update:available', h)
      return () => ipcRenderer.removeListener('update:available', h)
    },
    onProgress: (cb: (p: { got: number; total: number }) => void): (() => void) => {
      const h = (_e: unknown, p: { got: number; total: number }): void => cb(p)
      ipcRenderer.on('update:progress', h)
      return () => ipcRenderer.removeListener('update:progress', h)
    }
  },
  /** 输入框里粘贴 / 拖入的图片。落在系统临时目录，24 小时后由主进程清掉 */
  pasteImage: {
    save: (
      bytes: Uint8Array,
      ext: string
    ): Promise<{ ok: boolean; error?: string; path?: string }> =>
      ipcRenderer.invoke('pasteImage:save', bytes, ext),
    /** 只删得掉我们自己临时目录里的东西；拖进来的外部文件原地不动 */
    remove: (path: string): Promise<boolean> => ipcRenderer.invoke('pasteImage:remove', path),
    /** 拖进来的 File → 它在磁盘上的真实路径。
     *  Electron 32 起 File.path 被移除了，只能走 webUtils，而它只在 preload 里够得着。 */
    pathFor: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
    // 终端里 CLI 调 `open <url>` 被 shim 劫持后，主进程经此通知渲染层在画板浏览器打开
    onOpenInCanvas: (cb: (url: string) => void): (() => void) => {
      const h = (_e: unknown, url: string): void => cb(url)
      ipcRenderer.on('shell:openInCanvas', h)
      return () => ipcRenderer.removeListener('shell:openInCanvas', h)
    }
  },
  bizone: {
    check: (): Promise<BizoneCheck> => ipcRenderer.invoke('bizone:check'),
    listProjects: (): Promise<BizoneProject[]> => ipcRenderer.invoke('bizone:listProjects'),
    listMedia: (projectId: string): Promise<BizoneMedia[]> =>
      ipcRenderer.invoke('bizone:listMedia', projectId),
    insertToVAssets: (mediaId: string, projectPath: string): Promise<InsertResult> =>
      ipcRenderer.invoke('bizone:insertToVAssets', mediaId, projectPath),
    revealMedia: (mediaId: string): Promise<void> =>
      ipcRenderer.invoke('bizone:revealMedia', mediaId)
  },
  pty: {
    create: async (opts: PtyCreateOptions): Promise<{ id: string }> => {
      const result: { id: string } = await ipcRenderer.invoke('pty:create', opts)
      startBuffering(result.id)
      return result
    },
    write: (id: string, data: string): void => {
      ipcRenderer.send('pty:write', id, data)
    },
    /** 这个终端里跑的是哪个 AI CLI（认不出返回 null）。判据是 controlling terminal 上的进程名 */
    agentOf: (id: string): Promise<AgentKind | null> => ipcRenderer.invoke('pty:agentOf', id),
    resize: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('pty:resize', id, cols, rows)
    },
    kill: (id: string): void => {
      stopBuffering(id)
      ipcRenderer.send('pty:kill', id)
    },
    busyByIds: (ids: string[]): Promise<string[]> => ipcRenderer.invoke('pty:busyByIds', ids),
    cwd: (id: string): Promise<string | null> => ipcRenderer.invoke('pty:cwd', id),
    onData: (id: string, cb: (data: string) => void): (() => void) => {
      const channel = `pty:data:${id}`
      const pending = pendingBuffers.get(id)
      if (pending) {
        ipcRenderer.removeListener(channel, pending.listener)
        pendingBuffers.delete(id)
        for (const chunk of pending.chunks) cb(chunk)
      }
      const listener = (_e: IpcRendererEvent, data: string): void => cb(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id: string, cb: (exitCode: number) => void): (() => void) => {
      const channel = `pty:exit:${id}`
      const listener = (_e: IpcRendererEvent, exitCode: number): void => {
        stopBuffering(id) // 进程自己退了，缓冲区留着也没人取了
        cb(exitCode)
      }
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  // 通用 AI CLI 对话前端的会话内核（src/main/agentChat/session.ts）。
  // 命名上跟既有的 window.api.skill 区分开——那是"CLI 认不认识某个 skill"的探测，
  // 这里是"驱动一个 CLI 会话跑对话"，完全不是一回事。
  agentChat: {
    /** 有哪些 CLI 可用、各自会什么——渲染层的 CLI 选择器（空态）和工具栏（模型/effort/
     *  沙箱选项）唯一的数据源，靠每项的 capabilities 决定渲染哪些控件。这是加第三个
     *  CLI 时「UI 一行不改」这条机制的输入（Task 0：A 的 8 个 IPC 里没有能力查询接口，
     *  listAdapters()/getAdapter() 此前只活在主进程，渲染层够不着）。 */
    listClis: (): Promise<CliInfo[]> => ipcRenderer.invoke('agentChat:listClis'),
    // start 只是一次普通 invoke——**这里不需要、也不该再有"开始缓冲"这一步**。
    // 缓冲由模块加载期就挂好的常驻监听器负责（见上面 AGENT_CHAT_EVENT_CHANNEL 那段）：
    // 主进程在 handler 返回前同步推的那些事件，到达时监听器早就在了，会按 sessionId
    // 攒进待取缓冲区，等 onEvent 来领。修复前这里是 `await invoke` 之后才挂监听，
    // 那批事件必然落在窗口外被丢弃（评审探针：30 条只到 1 条）。
    start: (params: AgentChatStartParams): Promise<AgentChatStartResult> =>
      ipcRenderer.invoke('agentChat:start', params),
    send: (sessionId: string, message: string): Promise<AgentChatSendResult> =>
      ipcRenderer.invoke('agentChat:send', sessionId, message),
    /** 中途改模型/effort：不打断当前任务，下一条消息才生效（决定 3） */
    setParams: (
      sessionId: string,
      patch: { model?: string; effort?: string }
    ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('agentChat:setParams', sessionId, patch),
    /** 「AI 会话审批」PreToolUse hook 在某个项目里的安装状态——对齐 window.api.hook.status
     *  的形状（2026-08-14 全分支评审 C1 ③）。按 cwd 查，不是全局一份。 */
    hookStatus: (cwd: string): Promise<AgentApprovalHookStatus> =>
      ipcRenderer.invoke('agentChat:hookStatus', cwd),
    /** 一键卸掉某个项目里装的这条 hook——对齐 window.api.hook.uninstall 的形状。
     *  这条 hook 比"提交即复盘"那条更侵入（PreToolUse 会阻塞，PostToolUse 不会），
     *  至少要能对齐"一键卸干净"这条底线。 */
    hookUninstall: (cwd: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('agentChat:hookUninstall', cwd),
    resolveApproval: (
      sessionId: string,
      approvalId: string,
      decision: 'allow' | 'deny'
    ): Promise<{ ok: boolean }> => ipcRenderer.invoke('agentChat:resolveApproval', sessionId, approvalId, decision),
    stop: (sessionId: string): void => {
      stopAgentChatBuffering(sessionId) // 会话主动关闭，缓冲区留着也没人取了
      ipcRenderer.send('agentChat:stop', sessionId)
    },
    onEvent: (sessionId: string, cb: (e: ChatEvent) => void): (() => void) => {
      // 先登记订阅、再回放缓冲——两步之间不可能插进新事件（IPC 事件是宏任务，
      // 这里是同步代码），顺序颠倒反而会让回放期间到达的事件被当成"没人订阅"再攒一遍。
      let subs = agentChatListeners.get(sessionId)
      if (!subs) {
        subs = new Set()
        agentChatListeners.set(sessionId, subs)
      }
      subs.add(cb)
      const pending = agentChatPendingEvents.get(sessionId)
      if (pending) {
        agentChatPendingEvents.delete(sessionId)
        for (const ev of pending) cb(ev)
      }
      return () => {
        const cur = agentChatListeners.get(sessionId)
        if (!cur) return
        cur.delete(cb)
        if (cur.size === 0) agentChatListeners.delete(sessionId)
      }
    }
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
