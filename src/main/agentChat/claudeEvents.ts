// 把 Claude Code 的原生 stream-json 行翻译成与 CLI 无关的中间事件（ChatEvent）。
// 只做翻译，不做展示判断——label/detail 怎么拼是这里的事，怎么渲染是 UI 的事。
//
// 范围说明（读需求前必看）：
// - text.delta 本轮不实现：三份夹具都是在没带 --include-partial-messages 的情况下跑出来的，
//   没有 partial 事件可依据。assistant 的 text block 一律只产出 text.done。
// - approval.* 本翻译器完全不产出（2026-08-14 Ruling 4）：实测流里的 system:hook_started /
//   hook_response 只带 hook_id，而 hook 脚本那条独立的 HTTP 路径（POST 给 mcpBridge）payload
//   里是 tool_use_id——两路没有共同的关联键，缝不起来。审批因此完全由 hook 脚本那一路单独
//   驱动（approval.request 用 tool_use_id 当 approvalId，见 approvalRegistry.ts）。
//   流里的 hook_started / hook_response 不管 hook_event 是什么、也不管是不是真的 PreToolUse，
//   一律当噪音丢弃——和 SessionStart 那批噪音同等对待，不作任何特殊识别。

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
      case 'stream_event':
        return translateStreamEvent(j)
      case 'rate_limit_event':
        return translateRateLimit(j)
      default:
        return []
    }
  }

  // ---- rate_limit_event：订阅额度窗口 ----
  //
  // 实测 payload（2026-08-17）：
  //   { type:'rate_limit_event', rate_limit_info:{ status:'allowed',
  //     resetsAt:1786996800, rateLimitType:'five_hour', overageStatus:'rejected',
  //     overageDisabledReason:'out_of_credits', isUsingOverage:false } }
  //
  // **原样透传 window / status，不做枚举映射**：这是要显示给用户看的信息，
  // 枚举漏了一种新窗口类型就会被静默丢掉，而那正是用户最想知道的那次。
  function translateRateLimit(j: Record<string, unknown>): ChatEvent[] {
    const info = j.rate_limit_info
    if (!info || typeof info !== 'object') return []
    const r = info as Record<string, unknown>
    const window = typeof r.rateLimitType === 'string' ? r.rateLimitType : ''
    const status = typeof r.status === 'string' ? r.status : ''
    if (!window && !status) return [] // 两个都没有的话这条事件没有任何可显示的内容
    return [
      {
        k: 'quota',
        window,
        status,
        resetsAt: typeof r.resetsAt === 'number' ? r.resetsAt : undefined
      }
    ]
  }

  // ---- stream_event（--include-partial-messages 才有）----
  //
  // 增量文字。**只认 content_block_delta 里的 text_delta**，别的一律不产出：
  // message_start / content_block_start / content_block_stop / message_delta 这些
  // 是分块的骨架，没有可显示的内容；thinking_delta 是思考过程，不属于回答正文。
  //
  // 实测形状（2026-08-15 Task 9 探针，真跑出来的）：
  //   {"type":"stream_event","event":{"type":"content_block_delta","index":0,
  //     "delta":{"type":"text_delta","text":"你"}},"session_id":"…","uuid":"…"}
  //
  // **同一段文字最后还会以 assistant 事件再来一次完整版**（text.done）。两者都产出，
  // 由归约器负责「delta 攒出来的那段被随后的 done 覆盖而不是追加」——翻译器不做这个
  // 判断，它只做翻译（见文件头）。
  function translateStreamEvent(j: Record<string, unknown>): ChatEvent[] {
    const ev = j.event
    if (!ev || typeof ev !== 'object') return []
    const e = ev as Record<string, unknown>
    if (e.type !== 'content_block_delta') return []
    const d = e.delta
    if (!d || typeof d !== 'object') return []
    const delta = d as Record<string, unknown>
    if (delta.type !== 'text_delta') return []
    if (typeof delta.text !== 'string' || delta.text.length === 0) return []
    return [{ k: 'text.delta', text: delta.text }]
  }

  // ---- system:* ----

  function translateSystem(j: Record<string, unknown>): ChatEvent[] {
    switch (j.subtype) {
      case 'init':
        return translateInit(j)
      case 'thinking_tokens':
        return emitThinking(j.estimated_tokens)
      case 'hook_started':
      case 'hook_response':
        // 流里的 hook 事件一律不产出中间事件（见文件头 Ruling 4 说明）——不管 hook_event
        // 是不是 PreToolUse，这里都不做区分，直接当噪音丢弃。
        return []
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

  // ---- assistant ----

  function translateAssistant(j: Record<string, unknown>): ChatEvent[] {
    const content = getMessageContent(j)
    if (!content) return []
    const out: ChatEvent[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      // 空串不产出 text.done——空气泡是噪音，不是信息。这里与 codexEvents.ts 的
      // translateItemCompleted 对齐（它本来就要求 item.text.length > 0）——修复前两个
      // 翻译器对空文本的处理不一致：Codex 要求非空才产出，Claude 只要求是字符串
      // （2026-08-14 全分支评审「6 条小的」第 5 条）。
      if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
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
      cachedInputTokens: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined,
      contextRatio: contextRatioOf(j, u)
    }
    const costUsd = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined
    return [{ k: 'turn.done', usage, costUsd }]
  }

  /** 上下文占用比例。
   *
   *  spec §九 第 4 条当初写着「result 事件里有 usage，但**没有上下文窗口上限**，
   *  而占用比例需要分母……在拿到确定算法之前，UI 上不能显示一个编造的百分比」。
   *  **那条判断不成立**（2026-08-17 实测，也可能是字段后来才加的）：分母就在同一个
   *  result 事件里 —— `modelUsage[<model>].contextWindow`。实测样本：
   *    "modelUsage": { "claude-opus-5": { "contextWindow": 1000000,
   *                    "cacheReadInputTokens": 16011, "cacheCreationInputTokens": 30812, … } }
   *
   *  分子取「这一轮送进模型的全部输入」= input + cache_read + cache_creation。
   *  三者都实实在在占着上下文窗口，缓存只是让它们便宜，不是让它们不占地方。
   *
   *  **拿不到分母就返回 undefined，绝不用一个猜的窗口大小顶上** —— 那正是原来那条
   *  约束要防的事：一个看起来精确、实则编造的百分比比不显示更糟。 */
  function contextRatioOf(
    j: Record<string, unknown>,
    u: Record<string, unknown>
  ): number | undefined {
    const mu = j.modelUsage
    if (!mu || typeof mu !== 'object') return undefined
    // 一轮里理论上只有一个模型，但按最大的窗口取——多模型混用时用小的会算出虚高的占用
    let win = 0
    for (const v of Object.values(mu as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const w = (v as Record<string, unknown>).contextWindow
      if (typeof w === 'number' && w > win) win = w
    }
    if (win <= 0) return undefined
    const used =
      numberOr(u.input_tokens, 0) +
      numberOr(u.cache_read_input_tokens, 0) +
      numberOr(u.cache_creation_input_tokens, 0)
    if (used <= 0) return undefined
    // 夹到 [0,1]：模型换过、窗口变小的边缘情况下别让进度条冲出容器
    return Math.min(1, used / win)
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
