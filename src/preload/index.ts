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
  RenameFolderResult} from '../shared/types'

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

/** 从 additionalArguments 里取主进程塞进来的构建信息（同步，界面首帧就能用） */
function argOf(name: string): string {
  const p = `--${name}=`
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length) ?? ''
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
    }
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
      targets: ('claude' | 'codex')[]
    ): Promise<{ ok: boolean; error?: string; done?: string[]; status?: HookStatus }> =>
      ipcRenderer.invoke('hook:install', targets),
    uninstall: (
      targets: ('claude' | 'codex')[]
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
    recentFiles: (rootPath: string, limit?: number): Promise<RecentFile[]> =>
      ipcRenderer.invoke('fs:recentFiles', rootPath, limit),
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
  /** 主进程侧的偏好（检查更新、匿名统计）。这两个开关在窗口出现之前就要生效，
   *  所以不放渲染层的 localStorage —— 见 main/prefs.ts */
  prefs: {
    get: (): Promise<{ autoUpdateCheck: boolean; telemetry: boolean }> =>
      ipcRenderer.invoke('prefs:get'),
    set: (
      key: 'autoUpdateCheck' | 'telemetry',
      value: boolean
    ): Promise<{ autoUpdateCheck: boolean; telemetry: boolean }> =>
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
    agentOf: (id: string): Promise<'claude' | 'codex' | null> => ipcRenderer.invoke('pty:agentOf', id),
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
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
