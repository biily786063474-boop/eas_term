/** 项目状态标签：看板按它分列，画布 Frame 按它染色，分屏右键菜单按它打勾。
 *
 *  **归属在项目，不在画布 Frame。** 早先它是 frame.status，只是个视觉标记；
 *  但分屏里的 tab 和画布的 Frame 是两套结构，没进过画布的项目压根没有 Frame 可打标 ——
 *  状态是项目的属性，不是某个视图里那个框的属性。旧数据启动时迁移过来（见 migrateFrameStatus）。 */
/** 项目落在哪一列。值 = BoardColumn.id。
 *  **不是固定枚举** —— 列是用户自己建的，写死三个值的话新建的列没法用。
 *  空/未设 = 未分类（那是一列虚拟的，不存在于 board.json 里）。 */
/**
 * Eas-Term 适配的 AI CLI。**加新 CLI 只改这一行。**
 *
 * 这个联合原来是字面量散落在 29 处 / 14 个文件里（agent 探测、安装建议、hook、
 * 角色的 model/effort 键、pty 的进程名识别、画布节点持久化、五个渲染层组件…）。
 * 那种形态下加一个 CLI 要手工找齐全部出现点，**漏一处不报错** ——
 * 比如漏了 pty.ts 的 agentOnTty，新 CLI 在终端里跑起来通知系统认不出它，
 * 功能"能用"但一路静默。收成别名之后，漏的地方编译器会直接指出来。
 */
export type AgentKind = 'claude' | 'codex'

/** 三个 harness 的标识。**只用于角色卡**（model / effort / raw 按它分键，绑定层按它选列）。
 *  `AgentKind` 仍是 'claude' | 'codex' —— pty 进程识别、探测表、画布节点都靠它穷举，扩它会牵一大片。 */
export type HarnessId = AgentKind | 'omp'

/** 角色的能力意图。**只能收紧，不能放开**：值域是 `false`，缺省即允许。
 *  这样「一张空卡 = 杂役」在类型上成立，也不会出现角色把 CLI 默认关掉的东西打开。 */
export interface RoleCaps {
  /** 不许改文件 */
  write?: false
  /** 不许跑命令 */
  shell?: false
  /** 不许生图（红线） */
  imageGen?: false
  mcp?: {
    /** 精确的 MCP server 名 */
    denyServers?: string[]
    /** 工具名或通配（`*image*`），**不带** `mcp__` 前缀 */
    denyTools?: string[]
  }
}

