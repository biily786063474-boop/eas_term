// 通用 AI CLI 对话前端的中间事件模型。
// **这里不允许出现任何 CLI 特有的概念** —— 不能有 hookEventName / thread_id /
// tool_use_id 这类只有一边存在的字段。它们只属于 adapter 内部。
//
// 判据（2026-09-02 按第三个 CLI 的实际接入修订过一次）：加第三个 CLI 时，这个文件
// **只允许新增可选的能力位与事件变体，不允许出现某个 CLI 独有的概念**。
// 原来那句写的是「不该需要改」，太绝对：`transport` / `auth` / `bundled` / `quotaSource`
// 这类是「这个 CLI 会什么」的声明，正是本文件该有的东西；真正要挡的是把
// `session/set_config_option`、`PI_CONFIG_DIR` 这种协议或产品细节漏进来。
// 新增字段一律可选，且**缺省即老行为** —— 判据写成 `!== '新值'` 走老路，
// 而不是 `=== '老值'`（后者对不声明该字段的旧 adapter 恒假，会把它们的老路整个跳过）。

import type { RoleBounds } from './roleBinding'
import type { RoleCaps, RoleRaw } from './types'

export interface Usage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  /** 上下文占用比例 0~1。
   *  spec §九 第 4 条原来写着「result 事件里没有窗口上限、算法未定，一律不填」——
   *  **那个前提 2026-08-17 被实测推翻**：分母就在同一个 result 事件里
   *  （`modelUsage[<model>].contextWindow`）。分子取 input + cache_read + cache_creation。
   *  **但原则一个字没改**：拿不到分母时仍然不填，绝不显示一个看起来精确、实则猜的比例。 */
  contextRatio?: number
}

