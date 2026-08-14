// 把 Claude Code 的原生 stream-json 行翻译成与 CLI 无关的中间事件（ChatEvent）。
// 只做翻译，不做展示判断——label/detail 怎么拼是这里的事，怎么渲染是 UI 的事。
//
// 范围说明（读需求前必看）：
// - text.delta 本轮不实现：三份夹具都是在没带 --include-partial-messages 的情况下跑出来的，
//   没有 partial 事件可依据。assistant 的 text block 一律只产出 text.done。
// - approval.request 本翻译器不产出：设计文档（§四 A.3）写明它来自 PreToolUse hook 脚本
//   那条独立的 HTTP 路径（POST 给 mcpBridge），要与本流里的 hook_started/hook_response
//   按 tool_use_id 缝合，这是后续「审批事件缝合」任务的职责。这里的 hook_started/
//   hook_response 只用于识别「这是不是 PreToolUse」，PreToolUse 的 hook_response 转成
//   approval.resolved；hook_started 本身不携带任何可用于渲染的信息，一律丢弃。

import path from 'node:path'
import type { ChatEvent, Usage } from '../../shared/agentChat.ts'

export interface ClaudeTranslatorOptions {
  /** system:thinking_tokens 的节流窗口（毫秒）。默认 200——这条事件流实测极密集。 */
  thinkingThrottleMs?: number
}

export interface ClaudeTranslator {
  /** 喂一行原始 stdout。返回 0~N 个中间事件；任何解析失败都返回空数组，绝不抛。 */
  push(line: string): ChatEvent[]
}

const DEFAULT_THINKING_THROTTLE_MS = 200