/** 逃生口：某家独有、意图模型表达不了的原始参数。只在对应 harness 生效。 */
export interface RoleRaw {
  claude?: { deny?: string[] }
  codex?: { disable?: string[] }
  omp?: { removeTools?: string[] }
}

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
  /** 这个项目曾经在哪些路径上。改名时追加旧路径，只用来找改名前的历史会话
   *  （Claude Code 按 cwd 编码存 transcript，改名后老会话留在老编码目录里）。
   *  上限 5 条，超了丢最老的——它不是审计日志。 */
  pastPaths?: string[]
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
  /** 库根 `.eas-wiki.json` 的状态：`'none'` 没有这个文件（内置八目录库）；
   *  `'valid'` 有且合法（自定义库）；`'broken'` 文件在但读不出来 / 不是合法 JSON /
   *  校验不过。**`'broken'` 时 initWiki 不会往这个库里写任何东西**——不建目录、
   *  不改 CLAUDE.md/AGENTS.md/index.md/START-HERE.md。原因见 main/wiki/taxonomy.ts
   *  的 TaxonomyState：回落到内置分类会把这个自定义库的目录和说明书真的改写成
   *  内置形状，不可逆；宁可停手，等用户把配置改好——界面据此显示提示。 */
  taxonomyState: 'none' | 'valid' | 'broken'
  /** `taxonomyState` 为 `'broken'` 时人能看懂的原因，给界面提示用；其余状态下不出现 */
  taxonomyError?: string
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
  /** 各分区在盘上的实际目录名（新库英文、老库可能是中文，不能让模型猜）。
   *  **只在内置八目录形状的库上准确** —— 见下面 library 字段的说明。 */
  dirs?: { me: string; people: string; methods: string; domains: string; projects: string; sources: string; inbox: string }
  /** 这个库是用户自定义分类的（库根有 .eas-wiki.json）。**有这个字段时，按它判断东西往哪放，
   *  忽略 dirs** —— dirs 固定是内置八目录的形状，自定义库里那七个名字对应的目录根本不存在，
   *  照着 dirs 写会凭空建出配置外的目录（Critical 1 就是这么踩的坑：wiki:archive 曾经
   *  这样凭空造出一个配置外的 sources/）。role 为 "inbox" 或 "raw" 的目录放的是原件，
   *  只读不改（同 dirs.sources/dirs.inbox 那条规则，但这里权威）。
   *  没有这个字段 = 内置八目录的库，dirs 照常有效。 */
  library?: { name: string; purpose: string; role?: 'inbox' | 'templates' | 'raw' }[]
  /** 库根有 `.eas-wiki.json`，但读不出来 / 不是合法 JSON / 校验不过。**这个字段出现时，
   *  dirs、library、index 都不会出现**——不是「没有配置」，是「有自定义配置但暂时不可信」，
   *  这两者不能用同一种回落处理：dirs 若照常给出内置八目录形状，模型会把它当真、
   *  往 dirs.me 这类配置外的目录写，把这个自定义库的目录结构写乱（且不可逆）。
   *  看到这个字段就什么都别做——不归档、不新建笔记、不管 dirs 长什么样——等用户把
   *  `.eas-wiki.json` 改好。 */
  taxonomyBroken?: true
  /** `taxonomyBroken` 为 true 时人能看懂的原因 */
  taxonomyError?: string
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
  kind: AgentKind | 'auto'
  /** 模型 / 思考档位按 harness 各存一套，切 CLI 互不覆盖。omp 的 model 填 selector（`provider/model`），effort 填 thinking 档位 */
  model?: Partial<Record<HarnessId, string>>
  effort?: Partial<Record<HarnessId, string>>
  /** 职责契约：产出什么、落在哪、什么算做完。启动时拼进命令 */
  contract: string
  /** 能力意图，由 `shared/roleBinding.ts` 翻成各家参数 */
  caps?: RoleCaps
  /** 各家独有的原始参数（逃生口） */
  raw?: RoleRaw
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
  /** 必须落在内置四类里，自建词条不另开分类。
   *  **老字段，保留** —— 用户机器上已装的 skill 还在按它写（它们只会写前三个，
   *  加第四个不影响它们：校验是白名单，只放宽不收紧）。
   *  `backend` 是 2026-09-04 加的：后端词条硬塞进 interaction/motion/visual
   *  任何一个都是假话，而这个值会显示在胶囊的色点上。 */
  category: 'interaction' | 'motion' | 'visual' | 'backend'
  /** 二级分类（2026-08-31）。**可选** —— 强制必填会让已装的老 skill 一调就被拒。
   *  给了就必须是 shared/dictTaxonomy.ts 里真实存在的一对；没给就落到界面的「未分类」。 */
  cat1?: string
  cat2?: string
  /** 区块标签（2026-09-04）：这条手法适合用在页面的哪一块。**可选**，
   *  且和 cat1/cat2 正交 —— 一条词条可以属于 0~3 个区块。
   *  合法值见 shared/dictBlocks.ts；**加了这个字段就必须同步 dict.ts 的
   *  readUser() 白名单**，否则每加一条新词会把已有条目的它洗掉一遍。 */
  blocks?: string[]
  keywords: string[]
  logic: string
  /** 点击后挂成 chip、发送时展开的完整提示词。可选，但没有它点下去只能插解释 */
  prompt?: string
  /** 演示缩略图（内联 SVG，写入前已清洗） */
  svg: string
  /** 第一次遇到的日期 */
  firstSeen: string
  /** 在哪个项目里遇到的 */
  project: string
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
/** 每个 CLI 探测到的实况。**用 Record<AgentKind,…> 而不是写死几个键** ——
 *  加 CLI 时编译器会直接指出所有没跟上的消费点（这正是 AgentKind 存在的理由）。 */