export type ChatEvent =
  | { k: 'session.ready'; sessionId: string; model: string; cwd: string }
  /** 一轮开始了：消息已经投递给 CLI，接下来会有回答。
   *
   *  **这个事件不是翻译器产出的，是会话层（session.ts 的 deliverMessage）推的** ——
   *  CLI 自己不报「我收到消息了」，它只在说话时才出声。而「已经发出去、还没回音」
   *  这段（实测有 4 秒多）恰恰是界面最需要表态的时候。
   *
   *  没有它的时候，渲染层只能自己记一个 awaiting 标志，于是「正在忙」这件事同时
   *  记在两个地方，必然有一处覆盖不到的缝：起初是 session.ready 到首字之间界面静止，
   *  补上 turnActive 之后又漏了第二条消息（普通 send 不产生 session.ready，
   *  turnActive 永远不为真）。turn.start 让这件事回到唯一真相 —— 事件流。 */
  | { k: 'turn.start' }
  | { k: 'text.delta'; text: string }
  | { k: 'text.done'; text: string }
  | { k: 'thinking'; tokens: number }
  | { k: 'exec.start'; execId: string; label: string; detail: string }
  | { k: 'exec.done'; execId: string; ok: boolean; output: string }
  | {
      k: 'approval.request'
      approvalId: string
      kind: 'exec' | 'patch' | 'tool'
      title: string
      detail: string
      cwd: string
    }
  | { k: 'approval.resolved'; approvalId: string; decision: 'allow' | 'deny' }
  | { k: 'turn.done'; usage: Usage; costUsd?: number }
  /** 订阅额度窗口的状态。**这是 CLI 主动报的，不是我们算的。**
   *
   *  实测的 payload（2026-08-17，Claude 的 rate_limit_event）：
   *    { status:'allowed', resetsAt:1786996800, rateLimitType:'five_hour',
   *      overageStatus:'rejected', overageDisabledReason:'out_of_credits',
   *      isUsingOverage:false }
   *
   *  **字段是按需出现的，不能假设都在**。实测两种形态：
   *    five_hour: { status:'allowed', resetsAt, rateLimitType }            ← 没有用量
   *    seven_day: { status:'allowed_warning', resetsAt, rateLimitType,
   *                 utilization:0.79, surpassedThreshold:0.75 }            ← 有用量
   *  所以 utilization 是可选的：有就显示进度，没有就只显示窗口和重置时间，
   *  **绝不拿别的字段倒推一个百分比**。 */
  | {
      k: 'quota'
      /** 哪个窗口。CLI 报什么就是什么（five_hour / weekly / …），不做枚举——
       *  枚举漏了一种新窗口就会被静默丢掉，而这是要显示给用户看的信息。 */
      window: string
      /** 还能用 / 已经超了 / 正在用超额度。同样原样透传 */
      status: string
      /** 这个窗口什么时候重置（Unix 秒）。拿不到就是 undefined */
      resetsAt?: number
      /** 已用比例 0~1。**不是每条都有** —— 实测五小时那条没带，
       *  七天那条带了（`utilization: 0.79`，同时 status 是 allowed_warning）。
       *  拿不到就是 undefined，界面据此决定显不显示进度，绝不拿别的字段推算。 */
      utilization?: number
    }
  /**
   * **CLI 把上下文压缩了。** Claude Code 的 `system/compact_boundary`。
   *
   * 为什么必须接住它（2026-08-28）：压缩之后模型只剩一份摘要，可界面上的 turns
   * 一条不少地摆着——**人看着满屏历史会以为它记得**，而那正是本仓库在
   * `contextLostOf` 注释里已经判过「比空白更糟」的那种状态。压缩只是同一个问题的
   * 另一个入口，之前没覆盖到。
   *
   * **绝大多数是自动触发的**：实测本机 transcript 68 次压缩里 62 次 trigger='auto'
   * ——也就是说这件事在用户完全不知情时反复发生，界面和模型的记忆一路越走越远。
   *
   * 顺带也是内存问题：那 68 次累计丢掉 6588 万 token，app 这边一个字节都没释放。
   *
   * **Codex 没有对应信号**（记录格式与落点跟 Claude 完全不同，见 agentHistory.ts），
   * 所以这条只会来自 Claude；Codex 那边靠 reduce.ts 的内存上限兜底。
   */
  | {
      k: 'compacted'
      /** 'auto' = 上下文满了 CLI 自己压的；'manual' = 用户点了压缩；
       *  **null = 不知道** —— 2026-08-29 实测：stream-json 里的 compact_boundary
       *  **不带 compactMetadata**（transcript 里那份带），所以多数时候就是不知道。
       *  不知道时界面必须说中性的话，不能默认说成「自动」——我发的明明是 /compact。 */
      trigger: 'auto' | 'manual' | null
      /** 压缩前后的 token 数。**同样经常拿不到**（metadata 缺席时为 0），
       *  为 0 就不显示，不编 */
      preTokens: number
      postTokens: number
    }
  /**
   * **从别处（目前只有手机端）发进这个会话的一条用户消息。**
   *
   * ── 为什么需要一个专门的事件 ────────────────────────────────────
   * 桌面端自己发的消息**不走这条**：AgentChatView 在调 send 之前就乐观插进对话流了
   *（失败会撤回）。那份记录是组件本地的 state。
   *
   * 手机发的没有这个入口 —— 消息直接进主进程、送给 CLI，桌面那侧一无所知。
   * 不补这条事件的话，你回到电脑前会看到 AI 在回答一个界面上不存在的问题。
   *
   * ── 为什么它能在面板没开着的时候也不丢 ──────────────────────────
   * 走事件流就自动被 preload 的按会话缓冲接住（每会话 1000 条，订阅时回放）——
   * 那套本来是为「切走再切回来」做的，这里正好复用：
   * 面板没挂载时消息先攒着，你把节点打开它就补进对话流里。
   *
   * ── 归约器的例外 ────────────────────────────────────────────────
   * reduce.ts 原本**从不产出用户消息**（见 MessageList 头部）。这是唯一的例外，
   * 而且是显式的：只有带这个 k 的事件才会造出 role:'user' 的轮次，
   * 不是从别的事件里推断出来的。
   */
  | { k: 'user.message'; text: string }
  | {
      k: 'error'
      message: string
      fatal: boolean
      /** 这条错误属于哪一类。**给界面用来分支，而不是让它去匹配 message 里的中文** ——
       *  文案随时会改，匹配文案的代码坏掉时不会有任何报错。不带这个字段就是普通错误。
       *
       *  · `'auth'`  —— 没登录 / 登录失效。界面据此摆出**登录**入口。
       *  · `'setup'` —— 还没配好（没选 provider、没填 key、密钥柜锁着）。界面摆的是
       *    **设置**入口，不是登录入口 —— 这两件事对用户是完全不同的动作，而
       *    `ChatToolbar` 对 `'auth'` 渲染的「去登录」按钮会把人引到 `CliLoginPanel`，
       *    那条路对「靠 provider key 起会话」的 CLI 根本走不通（`cliAuth` 那套只认
       *    claude / codex）。所以它必须是独立的一类，不能复用 'auth'。 */
      kind?: 'auth' | 'setup'
    }
  /**
   * **这个 CLI 能用哪些模型 / 强度档，是它自己在会话建立时报的。**
   *
   * `CliCapabilities.models` 那份是**静态清单**，写死在 adapter 里 —— 对 Claude 与 Codex
   * 够用（模型名基本不变），但装不下「provider × model 动态组合」那种：同一个 CLI 换个
   * provider，能选的模型整份都不一样，而这件事只有会话真的建立起来之后才知道。
   *
   * 所以多一条事件：**拿得到就报，界面用它覆盖静态清单**。判据是「这条事件来过没有」，
   * 不是 CLI 的名字 —— 不报的 CLI（Claude / Codex）行为一个字不变。
   */
  | {
      k: 'capabilities'
      models?: { id: string; label: string }[]
      effortLevels?: { id: string; label: string }[]
    }

/** 宿主进程的几个路径事实。**由 session.ts 注入，adapter 不自己去算** ——
 *  理由与 `StartOpts.mcpConfigPath` 那条逐字相同：adapter 有独立单测、跑在纯 node 环境里，
 *  import `electron` 会把整个主进程那套拉进来。
 *
 *  这是「随包资源在哪、用户数据在哪」的通用事实，**不含任何 CLI 名字**。
 *  走 PATH 探测的 CLI（Claude / Codex）用不到它，`detect()` 的实现签名可以不收这个参数
 *  —— TS 允许实现比接口少一个形参，所以那两个 adapter 一个字都不用改。 */