export function createClaudeTranslator(opts?: ClaudeTranslatorOptions): ClaudeTranslator {
  const throttleMs = opts?.thinkingThrottleMs ?? DEFAULT_THINKING_THROTTLE_MS

  // 节流状态：上一次真正放行 thinking 事件的时间戳
  let lastThinkingEmitAt = 0

  // exec 去重：同一个 execId 只留一条 exec.done。
  // 存在的理由：被拒的工具调用会同时收到 system:permission_denied 和
  // user/tool_result{is_error:true} 两路信号（同一件事），只能留一条失败痕迹，
  // 否则 exec.start/exec.done 配对会被打乱成 1:2。
  const resolvedExecIds = new Set<string>()

  function push(line: string): ChatEvent[] {
    if (!line || !line.trim()) return []
    let j: unknown
    try {
      j = JSON.parse(line)
    } catch {
      return []
    }
    try {
      return translate(j as Record<string, unknown>)
    } catch {
      return []
    }
  }

  function translate(j: Record<string, unknown>): ChatEvent[] {
    switch (j.type) {
      case 'system':
        return translateSystem(j)
      case 'assistant':
        return translateAssistant(j)
      case 'user':
        return translateUser(j)
      case 'result':
        return translateResult(j)
      default:
        return []
    }
  }

  // ---- system:* ----

  function translateSystem(j: Record<string, unknown>): ChatEvent[] {
    switch (j.subtype) {
      case 'init':
        return translateInit(j)
      case 'thinking_tokens':
        return emitThinking(j.estimated_tokens)
      case 'hook_started':
        // PreToolUse 的 hook_started 也不携带 title/detail/cwd 之类可渲染信息，
        // approval.request 由 hook 脚本的 HTTP 路径产出（见文件头说明）。这里一律丢弃。
        return []
      case 'hook_response':
        return translateHookResponse(j)
      case 'permission_denied':
        return resolveExec(j.tool_use_id, false, j.message)
      default:
        return []
    }
  }

  function translateInit(j: Record<string, unknown>): ChatEvent[] {
    const sessionId = j.session_id
    const model = j.model
    const cwd = j.cwd
    if (typeof sessionId !== 'string' || typeof model !== 'string' || typeof cwd !== 'string') {
      return []
    }
    return [{ k: 'session.ready', sessionId, model, cwd }]
  }

  function emitThinking(estimatedTokens: unknown): ChatEvent[] {
    if (typeof estimatedTokens !== 'number') return []
    const now = Date.now()
    if (now - lastThinkingEmitAt < throttleMs) return []
    lastThinkingEmitAt = now
    return [{ k: 'thinking', tokens: estimatedTokens }]
  }

  function translateHookResponse(j: Record<string, unknown>): ChatEvent[] {
    // 先判过滤：用户机器上的 SessionStart 等 hook 噪音必须在这里挡住，
    // 只认 PreToolUse——其余一律丢弃。
    if (j.hook_event !== 'PreToolUse') return []
    const decision = parsePermissionDecision(j.output)
    if (!decision) return []
    const hookId = j.hook_id
    if (typeof hookId !== 'string' || !hookId) return []
    return [{ k: 'approval.resolved', approvalId: hookId, decision }]
  }

  function parsePermissionDecision(output: unknown): 'allow' | 'deny' | undefined {
    if (typeof output !== 'string' || !output.trim()) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(output)
    } catch {
      return undefined
    }
    const hookSpecificOutput = (parsed as Record<string, unknown> | null)?.['hookSpecificOutput'] as
      | Record<string, unknown>
      | undefined
    const decision = hookSpecificOutput?.['permissionDecision']
    // permissionDecision 的取值实测有 allow / deny / ask 三种；ask 代表「还没决定」，
    // 不是二元的 resolved，这里不产出事件（既不是 allow 也不是 deny）。
    if (decision === 'allow' || decision === 'deny') return decision
    return undefined
  }

  // ---- assistant ----

  function translateAssistant(j: Record<string, unknown>): ChatEvent[] {
    const content = getMessageContent(j)
    if (!content) return []
    const out: ChatEvent[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        out.push({ k: 'text.done', text: b.text })
      } else if (b.type === 'tool_use' && typeof b.id === 'string') {
        out.push({
          k: 'exec.start',
          execId: b.id,
          label: toLabel(b.name, b.input),
          detail: safeStringify(b.input)
        })
      }
      // thinking block：忽略。thinking 的量走 system:thinking_tokens，不走这里，
      // 否则同一份「思考」会被算两次。
    }
    return out
  }

  // ---- user ----

  function translateUser(j: Record<string, unknown>): ChatEvent[] {
    const content = getMessageContent(j)
    if (!content) return []
    const out: ChatEvent[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'tool_result') {
        out.push(...resolveExec(b.tool_use_id, !b.is_error, b.content))
      }
    }
    return out
  }

  // ---- result ----

  function translateResult(j: Record<string, unknown>): ChatEvent[] {
    const u = (j.usage ?? {}) as Record<string, unknown>
    const usage: Usage = {
      inputTokens: numberOr(u.input_tokens, 0),
      outputTokens: numberOr(u.output_tokens, 0),
      cachedInputTokens: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined
      // contextRatio 不填：result 事件没有上下文窗口上限，算法未定（spec §九 第 4 条），不许猜
    }
    const costUsd = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined
    return [{ k: 'turn.done', usage, costUsd }]
  }

  // ---- 共享小工具（闭包内，因为要访问 resolvedExecIds） ----

  /** system:permission_denied 与 user/tool_result 都走这里，靠 execId 去重只留一条 exec.done */
  function resolveExec(execId: unknown, ok: boolean, output: unknown): ChatEvent[] {
    if (typeof execId !== 'string' || !execId) return []
    if (resolvedExecIds.has(execId)) return []
    resolvedExecIds.add(execId)
    return [{ k: 'exec.done', execId, ok, output: toOutputText(output) }]
  }

  return { push }
}

// ---- 无状态的纯函数（不需要闭包） ----

function getMessageContent(j: Record<string, unknown>): unknown[] | undefined {
  const message = j.message
  if (!message || typeof message !== 'object') return undefined
  const content = (message as Record<string, unknown>).content
  return Array.isArray(content) ? content : undefined
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

function toOutputText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  return safeStringify(content)
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? {})
  } catch {
    return String(v)
  }
}

/** label 是给三行小字用的一句人话；detail（调用方）另外放完整 JSON。见 task-1 brief 的拼法约定。 */
function toLabel(name: unknown, input: unknown): string {
  const toolName = typeof name === 'string' ? name : ''
  const i = (input ?? {}) as Record<string, unknown>
  switch (toolName) {
    case 'Write':
      return `编辑 ${baseNameOf(i.file_path)}`
    case 'Bash':
      return `运行 ${commandPreview(i.command)}`
    case 'Read':
      return `读取 ${baseNameOf(i.file_path)}`
    default:
      return toolName
  }
}

function baseNameOf(filePath: unknown): string {
  return typeof filePath === 'string' && filePath.length > 0 ? path.basename(filePath) : ''
}

function commandPreview(command: unknown): string {
  return typeof command === 'string' ? command.slice(0, 40) : ''
}
