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

export interface CliAdapter {
  id: string
  displayName: string
  capabilities: CliCapabilities
  detect(): Promise<boolean>
  /** 拼装启动这个 CLI 的命令行。进程由 session.ts 统一 spawn */
  buildArgs(opts: StartOpts): { bin: string; args: string[] }
}
