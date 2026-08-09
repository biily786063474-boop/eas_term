/** 项目状态标签：看板按它分列，画布 Frame 按它染色，分屏右键菜单按它打勾。
 *
 *  **归属在项目，不在画布 Frame。** 早先它是 frame.status，只是个视觉标记；
 *  但分屏里的 tab 和画布的 Frame 是两套结构，没进过画布的项目压根没有 Frame 可打标 ——
 *  状态是项目的属性，不是某个视图里那个框的属性。旧数据启动时迁移过来（见 migrateFrameStatus）。 */
/** 项目落在哪一列。值 = BoardColumn.id。
 *  **不是固定枚举** —— 列是用户自己建的，写死三个值的话新建的列没法用。
 *  空/未设 = 未分类（那是一列虚拟的，不存在于 board.json 里）。 */
export type ProjectStatus = string

/** 看板的一列。全局定义，存在 board.json；项目只记自己在哪一列的 id */
export interface BoardColumn {
  id: string
  name: string
  /** 列头圆点和该列项目在画布上的 Frame 边框色。不设则用主题色 */
  color?: string
}

export interface Project {
  id: string
  name: string
  path: string
  addedAt: number
  /** 未设 = 未分类。「没标状态」和「标了某个状态」是两件事，
   *  不能拿其中一个状态当默认值顶替 */
  status?: ProjectStatus
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  isHidden: boolean
}

/** 「足迹」：Eas-Term 在这台机器上写过的一处位置。
 *  分散的开关等于没有开关——所有触点必须能在一个面板里看全、逐个卸。
 *  这份清单同时是写隐私策略的依据。 */
export interface Footprint {
  id: 'mcp' | 'rules' | 'hook' | 'wiki'
  name: string
  desc: string
  installed: boolean
  /** 动过哪些文件（如实列出绝对路径） */
  files: string[]
  /** 需要额外说清楚的话（比如钩子每次 Bash 都触发） */
  note: string
  removable: boolean
}

/** 规则托管状态。codexRegionChars 是刻意暴露出来的——
 *  那一段是 Codex 的常驻上下文，每轮都在花钱，界面上要能看见它有多大。
 *
 *  知识库不再在这里出现：以前 claudeWiki/codexHasWiki/stale 三个字段追踪的是
 *  「知识库路径有没有被烤进某份全局文件」——那条路本身就是问题所在（全局文件
 *  不管在哪个终端起的会话都读得到，知识库变成了「装到这台机器上」而不是
 *  「装到这个 app 里」）。现在知识库完全走 MCP 工具 wiki_query，工具本身
 *  只在 Eas-Term 注入过环境变量的终端里才会出现在 tools/list 里，
 *  没有「装没装」「过没过期」这回事——每次调用都是当场读盘，没有可能过期的缓存。 */
export interface RulesStatus {
  claudeCanvas: boolean
  /** Codex 常驻托管区的字符数 */
  codexRegionChars: number
}

/** 知识库状态。inbox 那两个字段是刻意成对的——
 *  只给数量不扎人，「最早一份放了 23 天」才让人意识到只进不出。 */
export interface WikiStatus {
  /** 用户设过位置了吗 */
  configured: boolean
  path: string | null
  /** 那个目录还在不在（可能被删了或是网络盘没挂上） */
  exists: boolean
  /** 笔记数（不含收件箱和素材里的原件） */
  notes: number
  inbox: number
  /** 收件箱里最早那份放了多少天 */
  oldestInboxDays: number | null
  hasGit: boolean
  /** 目录存在，但里面**看不到任何知识库该有的东西**（index.md / CLAUDE.md / 任一顶层目录）。
   *  用来区分两件长得一样但原因完全不同的事：
   *    · 真的是个空库（刚建、还没往里放东西）—— 那至少有骨架文件
   *    · 指错了目录、或目录读不出来（网络卷没权限、挂载失效）—— 骨架也看不到
   *  以前这两种都显示成「空知识库」，用户会以为文件被删了。真实踩过一次。 */
  looksEmpty: boolean
}

/**
 * `wiki_query` MCP 工具的返回形状。这是知识库内容离开本机进程边界的**唯一**通道——
 * 工具本身只在 Eas-Term 注入过环境变量的终端里才会出现在 tools/list 里，
 * 所以拿到这个结果就已经证明调用方是合法的 Eas-Term 会话，不需要再额外校验。
 */