export interface HostPaths {
  /** `app.isPackaged` */
  isPackaged: boolean
  /** `process.resourcesPath`。**dev 下是 undefined**，所以这里允许空串，取路径的一方要能接住 */
  resourcesPath: string
  /** `app.getAppPath()`（dev 时 = 仓库根） */
  appPath: string
  /** `app.getPath('userData')` */
  userData: string
  /** `app.getPath('home')`。**随包 CLI 的配置目录若按「相对 HOME」解析，这个值必须与
   *  spawn 时传给子进程的 `HOME` 同源** —— `agentRules.ts` 记着一次实测事故：
   *  `os.homedir()` 跟随 `$HOME`、`app.getPath('home')` 不跟随，两者分叉过。 */
  home: string
}

/** 一个会话累计到此刻的统计。**给数据层留的口子**，不是给工具栏用的
 *  （工具栏的 `formatUsage` 只显示 token 与花费，从不读上下文比例）。
 *
 *  **这里刻意没有 `costUsd`**：花费已经有唯一出口 —— `turn.done.costUsd` 经
 *  `handleEvent` 进 `SessionRecord.tally`。两处都放同一个数，跨会话求和的代码
 *  （`mcpHandler` 今天就在对 `tally.costUsd` 求和）迟早会把它加两遍。 */
export interface SessionStats {
  /** 上下文窗口大小（分母）。拿不到就不填，绝不猜 */
  contextWindow?: number
  /** 当前占用（分子） */
  contextUsed?: number
  /** 币种。CLI 报什么就是什么；留这个字段是为了不让数据层自己假定美元 */
  currency?: string
}

export interface CliCapabilities {
  models?: { id: string; label: string }[]
  effortLevels?: { id: string; label: string }[]
  compact?: 'slash' | 'native' | false
  contextUsage: boolean
  /** 空数组 = 这个 CLI 做不了逐次审批，UI 退回显示沙箱级别选择 */
  approval: ('exec' | 'patch' | 'tool')[]
  /** approval 为空时 UI 退回显示的沙箱级别选项。approval 为空却不给这个字段，UI 会显示一片空白。 */
  sandboxLevels?: { id: string; label: string }[]
}

export interface StartOpts {
  cwd: string
  model?: string
  effort?: string
  resumeId?: string
  /** 对应 capabilities.sandboxLevels 里某一项的 id（如 Codex 的 workspace-write） */
  sandbox?: string
  /** 跳过安装审批 hook。用户在 B 的询问卡片上明确选了"这次不装"时用——那样的会话
   *  没有审批保护，session.ts 的 restartAndDeliver 会推一条 { k:'error', fatal:false }
   *  notice 让他知道（Ruling 14"告知而非阻断"同一条路径，不新造机制）。
   *  未给这个字段（undefined）时按 false 处理——没声明就是"照常装"，不能让老代码
   *  路径因为多了这个字段而意外改变行为。 */
  skipApprovalHook?: boolean
  /** 给 CLI 用的 MCP 配置文件路径（目前只含 eas-term，**不含用户全局的其它
   *  server**）。Claude 侧带着 `--strict-mcp-config`，没有它就等于一个 MCP 工具都没有 ——
   *  用户 2026-08-20 的原话：「MCP服务在AI对话窗口进行的时候好像也没有连接」。
   *
   *  **由上层（session.ts）注入而不是 adapter 自己去算**：adapter 有独立单测，
   *  跑在纯 node 环境里，import 主进程那套会把 electron 一起拉进去。 */
  mcpConfigPath?: string
  /** 「先问再做」模式（伪无头审批）。开了就把 ASK_FIRST_PROMPT 附进系统提示，
   *  让模型在动手前先说明并等回复 —— 不装 hook、不阻塞进程。
   *  与 skipApprovalHook 是两条独立的路：那条管硬拦截，这条管软约定。 */
  askFirst?: boolean
  /** 角色契约：这个角色产出什么、落在哪、什么算做完（`AgentRole.contract` 的原文）。
   *
   *  2026-09-03 加。此前这 8 个角色（工匠 / 验官 / 画师…）**只对终端里 ▶ 启动的
   *  agent 生效** —— `CanvasAgentBar` 把它拼进 `buildClaudeCmd()` 写进终端，
   *  AI 对话会话完全不吃。用户 2026-09-02：「转移到 AI 对话中的合适位置
   *  进行角色的注入这个 session」。
   *
   *  ⚠️ **它只在 spawn 时传一次**（和 OUTPUT_STYLE_PROMPT 同一条 flag）。
   *  也就是说**会话跑起来之后换角色是改不了的** —— 界面那侧因此规定
   *  「换角色 = 结束当前会话重开」（用户 2026-09-03 在 (a)(b)(c) 里选了 b）。
   *  别在这里加「中途生效」的错觉。 */
  roleContract?: string
  /** 角色的工具边界（`AgentRole.tools`）。
   *
   *  ⚠️ **和 roleContract 有一条关键区别：它回溯时也要拼。**
   *  契约走系统提示，而 `--resume` 不重放系统提示，加了也是白加；
   *  工具边界是 **CLI 层的强制规则**，每次启动都重新生效 ——
   *  恢复会话时不拼，等于把护栏卸了。（这条结论来自终端那条路，
   *  `CanvasAgentBar.buildClaudeCmd` 里有同样的注释。）
   *
   *  三个 CLI 能力不对等，各自的落法见各 adapter：
   *    · Claude —— `--allowedTools` / `--disallowedTools`，支持工具名与通配
   *    · Codex  —— **没有工具级开关**（实测 tools.deny / allowed_tools 都是
   *                unknown field），只能整个关掉某个 MCP server
   *    · omp    —— `--tools` 是**白名单**，与这里的黑名单语义相反，要做减法 */
  roleTools?: { allow?: string[]; deny?: string[]; denyServers?: string[] }
  /** 角色的能力意图 + 原始逃生口（v2）。由 `shared/roleBinding.ts` 的 `bindRole` 翻成各家参数。
   *  **恢复会话时也要拼**（同 roleTools 那条理由：它是 CLI 层的强制规则，不是系统提示）。 */
  roleBounds?: RoleBounds
  /** 本机实际配置的 MCP server 名（Codex 用：名字不存在会拒绝启动，下发前按它过滤；
   *  通配 → server 名的降级匹配也靠它）。由 session.ts 起会话时算好。 */
  knownMcpServers?: string[]
}