export type AgentProbe = Record<AgentKind, { installed: boolean; models: string[]; efforts: string[] }>

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
  /**
   * 装了之后能用在哪。**由数据声明，不在 UI 里按 CLI 名字判断** ——
   * 否则加一个 CLI 就要去界面里补一条 if，而那种补丁必然漏。
   *
   * 存在的理由：有的 CLI 在终端里能用（MCP 工具、skill、AGENTS.md 指引全生效），
   * 却**不能用于 AI 对话面板** —— headless 模式只打印最终消息、没有流式和工具事件
   * 的那种，写不出 adapter。用户装完发现对话框里选不了它，会以为装坏了。
   */
  scope: {
    /** 能被 Eas-Term 直接驱动跑对话（面 6：agentChat 的 adapter） */
    chat: boolean
    /** 能在终端里用上 Eas-Term 的能力（面 1/2/3：指引 + skill + MCP） */
    terminal: boolean
    /** 一句话说明，写给用户看的。空 = 全都支持，不用额外解释 */
    note?: string
  }
}

export interface InstallPlan {
  platform: string
  hasNode: boolean
  hasBrew: boolean
  /** 按 CLI 给的安装建议。**用 Record<AgentKind,…>**：加 CLI 时漏填这里，
   *  界面上那个 CLI 就永远显示不出安装入口，而这种漏不报错。 */
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
  agent?: AgentKind
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
  /** 用户把岛收成了「摄像头左边一颗呼吸的圆点」。
   *  常驻的一条黑块会挡住顶部内容，右键收起后只留这颗点，点它再展开。
   *  收起态**仍然在跑**（通知照收、圆点会随状态变色），只是不占地方。 */
  mini?: boolean
}

/** 灵动岛回传的动作 */
export interface IslandAction {
  /** mini/unmini 只切形态，不带 key —— 它们不针对某个终端 */
  type: 'focus' | 'dismiss' | 'approve' | 'mini' | 'unmini'
  /** focus/approve：ptyId；dismiss：notice id */
  key: string
  /** approve 专用：用户点的那个选项的**序号**。写回 pty 的就是它，
   *  不传文案——文案是给人看的，序号才是 CLI 认的。 */
  choice?: number
}

/** 甘特图上的一条任务：一次「你发了什么 → agent 干完」。
 *  prompt/follow 都是**用户发出去的**文本，agent 的输出不记。 */
/** 一个**已安装**的 CLI 插件。由 main/plugins.ts 扫盘得出，只读、不落盘。
 *
 *  两个生态的插件形状不同，这里归一化成一份（差异见 main/plugins.ts 的文件头）：
 *  Codex 的元数据在 `.codex-plugin/plugin.json` 的 `interface` 块里（很全），
 *  Claude 的只有 name/description（很薄），缺的字段一律留空由 UI 兜底。 */
export interface PluginInfo {
  /** `<cli>:<name>`，唯一。用于 UI key 和「这次会话带哪个插件」的引用 */
  id: string
  /** 属于哪个 CLI —— **决定用哪个 adapter 起会话**，不能猜 */
  cli: 'claude' | 'codex'
  /** 插件自己的名字（codex plugin remove / claude plugin disable 用的那个） */
  name: string
  /** 界面上显示的名字。Codex 取 interface.displayName，Claude 只能退回 name */
  displayName: string
  description?: string
  /** Codex 有分类（Productivity / Developer Tools …），Claude 没有 */
  category?: string
  /** Codex 的 interface.brandColor，形如 `#5E6AD2`。UI 拿它给条目染色 */
  brandColor?: string
  /** 图标的**绝对路径**（已由主进程把相对路径解开）。渲染层不能直接 file://，
   *  要走已注册的自定义协议 —— 同 bizone.ts 的 registerBizoneScheme */
  iconPath?: string
  /** Codex 的 interface.defaultPrompt[0]。选中插件时预填进对话框的首条消息 */
  defaultPrompt?: string
  /** 这个插件带的 MCP server 配置（原样，未做变量替换）。
   *  **只有本地型插件才有**；连接器型（只有远程 app id）为 undefined。 */
  mcpServers?: Record<string, unknown>
  /** 插件目录的绝对路径。`${CLAUDE_PLUGIN_ROOT}` 这类变量靠它替换 */
  root: string
}