export interface WikiQueryResult {
  /** 用户压根没设过位置 —— 这种情况下别的字段都不用看 */
  configured: boolean
  exists?: boolean
  looksEmpty?: boolean
  path?: string
  /** index.md 原文（全库摘要），模型自己从这里挑相关页去读 */
  index?: string
  /** 各分区在盘上的实际目录名（新库英文、老库可能是中文，不能让模型猜） */
  dirs?: { me: string; people: string; methods: string; domains: string; projects: string; sources: string; inbox: string }
}

export interface WikiInboxItem {
  name: string
  path: string
  isDir: boolean
  size: number
  /** 放进来的时间 */
  at: number
}

/** 归档计划里的一条：agent 提出、用户过目后才执行 */
export interface ArchiveItem {
  /** 收件箱里的文件名 */
  name: string
  /** 归档时改成什么名字（可选，只取 basename——不接受路径成分） */
  rename?: string
  /** 打算归到哪个目录、写成哪篇笔记（给人看的，执行时不据此写文件） */
  note?: string
  /** 一句话说明为什么这么归 */
  reason?: string
}

export interface WikiCommit {
  sha: string
  at: number
  subject: string
  /** 是不是 Eas-Term 打的提交（回滚只在这些之间做） */
  mine: boolean
}

/** 知识图谱：节点=笔记，边=[[双链]] */
export interface WikiGraph {
  nodes: { id: string; title: string; tags: string[]; inbound: number; outbound: number }[]
  edges: { from: string; to: string }[]
}

/** 体检发现的一条。只有结构问题——矛盾、过期结论那种要读懂内容的，是 agent 的活 */
export interface LintFinding {
  kind: 'deadlink' | 'orphan' | 'nosummary' | 'notags' | 'stale' | 'thin' | 'noindex'
  file: string
  detail: string
  hint: string
}

/** 「是不是变成了数字仓鼠窝」的判据：放进去多少次 vs 真去问了多少次 */
export interface WikiStats {
  added: number
  ingest: number
  query: number
  lint: number
  notes: number
}

/** 搜索命中 */
export interface WikiHit {
  file: string
  title: string
  snippet: string
  /** 标题命中（排在正文命中前面——找笔记时通常是记得名字） */
  titleHit: boolean
}

/** 反向链接：哪篇笔记的哪一行引用了当前这篇 */
export interface Backlink {
  file: string
  line: number
  text: string
}

/** Agent 角色：把每次开终端要重复交代的东西固化成一份可执行配置。
 *  注意它不是人设——真正起作用的是模型档位、产出契约、工具边界。 */
export interface AgentRole {
  id: string
  name: string
  /** 一句话说明（抽屉里显示） */
  desc: string
  /** main = 沿项目生命周期的主序列；output = 横切的产出型 */
  group: 'main' | 'output'
  color: string
  /** 用哪个 CLI。auto = 装了哪个用哪个，两个都装则用上次用的 */
  kind: 'claude' | 'codex' | 'auto'
  /** 模型 / 思考档位按 kind 各存一套，切 agent 互不覆盖（沿用 NodeAgent 的结构） */
  model?: Partial<Record<'claude' | 'codex', string>>
  effort?: Partial<Record<'claude' | 'codex', string>>
  /** 职责契约：产出什么、落在哪、什么算做完。启动时拼进命令 */
  contract: string
  /** 工具边界。两边能力不对等，如实分开：
   *   allow/deny  —— Claude 的工具名/通配（--allowedTools / --disallowedTools）。
   *                  裸工具名 deny = 该工具从模型上下文里整个消失，由 CLI 强制，不靠模型自觉。
   *   denyServers —— MCP server 名字。Claude 侧展开成 mcp__<名>__* 加进 deny；
   *                  Codex 侧走 -c mcp_servers.<名>.enabled=false（它没有工具级开关，只能整个 server 关）。 */
  tools?: { allow?: string[]; deny?: string[]; denyServers?: string[] }
  /** 内置角色：可改可删，删了能一键恢复 */
  builtin?: boolean
}

// ---------- 密钥柜（存 API key，注入终端，但不进对话） ----------