/** 把 IPC 传来的 `roleTools` 洗成可信的形状。
 *
 *  **它直接决定安全边界，所以不猜、不修补、不部分接受。**
 *  params 来自 `unknown`（渲染进程可以传任何东西）。三条规矩：
 *
 *  1. 不是对象、或三个字段都不是字符串数组 → 一律 `undefined`（当没给）。
 *  2. **数组里混进非字符串就把那一条整个丢掉**，不做「过滤掉坏元素、留下好的」——
 *     那种「部分接受」在安全边界上最危险：调用方以为限制生效了，
 *     实际上少了几条，而没有任何报错。
 *  3. 空数组等于没有那一条。
 *
 *  放在 shared 而不是 session.ts：这里零依赖、进得了 `node --test`，
 *  而 session.ts 拖着 electron。 */
export function safeRoleTools(raw: unknown): StartOpts['roleTools'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const list = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v) || !v.length) return undefined
    // 混进非字符串 → 整条丢掉（见上面第 2 条）
    return v.every((x) => typeof x === 'string' && x) ? (v as string[]) : undefined
  }
  const out = {
    allow: list(r.allow),
    deny: list(r.deny),
    denyServers: list(r.denyServers)
  }
  return out.allow || out.deny || out.denyServers ? out : undefined
}

/** `roleBounds` 的 IPC 清洗。三条规矩与 safeRoleTools 相同：不是对象当没给；
 *  清单混进非字符串整条丢（不部分接受）；空的当没有。caps 只认 `false`。 */
export function safeRoleBounds(raw: unknown): RoleBounds | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as { caps?: unknown; raw?: unknown }
  const list = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v) || !v.length) return undefined
    return v.every((x) => typeof x === 'string' && x) ? (v as string[]) : undefined
  }
  const out: RoleBounds = {}
  if (r.caps && typeof r.caps === 'object' && !Array.isArray(r.caps)) {
    const c = r.caps as Record<string, unknown>
    const caps: RoleCaps = {}
    if (c.write === false) caps.write = false
    if (c.shell === false) caps.shell = false
    if (c.imageGen === false) caps.imageGen = false
    const m = (c.mcp ?? {}) as Record<string, unknown>
    const denyServers = list(m.denyServers)
    const denyTools = list(m.denyTools)
    if (denyServers || denyTools) caps.mcp = { ...(denyServers ? { denyServers } : {}), ...(denyTools ? { denyTools } : {}) }
    if (Object.keys(caps).length) out.caps = caps
  }
  if (r.raw && typeof r.raw === 'object' && !Array.isArray(r.raw)) {
    const x = r.raw as Record<string, Record<string, unknown> | undefined>
    const rawOut: RoleRaw = {}
    const cd = list(x.claude?.deny)
    const xd = list(x.codex?.disable)
    const od = list(x.omp?.removeTools)
    if (cd) rawOut.claude = { deny: cd }
    if (xd) rawOut.codex = { disable: xd }
    if (od) rawOut.omp = { removeTools: od }
    if (Object.keys(rawOut).length) out.raw = rawOut
  }
  return out.caps || out.raw ? out : undefined
}

/** 把一个 CLI 的原生输出行翻译成 ChatEvent 的最小契约。claudeEvents.ts / codexEvents.ts
 *  各自的 ClaudeTranslator / CodexTranslator 接口与这个结构完全一致（结构类型，不需要
 *  显式声明实现关系），这里单独声明一份只是为了给 CliAdapter.createTranslator 一个
 *  与 CLI 无关的返回类型名字。 */
export interface ChatEventTranslator {
  /** 喂一行原始 stdout。返回 0~N 个中间事件；任何解析失败都返回空数组，绝不抛。 */
  push(line: string): ChatEvent[]
}

