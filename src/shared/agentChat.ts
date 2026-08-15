// 通用 AI CLI 对话前端的中间事件模型。
// **这里不允许出现任何 CLI 特有的概念** —— 不能有 hookEventName / thread_id /
// tool_use_id 这类只有一边存在的字段。它们只属于 adapter 内部。
// 判据很简单：加第三个 CLI 时，这个文件不该需要改。

export interface Usage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  /** 上下文占用比例 0~1。**算法未定**（result 事件里没有窗口上限，见 spec §九 第 4 条）——
   *  拿到确定算法之前 adapter 一律不填这个字段，UI 只显示累计 token 数。
   *  宁可少显示，也不要显示一个看起来精确、实则猜的比例。 */
  contextRatio?: number
}

export type ChatEvent =
  | { k: 'session.ready'; sessionId: string; model: string; cwd: string }
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
  | { k: 'error'; message: string; fatal: boolean }

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
  detect(): Promise<boolean>
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
}

// ── session.ts 的 IPC 面用到的形状（Task 8）。放共享文件是因为 preload 和主进程
//    两边都要用同一份，和 StartOpts/ChatEvent 一样的理由。 ──────────────────────

/** agentChat:start 的入参：StartOpts 的字段（cwd/model/effort/resumeId/sandbox）
 *  再加上要跑哪个 CLI 和第一条消息。message 必填——Codex 的 exec 需要它作为启动时的
 *  位置参数，没法留到"启动后再补"（不像 Claude 能后写 stdin）。 */
export interface AgentChatStartParams extends StartOpts {
  cli: string
  message: string
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
  /** 探测结果缺失时为 false——宁可少显示一个选项，也不要让用户选一个装不上的 CLI 然后报错 */
  available: boolean
  capabilities: CliCapabilities
}