/** 组里的一个变量。**永远不含值** */
export interface SecretVarMeta {
  /** 注入终端时用的环境变量名（OPENAI_API_KEY）。**跨条目也必须唯一**，
   *  因为所有变量最后注入的是同一份 env，重名会互相盖掉 */
  varName: string
  /** 这个变量在**这台机器上**还解得开吗。库被从别的机器同步过来、
   *  或者应用改过 productName（钥匙串桶名会跟着变）时为 false —— UI 得说人话，
   *  不能只甩一句解密失败 */
  readable: boolean
  /**
   * 这一项是**文件型**（SSH 私钥 / .p8 / .pem 这类），不是能直接当环境变量用的字符串。
   *
   * 用法完全不同：文件型走 `eas-secret run`，会解成一个 0600 的临时文件、
   * 把**路径**放进 `<变量名>_PATH`、命令结束就删。
   * 界面必须区分显示 —— 否则用户存了 SSH 私钥会以为能直接 `$SSH_ID_ALIYUN` 用。
   */
  file?: { name: string }
}

/** 一条密钥的元数据。**永远不含值** —— 值只能经 secrets:reveal 单独取，
 *  或者由主进程直接注入 PTY env（那条路根本不经过渲染层）。
 *
 *  一条 = 一组变量：AK/SK、数据库那套 host/user/password 本来就是一个整体，
 *  拆成几条会出现「删了一半」「自动注入只开了一半」这种半残状态。 */
export interface SecretMeta {
  id: string
  /** 人类可读的名字（「阿里云 主账号」） */
  name: string
  note?: string
  /** 这一组里的变量，至少一个 */
  vars: SecretVarMeta[]
  /** 新开的终端自动带上**整组**。关着的密钥要用得手动指定 */
  autoInject: boolean
  createdAt: number
  /** 最后一次被注入进终端的时间，用来看哪些还在用 */
  lastUsedAt?: number
}

/** 存一条时的入参。一行 value 留空 = 沿用 from（默认同名）那个变量的旧密文，
 *  这样改名不会把值弄丢；新加的行必须给 value。 */
export interface SecretSaveInput {
  id?: string
  name: string
  note?: string
  autoInject?: boolean
  vars: { varName: string; value?: string; from?: string }[]
}

/** reveal 的返回。不传 varName 时整组都解出来（「复制成 .env」用） */
export interface SecretReveal {
  ok: boolean
  vars?: { varName: string; value: string }[]
  error?: string
}

export interface SecretsStatus {
  /** 系统加密可用吗（macOS 看 Keychain、Windows 看 app 是否 ready）。false 时不该让用户存东西 */
  available: boolean
  /** 设过六位码没有。没设过 = 还没启用这个功能 */
  configured: boolean
  locked: boolean
  count: number
  /** 库是别的 app 名 / 别的平台写的 —— 多半整份都解不开 */
  foreign: boolean
  /** 连续输错太多，还要等多久才能再试（毫秒）。0 = 现在就能试 */
  lockedOutMs: number
}

/** 「提交即复盘」钩子在某个 agent 上的安装状态 */
export interface HookAgentStatus {
  hasCli: boolean
  installed: boolean
  /** 装了，但命令里的路径已经对不上（换位置装过 app / 换过 node） */
  outdated: boolean
  /** 用户自己已经配过同一个脚本（不是我们装的）—— 不重复装，避免每次提交跑两遍 */
  foreign: boolean
  /** 写到哪个文件了 —— 界面上要如实告诉用户我们动了他哪份配置 */
  configPath: string
}

export interface HookStatus {
  /** 钩子脚本和 node 都齐了才谈得上装 */
  available: boolean
  claude: HookAgentStatus
  codex: HookAgentStatus
}

/** 用户自建词条。
 *
 *  钩子只负责发现「用了但词典没收录」的术语并记进待办；条目本身由 agent 补全，
 *  经 dict_add 校验后写入，**字段和内置的 242 条完全一致**——
 *  半截词条（只有英文名、没解释没图）混在里面既难看也没用，那是上一版的教训。 */
export interface UserTerm {
  id: string
  en: string
  zh: string
  /** 必须落在内置三类里，自建词条不另开分类 */
  category: 'interaction' | 'motion' | 'visual'
  keywords: string[]
  logic: string
  /** 演示缩略图（内联 SVG，写入前已清洗） */
  svg: string
  /** 第一次遇到的日期 */
  firstSeen: string
  /** 在哪个项目里遇到的 */
  project: string
}

/** 钩子扫出来、等 agent 补全的候选术语 */
export interface DictPending {
  name: string
  project: string
  at: number
}