export interface CliAdapter {
  id: string
  displayName: string
  capabilities: CliCapabilities
  /** 这台机器上能不能用。
   *  `host` 是**可选参数**：随包分发的 CLI 用它算绝对路径，走 PATH 探测的忽略。
   *  TS 允许实现签名少一个形参，所以 claude.ts / codex.ts 的 `detect()` 不用改。
   *  **实现里 `host` 为空时必须返回 false 而不是抛** —— `adapters.test.ts` 会无参调用它。 */
  detect(host?: HostPaths): Promise<boolean>
  /** 这个 CLI 走哪种传输。不声明 = 现状：stdout 逐行喂 `createTranslator()` 的翻译器、
   *  stdin 写 CLI 自己的 wire format。`'acp'` = 双向 JSON-RPC，进程与收发由独立的
   *  transport 负责，**不经过 `feed()` 与 `writeStdin()`**。
   *
   *  **这是能力位，不是 CLI 名字** —— 调用点判的是这个字段，不是 `id === 'omp'`。 */
  transport?: 'acp'
  /** 怎么算「配好了、能开始对话」。不声明按 `'cli-login'` 处理（= 现状：`cliAuth` 那套
   *  探测 CLI 自己的登录态）。`'provider-key'` = 要先选模型服务商、填一把 key，
   *  界面走独立的设置面板，**不能进 `CliLoginPanel`**（那条路只认 claude / codex）。
   *
   *  判据一律写成 `!== 'provider-key'` 走老路 —— 缺省即老行为，新字段不改任何现状。 */
  auth?: 'cli-login' | 'provider-key'
  /** 随软件一起分发、不用用户自己装。真值时 `installCmd` 没有意义，
   *  而且**默认选择要避开它**：随包的 CLI `available` 恒真，让它排在前面会把
   *  「只装了 Claude 的老用户」的每个新会话都换掉。 */
  bundled?: true
  /** 额度从哪来。不声明 = 现状（Claude 走直连接口、Codex 读它自己的日志）。 */
  quotaSource?: 'omp-usage'
  /** 拼装启动这个 CLI 的命令行。进程由 session.ts 统一 spawn。
   *  stdin 必填（不给可选，是怕下一个 CLI 接入时又忘记声明）——每个 CLI 怎么用 stdin
   *  是它自己的怪癖，adapter 知道，下游不该替它记：
   *  'pipe'   = stdin 是活跃通道，spawn 后要保持打开、持续往里写（Claude 用它送
   *             --input-format stream-json 的逐行消息）；
   *  'ignore' = 必须让 stdin 直接关闭/接 /dev/null，不能留给下游"不管"。
   *             实测 Codex `exec` 不给会卡死在 `Reading additional input from stdin...`。 */
  buildArgs(opts: StartOpts): { bin: string; args: string[]; stdin: 'pipe' | 'ignore' }
  /** 这个 CLI 的原生输出行怎么翻译成 ChatEvent——只有 adapter 自己知道自己的 wire
   *  format，下游（session.ts）不该按 CLI id 分支去挑用哪个翻译器（2026-08-14 全分支
   *  评审 I6 第 1 点：Ruling 10 给 stdin 立的原则逐字适用——adapter 知道自己怎么工作，
   *  不靠下游记住每个 CLI 的怪癖。每次调用返回一个新的、带独立内部状态的实例——节流/
   *  去重这类状态是每个会话各自的，不能跨会话共享一个翻译器）。 */
  createTranslator(): ChatEventTranslator
  /** 逐次审批要不要装 Claude Code 风格的 PreToolUse hook 文件（<cwd>/.claude/settings.json，
   *  见 session.ts 的 installApprovalHook）。**与 capabilities.approval 是两件不同的事**：
   *  capabilities.approval 非空只代表"这个 CLI 有细粒度审批能力"，不代表"实现方式是装
   *  这个 hook 文件"（2026-08-14 全分支评审 I6 第 2 点：把这两者混成一个布尔，是 C1 那个
   *  Critical 的根——以后 Codex app-server 落地会声明 approval:['exec']，但它的审批握手
   *  走自己的协议，不该被这个字段之外的任何判断误当成"要装 Claude 的 hook"）。
   *  没有这个字段 = 不装任何 hook。 */
  approvalHook?: 'claude-pretooluse'
  /** 会话跑起来之后怎么改模型 / effort。
   *
   *  `'slash'` = 这个 CLI 认 `/model x`、`/effort x` 这类会话内命令，往 stdin 一写
   *  就换，**不用重启进程、不丢上下文**。2026-08-17 实测确认 Claude 在 headless
   *  （`-p --input-format stream-json`）下同样吃这套：发 `/model haiku` 之后 CLI 会
   *  重推一个 init 事件、里面的 model 就是新值，下一条消息真的用新模型跑。
   *
   *  不声明 = 只能重启带启动参数（Codex 的 `exec` 是一次性的，压根没有会话内命令）。
   *
   *  `'acp-config'` = 走 ACP 的 `session/set_config_option`（请求/响应，不用静默期、
   *  不用猜回执）。**改完要就地回写 `SessionRecord.model / effort`** —— 与 slash 那条
   *  路同一个坑：不回写的话，空闲回收后 restart 会悄悄退回旧模型，而界面还显示着新的。
   *
   *  **这是能力声明，不是 CLI 名字**——调用点判的是这个字段，不是 `id === 'claude'`。 */
  paramChange?: 'slash' | 'acp-config'
}