export interface GanttTask {
  id: string
  projectId: string
  /** 这条记录来自哪种会话。**缺省 = terminal** —— 0.4.62 之前落盘的记录都没有
   *  这个字段，读的时候一律当终端，不要写迁移。 */
  kind?: 'terminal' | 'agent'
  /** 会话标识：终端是 pty 的 id，AI 对话是 agentChat 的 sessionId（`ac-N`）。
   *
   *  **字段名叫 ptyId 是历史包袱**，它要的其实是「任务归属于哪个会话」。
   *  这跟 uiSlice 的 setPtyRunning / flagAttention 是同一个包袱、同一个处理方式
   *  （见 AgentChatView 里那段说明：那两个 action 也是拿会话 id 当 ptyId 传）。
   *  改名要动已落盘的数据，收益不抵风险；靠上面的 kind 区分即可。 */
  ptyId: string
  /** 点条能跳回那个终端 / AI 对话节点 */
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

/** 终端输入框右键插入的待办清单里的一条。
 *  打钩完全是用户自己点——不解析终端输出、不代 agent 判断「做完了没」，
 *  这里只记录人自己的判断，不关心 agent 实际说了什么。 */
export interface TodoItem {
  id: string
  text: string
  done: boolean
}

export interface RenameFolderResult {
  ok: boolean
  error?: string
  /** 成功时给回新的完整列表，渲染层直接换掉，不用再拉一次 */
  projects?: Project[]
}

/** 快照要截的屏幕区域（CSS 像素，相对窗口左上角） */
export interface SnapshotRect {
  x: number
  y: number
  width: number
  height: number
}
export interface SnapshotResult {
  ok: boolean
  error?: string
  /** 成功时的绝对路径 */
  path?: string
}

// ── Skill 管理面板 ────────────────────────────────────────────────
// 完整背景见 docs/superpowers/specs/2026-08-14-skill管理面板-design.md。
// 第一半（读与显示）：列目录、解析 SKILL.md、按分类分组。
// 第二半（写与联动）：复制/粘贴 skill、临时禁用、文件树拖到画布编辑、
// 给 agent 开的分类 MCP 口子——第二半只往下面追加字段/类型，没改第一半已有的形状。

/** 一个 skill：对应 `<dir>/<name>/SKILL.md` 所在的子目录。
 *  `path` 是这个 skill 的唯一 id——分类口子（第二半）引用 skill 就靠它，
 *  不用另起一个 id 字段：目录路径本身已经是稳定、唯一的。 */
export interface SkillInfo {
  path: string
  name: string
  description: string
  /** SKILL.md 存在但 frontmatter 解析不出 name 时的降级标记——
   *  这时 name 回落成目录名、description 可能是空串，面板要能分辨「读到了」和「猜的」 */
  fallback?: boolean
}

/** 一个分类（扁平一层，不嵌套）：一个可折叠的头 + 属于它的 skill 列表。
 *  没有分类数据时，所有 skill 落进 name === '未分类' 的这一组。 */
export interface SkillCategoryGroup {
  name: string
  skillPaths: string[]
}

/** 列出某个目录下所有 skill 的结果。ok:false 时 skills/categories 恒为空数组，
 *  error 给出人能看懂的原因（目录不存在/无权限/不是文件夹）——
 *  面板据此渲染空态，不能让一个读不出来的目录把整个面板打崩。 */
export interface SkillListResult {
  dirPath: string
  ok: boolean
  error?: string
  skills: SkillInfo[]
  categories: SkillCategoryGroup[]
  /** 这个目录里被临时禁用的 skill（绝对路径）。**禁用只写这份清单，不动硬盘上的文件**
   *  （design 文档 §六 第 1 条）——所以它跟 skills 是两份独立数据：被禁用的 skill 照样
   *  出现在 skills 里（面板置灰显示，隐藏了就没法恢复），这里只是标出哪些被划掉了。 */
  disabled: string[]
}

/** CLI 按钮里可选的一个 skill 目录。内置几个默认（这台机器实测过的真实分布），
 *  用户可以再加自定义目录——「用户把 skill 搬出默认路径做渐进式披露」是刻意的
 *  组织方式，不是异常状态，面板必须照顾到。 */
export interface SkillDirEntry {
  id: string
  label: string
  path: string
  builtin: boolean
}

/** 添加自定义目录的结果。失败时（路径不存在/不是文件夹/已经在列表里）dirs 给回
 *  当前列表不变，面板可以直接拿它刷新，不用再单独查一次 listDirs。 */
export interface SkillDirAddResult {
  ok: boolean
  error?: string
  dirs: SkillDirEntry[]
}

/** 复制一个 skill 到另一个 skill 目录的结果。
 *  `duplicate` 单独标出来是因为**重名要拒绝并明确告诉用户**（design 文档 §六 第 4 条）：
 *  面板要能把这一种失败讲成「那边已经有一个同名的了」，而不是笼统的「复制失败」。 */
export interface SkillCopyResult {
  ok: boolean
  error?: string
  duplicate?: boolean
  /** 成功时给出落点绝对路径，面板据此提示「复制到哪儿了」 */
  dest?: string
}

/** 禁用/恢复一个 skill 的结果。disabled 是**改完之后**的整份清单，
 *  面板直接拿它刷新，不用再查一次。 */
export interface SkillDisableResult {
  ok: boolean
  error?: string
  disabled: string[]
}

/** 给 agent 的分类口子（MCP）看到的全景：所有已登记目录 + 项目 skill 目录里的全部 skill。
 *  面板一次只看一个目录，agent 要整理分类必须看全量，所以是另一条读取路径。 */
export interface SkillLibrarySnapshot {
  dirs: { id: string; label: string; path: string; builtin: boolean; ok: boolean; error?: string }[]
  skills: {
    /** 绝对路径 = 唯一 id，分类/禁用清单引用 skill 都用它 */
    path: string
    name: string
    description: string
    /** 它所在的那个 skill 目录（绝对路径） */
    dir: string
    /** 当前分类；没分过类时是 null（不是「未分类」那个显示用的名字） */
    category: string | null
    disabled: boolean
  }[]
}

/** 批量写分类的结果。**引用了不存在的 skill 要拒绝整批**（design 文档 §四），
 *  所以失败时 error 里会点名是哪几条不认识——agent 只有拿到名字才改得动。 */
/** 没有被归类的 skill 落在这个桶里。**它不是用户建的分类**：删不得、也不能拿它
 *  当自建分类的名字。主进程和渲染层都要判断它（一个用来分组、一个用来决定
 *  「拖到这里 = 清掉分类」），所以放在 shared，不许两边各写一份字面量。 */
export const UNCATEGORIZED = '未分类'

export interface SkillCategorizeResult {
  ok: boolean
  error?: string
  /** 成功时：这一批实际写进配置的条数 */
  applied?: number
  /** 因为用户手动定过分类而被跳过的 skill 路径。**必须报给 agent** ——
   *  静默跳过的话它以为整理完了，用户看到的分类却没变，两边都不知道发生了什么。 */
  skippedLocked?: string[]
}

// ---------- 手机端（feat/phone-remote） ----------

/** 桌面端界面要看到的那一份手机端状态。
 *  **tokenHash 不在里面** —— 它是凭据表，渲染层没有任何理由拿到它。 */
export interface PhoneStatus {
  enabled: boolean
  running: boolean
  /** 局域网地址，形如 http://192.168.1.20:53412；没起服务时为 null。
   *  **这是给浏览器的那个口，明文** —— 自签证书在手机浏览器上是一整页
   *  红色警告，而浏览器又钉不了证书，强行上 TLS 只会训练人点「继续访问」 */
  url: string | null
  /** 给 **app** 的那个口（TLS，指纹钉死）。
   *  **null 表示 TLS 口没起来，而明文口是好的** —— 两件事要分开说，
   *  糊成一个「没起来」的话用户不知道自己该用浏览器还是该修 */
  secureUrl: string | null
  /** app 要钉的公钥指纹（SPKI 的 SHA-256，base64url，43 字符）。
   *  还没建过身份时为 null —— 不在界面上凭空造出一把不存在的密钥 */
  pin: string | null
  /** 隧道（在外面用）。**跟总开关是两件事**，默认关 */
  tunnel: {
    enabled: boolean
    /** off=没开 / connecting=在连 / online=挂上了 / error=有明确原因连不上 */
    state: 'off' | 'connecting' | 'online' | 'error'
    /** 出错时服务器的原话。**「凭证对不上」和「服务器满了」用户的下一步
     *  完全不同**，糊成一个「连不上」等于什么都没说 */
    detail: string | null
    host: string
    port: number
  }
  /** 当前配对码；null = 没在配对 */
  code: string | null
  codeAt: number | null
  /** 有手机扫了码、正在等你点确认时它自报的名字（**不可信**，已过滤控制字符） */
  claimingName: string | null
  devices: { id: string; name: string; pairedAt: number; lastSeenAt: number }[]
  /** 操作留痕，最近的排最前。
   *
   *  **手机端唯一的事后依据。** 新建对话不再要求逐次确认（那道闸假设你能碰到
   *  电脑，而这功能就是为够不着电脑时用的），所以这份留痕的分量更重了 ——
   *  它是你回到电脑前唯一能知道「手机上做过什么」的地方。 */
  audit: {
    at: number
    deviceId: string
    deviceName: string
    action: string
    detail: string
    outcome?: 'allowed' | 'denied' | 'expired'
  }[]
}

// ---------- CLI 安装 / 登录（分发侧引导） ----------

export interface CliAuthStatus {
  loggedIn: boolean
  /** 用什么方式登的。拿不到就 undefined，不编 */
  method?: string
  account?: string
}

export interface CliAuthState {
  cli: 'claude' | 'codex'
  /** 命令在不在。**和「登没登录」是两件事** */
  installed: boolean
  /** **null = 读不到，不是「没登录」** —— 两者界面上说的话完全不同：
   *  没登录要引导登录；读不到说明我们跟 CLI 脱节了，推人去重登只会白走一趟 */
  status: CliAuthStatus | null
  error?: string
}

export interface LoginState {
  cli: 'claude' | 'codex'
  phase: 'starting' | 'waiting' | 'submitting' | 'done' | 'failed' | 'canceled'
  prompt?: {
    /** 要用户打开的网址。**界面上给「点我去登录」按钮 + 右键复制，不自动跳** */
    url?: string
    /** 设备码（codex 走 --device-auth 时有；claude 没有） */
    code?: string
    /** CLI 在等我们把授权码写回 stdin（claude 是这样） */
    needsCode?: boolean
  }
  error?: string
}

export interface InstallState {
  cli: 'claude' | 'codex'
  /** running=装着；verifying=装完在核实命令真的在了；done=能用了；failed=没成 */
  phase: 'running' | 'verifying' | 'done' | 'failed'
  /** 安装器自己最后打出来的那句话。**原样透传** ——
   *  不编百分比：curl|bash 和 npm 都不给可解析的进度，凑一个数字是在骗人 */
  step?: string
  error?: string
  /** **失败时才有**：输出尾部。
   *  这是终端那条路唯一不可替代的地方（公司网络 / 代理 / 权限失败时，
   *  一句「安装失败」什么忙也帮不上），换成进度条必须把它补回来。 */
  output?: string[]
}

/** GPU 加速有没有生效。**排障用** —— Windows 上退回软件合成时，
 *  毛玻璃/圆角/阴影全由 CPU 画，界面会卡到「未响应」。 */
export interface GpuInfo {
  /** Chromium 报的各项状态，**原样透传**（`enabled` / `software only` / `disabled` …）。
   *  不翻译成「好/坏」—— 翻译会丢掉中间态，而排障时正是那些有用 */
  features: Record<string, string>
  /** 一句话结论。**判据是 gpu_compositing 那一项**，不是「有没有显卡」 */
  verdict: 'gpu' | 'software' | 'unknown'
  platform: string
  release: string
  arch: string
  detail?: string
}