/** 自动补全词条的开关状态。和钩子安装分开：钩子当初是按「零 token」承诺装的，
 *  补全要花钱，不能靠那次同意顺带生效。 */
export interface DictSinkStatus {
  enabled: boolean
  pending: number
}

/** 「最近产生的文件」条目：给画布插入菜单按时间倒序用 */
export interface RecentFile {
  name: string
  path: string
  /** 相对项目根的路径（菜单里显示它，好区分同名文件） */
  rel: string
  /** 创建时间；取不到 birthtime 的文件系统退回修改时间 */
  time: number
}

export interface PtyCreateOptions {
  cwd?: string
  cols?: number
  rows?: number
  /** 要注入这个终端的密钥的**变量名**列表。
   *  只传名字：值由主进程自己解密后拼进 env，从不回传渲染层
   *  （和 EAS_TERM_TOKEN 走的是同一条路）。 */
  secretNames?: string[]
}

export interface TextFileResult {
  ok: boolean
  content: string
  truncated: boolean
  binary: boolean
  size: number
  error?: string
}

export interface ImageFileResult {
  ok: boolean
  dataUrl: string
  size: number
  error?: string
}

export interface BizoneCheck {
  installed: boolean
  website: string
  downloadUrl: string
}

export interface BizoneProject {
  id: string
  name: string
  updatedAt: number
  nodeCount: number
}

export interface BizoneMedia {
  mediaId: string
  kind: 'image' | 'video'
  mimeType: string
  size: number
  createdAt: number
  title?: string
  prompt?: string
  model?: string
}

export interface InsertResult {
  ok: boolean
  relPath?: string
  absPath?: string
  error?: string
}

export interface OpResult {
  ok: boolean
  path?: string
  error?: string
}

// 终端链接：把终端输出里的候选路径解析成绝对路径并确认其存在。
// null 表示该候选不是真实存在的文件/目录（不应渲染为可点击链接）。
export interface PathProbe {
  absPath: string
  isDir: boolean
}

// ---------- Git（源代码管理面板） ----------

// 单个变更文件。x/y 对应 `git status` 的 XY 两位状态码（索引/工作区）。
export interface GitFileEntry {
  path: string // 相对仓库根
  origPath?: string // 重命名/复制的原路径
  x: string // 索引（暂存区）状态码：M A D R C ? U .
  y: string // 工作区状态码
  staged: boolean // 有已暂存改动
  unstaged: boolean // 有未暂存/未跟踪改动
  untracked: boolean
  conflicted: boolean
}

export interface GitStatus {
  isRepo: boolean
  root?: string
  branch?: string
  ahead?: number
  behind?: number
  files: GitFileEntry[]
  error?: string
}

// diff 以「原始文本 vs 修改后文本」返回，前端交给 CodeMirror merge 计算并高亮，
// 不在主进程解析 unified diff。
export interface GitDiffResult {
  ok: boolean
  original: string
  modified: string
  binary: boolean
  truncated: boolean
  error?: string
}

// 历史里的一次提交（版本）
export interface GitCommit {
  hash: string
  parents: string[] // 父提交（第一个是主父），用于画分支轨道图
  refs: string // 原始 %D（如 "HEAD -> main, origin/main, tag: v1"），前端解析
  author: string // 作者名（%an）
  at: number // 提交时间（unix 秒）
  subject: string // 提交信息首行
  files: number // 改动文件数
}

// 某次提交里改动的单个文件（用于「点提交看这次改了啥」）
export interface GitCommitFile {
  path: string
  origPath?: string // 重命名的原路径
  status: string // A/M/D/R/C…（首字母）
}

// AI 简述（复用终端里的 claude CLI 生成）
export interface AiResult {
  ok: boolean
  text?: string
  error?: string
}

// ---------- Claude Code 对话导航（读 ~/.claude/projects 的 transcript） ----------

// 用户发的一条消息（导航目录项）
export interface SessionTurn {
  uuid: string
  at: number // 时间戳（ms）
  preview: string // 消息文本预览
  imageCount?: number // 该消息附带的图片数（粘贴的截图等）
}

// 消息里附带的一张图片（transcript 中以 base64 内联）
export interface SessionImage {
  mediaType: string // 如 image/png
  data: string // base64
}