// ── session.ts 的 IPC 面用到的形状（Task 8）。放共享文件是因为 preload 和主进程
//    两边都要用同一份，和 StartOpts/ChatEvent 一样的理由。 ──────────────────────

/** agentChat:start 的入参：StartOpts 的字段（cwd/model/effort/resumeId/sandbox）
 *  再加上要跑哪个 CLI 和第一条消息。message 必填——Codex 的 exec 需要它作为启动时的
 *  位置参数，没法留到"启动后再补"（不像 Claude 能后写 stdin）。 */
export interface AgentChatStartParams extends StartOpts {
  cli: string
  message: string
  /** 团队派生的会话在这里自报身份。**不放进 StartOpts** —— StartOpts 是「这个进程
   *  怎么起」（cwd/model/sandbox…，effectiveOpts 会拿它重算 buildArgs），而身份不影响
   *  进程怎么跑，它只是记在会话上的元数据。混进去会让 restart 路径去关心一件与它无关
   *  的事。 */
  owner?: 'team'
  role?: string
  /** 这次会话要带的插件（PluginInfo.id，如 `claude:figma`）。
   *
   *  **一次只带一个**（用户 2026-08-24 定死）：已装插件可以有几十上百个，
   *  全带进工具面会把系统提示词撑爆 —— 画板那 52 个工具已经让单轮输入涨了约 39k token。
   *
   *  和 owner/role 一样**不放进 StartOpts**：它不影响「这个进程怎么起」，
   *  只影响主进程为它生成哪一份 MCP 配置。 */
  pluginId?: string
}

/** 事件推送用的**单一常驻频道**（不是 `agentChat:event:<sessionId>` 那种按会话动态命名的）。
 *  2026-08-17 全分支最终评审 C1：动态频道要求「先拿到 sessionId、再挂监听」，而主进程的
 *  `agentChat:start` handler 在 `return` 之前就已经同步推完了首批事件（deliverMessage →
 *  restartAndDeliver → handleEvent）——事件先到、频道上一个监听器都没有，Electron 的
 *  send/on 不缓冲，直接丢弃。评审用隔离 Electron 探针实测过这个窗口：同步推的组
 *  30 条只捕获到 1 条。丢掉的正好是「本次会话没有审批保护」那条硬验收 notice。
 *
 *  改成常驻单频道之后，preload 在**模块加载期**（远早于任何 invoke）就把唯一的监听器挂上，
 *  按 payload 里的 sessionId 路由：有订阅者就直接投递，没有就先缓冲、等 onEvent 来取。
 *  「订阅之前的事件」结构上不可能丢，不再依赖任何时序假设。
 *
 *  **别把它改回按 sessionId 命名的动态频道**——那等于把正确性重新建立在
 *  「用户手速不够快」「spawn 一定比 IPC reply 慢」这类没有保证的假设上。 */
export const AGENT_CHAT_EVENT_CHANNEL = 'agentChat:event'

/** 常驻频道上的信封：事件本体 + 它属于哪个会话（动态频道时代这个信息由频道名承载）。 */
export interface AgentChatEventEnvelope {
  sessionId: string
  event: ChatEvent
}

export type AgentChatStartResult = { ok: true; sessionId: string } | { ok: false; error: string }

export type AgentChatSendResult = { ok: true } | { ok: false; error: string }

/** 「AI 会话审批」PreToolUse hook 在某个项目（cwd）下的安装状态。
 *  与 shared/types.ts 的 HookStatus（"提交即复盘"钩子，全局装在 ~/.claude 或 ~/.codex 一份）
 *  是两回事——这条 hook 是按项目装进 <cwd>/.claude/settings.json 的，所以状态也按 cwd 查，
 *  不是全局唯一一份（2026-08-14 全分支评审 C1 ③：对齐既有 hook:status 的形状）。 */
export interface AgentApprovalHookStatus {
  installed: boolean
  /** 装了，但命令路径对不上（换过安装位置）或落在了错误的 matcher 分组——需要重装 */
  outdated: boolean
  /** 写到哪个文件了——界面要如实告诉用户我们动了他哪份配置 */
  configPath: string
}

// ── B 的 Task 0：渲染层查询「有哪些 CLI 可用、各自会什么」的形状（agentChat:listClis）。
//    CliAdapter 本身只活在主进程（listAdapters()/getAdapter() 在 adapters/index.ts），
//    渲染层够不着——detect/buildArgs/createTranslator 这些函数字段也没法结构化克隆过 IPC。
//    这里补一份能安全跨 IPC 传的精简形状，只留 UI 真正要用的四个字段。 ─────────────────

/** agentChat:listClis 的返回元素：一个 CLI 的身份 + 可用性 + 能力声明。
 *  capabilities 原样来自对应 CliAdapter.capabilities——UI 靠它决定渲染哪些控件
 *  （有没有模型选择、有没有 effort、要不要显示沙箱级别），是"加第三个 CLI 时 UI 一行
 *  不改"这条机制的输入。 */
export interface CliInfo {
  id: string
  displayName: string
  /** 这台机器上装了没有。**false 不等于「不显示」** —— 用户第一次打开软件时
   *  本来就一个都没装，那时候更需要看见「有哪些可选」。渲染层按它决定
   *  「正常可点」还是「置灰 + 一键安装」，不是拿它做过滤。 */
  available: boolean
  /**
   * 能不能被 Eas-Term 直接驱动跑会话（面 6）。
   *
   * **和 available 是两件事**：available=false 是「装上就能用」，
   * chatSupported=false 是「装了也不能用在这儿」：headless 只打印最终消息、
   * 没有流式和工具事件的 CLI 写不出 adapter，但在终端里仍能用上全部 MCP 能力。
   * 两者混成一个布尔的话，用户会照着提示去装一个装了也选不了的东西。
   */
  chatSupported: boolean
  /** 没装时给的一句安装命令（预填进终端，**不代跑**）。已装的为 undefined。 */
  installCmd?: string
  /** chatSupported=false 时，一句话说明它能用在哪 */
  scopeNote?: string
  capabilities: CliCapabilities
  /** 原样透传 CliAdapter.approvalHook——**UI 判断"审批那一块该不该出现"唯一正确的依据**
   *  （2026-08-17 全分支最终评审 I2/I3）。
   *
   *  在这个字段存在之前，渲染层只能拿 `capabilities.approval.length > 0` 当替身，
   *  而主进程真正的判据是 `adapter.approvalHook === 'claude-pretooluse'`。今天两个
   *  adapter 恰好在这两个判据上重合，所以看不出来；第三个 CLI 一接进来就分叉：
   *  - I3：UI 弹「要不要装审批钩子」的卡片 → 用户点「不装」→ 主进程那个分支从不进入
   *    → 既不装、也不推 notice，用户以为自己拒绝了什么，实际什么都没发生；
   *  - I2：工具栏那个「审批保护 已开启/未开启」chip 与「卸载」按钮本来无条件渲染，
   *    在 Codex 节点上显示的是 **Claude** 的 hook 状态（Codex 走 exec --json、approval
   *    是空数组、根本没有逐次审批，权限由沙箱决定——工具栏另一侧同时还在显示沙箱级别，
   *    两条信息互相矛盾），点那个「卸载」删掉的也是 Claude 的 hook。
   *
   *  **这是能力声明，不是 CLI 名字**——UI 判 `approvalHook === 'claude-pretooluse'`
   *  不违反"UI 不许按 CLI 名字分支"这条硬约束，判 `id === 'claude'` 才违反。 */
  approvalHook?: CliAdapter['approvalHook']
  /** 原样透传 `CliAdapter.auth`。**渲染层判断「这个 CLI 该走哪条配置链路」唯一正确的依据。**
   *
   *  理由与上面 approvalHook 那条逐字相同：主进程那边的判据是 adapter 上的能力位，
   *  而渲染层手上只有 CliInfo —— 不透传的话它只能退回按 id 猜，那正是这份约束禁止的事。
   *
   *  **下游一律写成排除式**：`=== 'provider-key'` 走新路、其余一切走老路。
   *  反过来写 `=== 'cli-login'` 对**不声明这个字段的老 adapter 恒假**
   *  （Claude / Codex 都没声明），会把它们的登录预检整个跳过。
   *
   *  **`buildCliList` 一定会把它填成 `'cli-login'`**（有断言钉着），所以运行时
   *  拿到 undefined 是不可能的。类型上仍留可选，是为了不逼既有测试里那些
   *  手写的 CliInfo 字面量跟着改 —— 那批 fixture 与这个字段毫无关系。 */
  auth?: CliAdapter['auth']
  /** 原样透传 `CliAdapter.bundled`。渲染层拿它做**默认选择的排序**：
   *  随包的 CLI `available` 恒真（它就在安装包里，探测必过），让它参与
   *  「取第一个可用的」会把只登了 Claude 的老用户在升级当天全部换掉。
   *  判据是这个能力位，不是 id —— 将来再随包带第二个也照样成立。 */
  bundled?: CliAdapter['bundled']
  /** 原样透传 `CliAdapter.transport`。渲染层今天不用它，
   *  留着是为了让「这个 CLI 是不是走独立传输」在 UI 侧也能按能力位判，而不是按 id。 */
  transport?: CliAdapter['transport']
}

/** 附加给 CLI 的输出格式约定。
 *
 *  **为什么需要**：终端里跑 Claude Code 是看不到 emoji 的（它默认系统提示里有
 *  「除非用户要求否则不用 emoji」），但走 headless 这条路时那条约束没起作用，
 *  回答里会冒出 ✅📁 这类符号。与其在渲染层事后替换（那是在改模型说的话，
 *  而且 ✅/❌ 有时是在表达成败，一刀切会丢信息），不如让它一开始就别输出 ——
 *  跟用户在终端里的体验对齐。
 *
 *  顺带把层级也规范了：对话气泡宽度有限，模型爱用的一级标题 + 分隔线那一套
 *  是写文档的排版，铺在聊天里就是「被切碎」的观感。
 *
 *  **只有声明了 systemPromptFlag 的 CLI 用得上**（目前只有 Claude 的
 *  `--append-system-prompt`）。Codex 的 `exec` 没有等价开关，它只有位置参数 PROMPT
 *  —— 硬要注入就得污染用户消息本身，不做，见 codex.ts。 */