// 某条用户消息 + 当时 Claude 的回答（点击后展开）
export interface SessionExchange {
  userText: string
  assistantText: string
  at: number
  images?: SessionImage[]
}

/** 某个会话的「最后一轮问答」——灵动岛通知卡要的就是这个。
 *  和 SessionExchange 的区别：那个按 uuid 取指定一轮（对话导航用），
 *  这个不需要调用方先知道 uuid，直接给最新的一轮。 */
export interface SessionLast {
  found: boolean
  /** 用户这轮问的（已压成一行、截断） */
  ask: string
  /** 该轮最终回答（已压平空白、截断） */
  answer: string
  at: number
}

export interface SessionIndex {
  found: boolean // 是否找到该 cwd 的 Claude Code 会话
  sessionId?: string
  turns: SessionTurn[]
}

// Agent CLI 探测结果：开终端时探测。
// - claude：从 `claude --help` 真实解析模型别名 + effort 档位（随 CLI 升级自动跟随，不写死）。
// - codex：`--help` 不暴露模型/档位（服务端 catalog 驱动），故 models/efforts 是主进程给的已知默认。
export interface AgentProbe {
  claude: { installed: boolean; models: string[]; efforts: string[] }
  codex: { installed: boolean; models: string[]; efforts: string[] }
}

/** 某个 AI CLI 的技能包状态 */
export interface AgentStatus {
  /** CLI 装没装（找不到就不用提示装技能包了） */
  hasCli: boolean
  /** 技能包装没装 */
  installed: boolean
  /** 装的是不是当前版本（app 升级后技能包内容可能变） */
  outdated: boolean
}

/** 配套技能包的整体状态：告诉 AI「什么时候该用画板工具」的那份指引 */
export interface SkillStatus {
  claude: AgentStatus
  codex: AgentStatus
  /** 用户点过「永远不要提醒」 */
  muted: boolean
  /** 有任何一个装了 CLI 但没装（或版本旧了）技能包 —— 渲染层据此决定要不要弹窗 */
  needsAttention: boolean
  /** 一个 CLI 都没有：agent 能力整体不可用，界面要降级而不是摆一堆点不动的控件 */
  noCli: boolean
}

/** 一条可执行的安装命令。我们只负责填进终端，回车由用户自己按。 */
export interface InstallOption {
  /** 安装方式的名字（官方安装脚本 / Homebrew / npm / WinGet） */
  via: string
  cmd: string
  /** 这条命令需要的 shell（目前只有 Windows 的 PowerShell 需要标注） */
  shell?: 'powershell'
}

export interface AgentInstallInfo {
  name: string
  vendor: string
  /** 候选安装方式，最合适的排第一 */
  options: InstallOption[]
  /** 装完之后用来登录 / 启动的命令 */
  loginHint: string
}

export interface InstallPlan {
  platform: string
  hasNode: boolean
  hasBrew: boolean
  claude: AgentInstallInfo
  codex: AgentInstallInfo
}

// ---- 灵动岛（屏幕顶部常驻状态栏）----
// 主窗口 → 主进程 → 灵动岛窗口，单向推一份完整快照；灵动岛只展示，不持有状态。
// 快照而非增量：这条链路一帧几百字节，为省这点带宽引入增量同步，
// 换来的是「灵动岛显示的和主窗口不一致」这类最难查的 bug。

/** 一个正在跑的任务（折叠态计数用它，列表态逐条显示） */
export interface IslandRunning {
  /** ptyId —— 也是点击跳转时回传的定位键 */
  key: string
  project: string
  /** 终端名（画布节点自定义名优先） */
  term: string
  /** 本轮开始时间戳。灵动岛按它自己走秒，不靠推送刷新——
   *  否则秒数跳动的频率就等于推送频率，看起来像卡住。 */
  startedAt: number
}

/** 一条待用户处理的通知。
 *  kind:'done' = 答完了（信息，8 秒自动收）；
 *  kind:'approval' = 停在那儿等你选（常驻到处理，agent 正阻塞着）。 */
export interface IslandNotice {
  /** ptyId + 轮次，用于去重与队列定位 */
  id: string
  kind: 'done' | 'approval'
  project: string
  term: string
  /** 用户这一轮问的（一行截断） */
  ask?: string
  /** 模型的最终回答（CSS 截两行） */
  answer?: string
  /** 本轮耗时 ms（这次提问到答完） */
  roundMs?: number
  /** 会话累计耗时 ms（这个终端起会话至今） */
  totalMs?: number
  model?: string
  effort?: string
  /** 这个终端跑的是哪个 CLI。用来解释「为什么没有提问和回答」——
   *  Codex 不落 transcript，卡片只能给项目名和耗时，得说清楚是拿不到而不是没内容。 */
  agent?: 'claude' | 'codex'
  at: number