export const OUTPUT_STYLE_PROMPT = [
  '你的回答会显示在一个图形界面的对话气泡里（不是终端），按下面的约定输出：',
  '- 不要使用 emoji。需要表示成败或状态时用文字。',
  '- 标题最多用到三级（###），几句话能说完的回答直接写，不要套标题。',
  '- 不要使用水平分隔线（---）。',
  '- 文件名、路径、命令、标识符用行内代码标记。'
].join('\n')

/** 「先问再做」的系统提示 —— 设置里打开审批保护时附加上去。
 *
 *  **这是伪无头模式**：不装任何 hook、不阻塞任何工具调用，靠的是让模型自己
 *  在动手前把打算说出来、等你回一句。从 CLI 的角度它仍然是完全无头的
 *  （没有交互式权限提示、没有卡住的进程），从你的角度就是一次正常对话。
 *
 *  **和 PreToolUse hook 的取舍，写清楚免得以后有人当成等价替换**：
 *    hook  = 硬拦截。进程真的停在那里等你点，模型绕不过去；代价是要往用户项目里
 *            写 .claude/settings.json，而且每次工具调用都打断一次。
 *    这条  = 软约定。零侵入、体验就是对话；但它是**模型自愿遵守的**，
 *            没有任何机制保证它一定先问。
 *  所以设置里那句话必须如实说明这一点，不能让人以为开了就万无一失。 */
export const ASK_FIRST_PROMPT = [
  '在执行下列操作之前，先用一两句话说明你打算做什么，然后停下等我回复，不要直接动手：',
  '- 运行会改动文件或系统状态的命令',
  '- 创建、修改、删除文件',
  '- 任何不可逆或影响范围超出当前项目的操作',
  '只读的操作（查看文件、搜索、列目录）不用问，直接做。',
  '我回复「可以」「继续」或给出具体指示后，再执行。'
].join('\n')

/** 一个会话在「团队面板」上的一行。**只读快照**，不含任何能改状态的东西。
 *
 *  为什么不复用 SessionRecord：那是主进程的内部记录，带着 pending / skipApprovalHook
 *  这些只有 session.ts 关心的字段；面板要的是「谁、在哪、活着吗、多久没动了」。
 *  两者一起演进会让主进程的内部结构泄漏到渲染层。 */
import type { CostTally } from './teamCost'

export interface SessionBrief {
  id: string
  cli: string
  /** 这个会话累计到此刻的上下文占用等等。**给数据层的口子**，界面今天不读它。
   *  只有报得出这些的 CLI 才有（目前是 omp）；**刻意不含花费** —— 那个在 `tally` 里，
   *  见 shared 的 `SessionStats`。 */
  stats?: SessionStats
  cwd: string
  /** 进程还在不在。false = 被空闲回收或已退出，**但会话记录还在**（下次发消息能续上） */
  alive: boolean
  /** 最后一次有动静的时刻。面板拿它算「多久没动了」——**空闲/卡住**的信号来源。
   *  注意它不能用来算「跑了多久」：每块 stdout 都会续期，对活跃会话恒趋近 0。 */
  lastActiveAt: number
  /** 会话建立的时刻。「在跑」的行显示已运行时长用它，见 SessionRecord.startedAt */
  startedAt: number
  model?: string
  /** 会话的身份，由主进程持有 —— **不要改回从画布节点上取**。
   *  节点可以被关掉而进程还在跑（owner:'team' 的会话就是这么设计的），
   *  从节点取身份会让面板在那一刻失明。见 SessionRecord.owner 那段。 */
  owner?: 'team'
  /** 这次会话带的插件（PluginInfo.id）。**必须记在会话上、不能从节点取** ——
   *  restart 会重算 buildArgs 并重新生成 MCP 配置，那时若拿不到这个值，
   *  重启后的会话就悄悄丢掉了插件的工具（同 owner 那条的理由）。 */
  pluginId?: string
  role?: string
  /** 这一轮还没跑完。区分「干完了」和「卡住了」的唯一信号，见 SessionRecord.busy */
  busy?: boolean
  /** 进程是**怎么**没的：`'ok'` 跑完退出 / `'interrupted'` 中途断了。
   *  `undefined` = 还活着。判据见 SessionRecord.ended —— 面板靠它把
   *  「这轮完了」和「中断了」分开，自动收起也只敢收前者。 */
  ended?: 'ok' | 'interrupted'
  /** **它自己正在往回爬**：被打断了，而且还没试到头，稍后会自动重启并接上上下文。
   *  规则（退避、上限、要不要管）全在主进程的 planRecovery 里算 ——
   *  渲染层只需要知道「还有没有下文」，不该复制一份判据。 */
  recovering?: boolean
  /** 已经自动恢复了几次。面板用它把「第几次」显示出来，让人知道这不是卡着不动。 */
  retries?: number
  /** 这一轮里派过后台任务（Workflow / Task / Agent），还没等到它回来。
   *  见 SessionRecord.bgTask —— 空闲回收靠它把「在等 workflow」和「人走开了」分开。 */
  bgTask?: boolean
  /** 烧了多少。**token 是累加值、costUsd 是会话累计** —— 两者语义相反，
   *  别自己再加一次（实测见 shared/teamCost.ts） */
  tally?: CostTally
}