  // ---- 以下仅 kind:'approval' ----
  /** 屏幕上问的那句话 */
  question?: string
  /** 待执行的命令 / 待改的文件。**不截断显示**——审批的正是这一段，
   *  截一半可能让 `rm -rf node_modules` 和 `rm -rf ~/Documents` 长得一样。 */
  body?: string
  /** 可点的选项。按 index 写回 pty，不按文案猜语义 */
  options?: { index: number; label: string }[]
  /** 命中危险模式（rm -rf / sudo / curl|sh …）→ 不给直通按钮，强制跳回终端 */
  dangerous?: boolean
  /** 写回之后 spinner 没重新转起来 = 那次点击没生效，卡片降级成「跳回终端」 */
  stale?: boolean
}

/** 有新版本可下载。数据来自发布脚本写的 latest.json */
export interface UpdateInfo {
  version: string
  /** 这一版的更新条目（来自 CHANGELOG.md，发布时写进 latest.json） */
  notes: string[]
  /** 适配本机平台/架构的下载直链；这个平台没出包时为 null */
  url: string | null
  published?: string
}

/** 灵动岛的一帧完整状态 */
export interface IslandState {
  running: IslandRunning[]
  notices: IslandNotice[]
  /** 主窗口此刻是不是在前台。
   *  前台时通知只折叠着提示、不自动展开卡片——你正看着屏幕，弹一张卡挡在最上面是打扰。 */
  foreground?: boolean
  /** 刘海尺寸（逻辑像素）。主进程量好后随状态一起下发，渲染层照着在中间留出这么宽的
   *  透明区，内容分居两侧。w=0 表示这块屏幕没有刘海（外接显示器 / 非 Mac），
   *  此时不留空隙、窗口也不贴屏幕上沿而是挂在菜单栏下方。 */
  notch?: { w: number; h: number }
}

/** 灵动岛回传的动作 */
export interface IslandAction {
  type: 'focus' | 'dismiss' | 'approve'
  /** focus/approve：ptyId；dismiss：notice id */
  key: string
  /** approve 专用：用户点的那个选项的**序号**。写回 pty 的就是它，
   *  不传文案——文案是给人看的，序号才是 CLI 认的。 */
  choice?: number
}

/** 甘特图上的一条任务：一次「你发了什么 → agent 干完」。
 *  prompt/follow 都是**用户发出去的**文本，agent 的输出不记。 */
export interface GanttTask {
  id: string
  projectId: string
  ptyId: string
  /** 点条能跳回那个终端 */
  leafId: string
  /** 原文，超过 2000 字截断 */
  prompt: string
  /** 这一轮里补发的指令（agent 已经在跑时又发的），各自也截断 2000 字 */
  follow?: string[]
  startAt: number
  /** null = 还在跑 */
  endAt: number | null
  /** 上次被强杀导致没能写 endAt，读取时补的标记。不编造结束时间。 */
  aborted?: true
  /** 写入这条记录时，主进程本次运行的 id（gantt:push 里由主进程盖章，渲染层传的会被覆盖）。
   *  跟本次运行的 id 不一致，就说明这条记录来自更早的一次运行——不管 ptyId 是多少。
   *  必须用它而不是单看 ptyId：pty.ts 的 ptyId 只是进程内自增的小整数，每次启动都
   *  从 1 重来，两次运行之间完全可能撞出同一个号，单看 ptyId 会把撞号的旧记录误判成活的。
   *  旧数据没有这个字段 → 必然来自更早的运行 → 天然判定不一致，不用额外兼容逻辑。 */
  runId?: string
}

/** gantt:clear 的可选范围参数——不传 = 清空全部；传了就只清落在 [from, to] 内的记录。
 *  判据见 main/gantt.ts 的 overlapsRange：还没结束的任务（endAt===null）按「到现在」
 *  算它的结束端，跟主区渲染时判断「要不要画进这个窗口」用的是同一套口径。 */
export interface GanttClearRange {
  from: number
  to: number
}
