// 把 Codex 的原生 `codex exec --json` 事件行翻译成与 CLI 无关的中间事件（ChatEvent）。
// 只做翻译，不做展示判断——和 claudeEvents.ts 同样的分工。
//
// 范围说明（读需求前必看）：
// - `Usage.contextRatio` 一律不填：`turn.completed` 里没有上下文窗口上限，没有分母，
//   宁可只显示累计 token 数，也不猜一个看起来精确、实则瞎猜的比例。
// - `costUsd` 一律不填（不是 0）：Codex 不报花费，0 会被 UI 读成「花了 $0」，是错误信息；
//   `undefined` 才如实表示「这个 CLI 不提供这个数据」。
// - 中间事件里不允许出现 Codex 专有的字段名（`thread_id`、`reasoning_output_tokens` 这类）——
//   它们只能在本文件内部出现，用来取值，不能作为 ChatEvent 字符串字段里可见的键名。
//   `label`/`detail`/`output` 里允许出现 item 自身的业务字段（如 file_change 的 `path`/`kind`），
//   这与 claudeEvents.ts 把 tool_use 的 `input` 整体塞进 `detail` 是同一处理方式——
//   那是「这次调用的内容」，不是「协议本身的私有概念」。
//
// item.started 的过滤规则（`command_execution` / `file_change` 才算「命令/补丁类」）是按
// brief 的字面表述（"命令/补丁类"）加本任务夹具（只验证了 file_change）推出来的，
// `command_execution` 没有夹具可核对字段名是否准确，见任务报告「顾虑」一节。

import path from 'node:path'
import type { ChatEvent, Usage } from '../../shared/agentChat.ts'

export interface CodexTranslator {
  /** 喂一行原始 stdout。返回 0~N 个中间事件；任何解析失败都返回空数组，绝不抛。 */
  push(line: string): ChatEvent[]
}

/** item.started 只有这些类型才当作「正在执行」产出 exec.start——其余（如 agent_message）没有 item.started 语义。 */
const EXEC_LIKE_ITEM_TYPES = new Set(['command_execution', 'file_change'])

export function createCodexTranslator(): CodexTranslator {
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
      case 'thread.started':
        return translateThreadStarted(j)
      case 'turn.started':
        // 一轮开始，本身不携带任何值得展示的信息，不产出事件
        return []
      case 'item.started':
        return translateItemStarted(j)
      case 'item.completed':
        return translateItemCompleted(j)
      case 'turn.completed':
        return translateTurnCompleted(j)
      default:
        return []
    }
  }

  return { push }
}

// ---- thread.started ----

function translateThreadStarted(j: Record<string, unknown>): ChatEvent[] {
  const sessionId = j.thread_id
  if (typeof sessionId !== 'string' || !sessionId) return []
  // model/cwd 这条事件里没有，不能编造——留空串，等 session.ts 用启动参数补齐
  return [{ k: 'session.ready', sessionId, model: '', cwd: '' }]
}

// ---- item.started ----

function translateItemStarted(j: Record<string, unknown>): ChatEvent[] {
  const item = asRecord(j.item)
  if (!item) return []
  const id = item.id
  if (typeof id !== 'string' || !id) return []
  if (typeof item.type !== 'string' || !EXEC_LIKE_ITEM_TYPES.has(item.type)) return []
  return [{ k: 'exec.start', execId: id, label: labelFor(item), detail: safeStringify(item) }]
}

// ---- item.completed ----

function translateItemCompleted(j: Record<string, unknown>): ChatEvent[] {
  const item = asRecord(j.item)
  if (!item) return []

  if (item.type === 'agent_message') {
    return typeof item.text === 'string' && item.text.length > 0 ? [{ k: 'text.done', text: item.text }] : []
  }

  const id = item.id
  if (typeof id !== 'string' || !id) return []
  const ok = item.error === undefined || item.error === null
  return [{ k: 'exec.done', execId: id, ok, output: outputTextOf(item) }]
}

// ---- turn.completed ----

function translateTurnCompleted(j: Record<string, unknown>): ChatEvent[] {
  const u = asRecord(j.usage) ?? {}
  const usage: Usage = {
    inputTokens: numberOr(u.input_tokens, 0),
    outputTokens: numberOr(u.output_tokens, 0),
    cachedInputTokens: typeof u.cached_input_tokens === 'number' ? u.cached_input_tokens : undefined
    // contextRatio 不填——没有窗口上限，见文件头
  }
  // costUsd 明确留空（Codex 不报花费），不是 0——见文件头
  return [{ k: 'turn.done', usage, costUsd: undefined }]
}

// ---- 纯函数小工具 ----

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? {})
  } catch {
    return String(v)
  }
}

function outputTextOf(item: Record<string, unknown>): string {
  if (typeof item.error === 'string' && item.error) return item.error
  return safeStringify(item)
}

/** label 是给三行小字用的一句人话；完整信息另外放 detail。目前只有 file_change 有夹具可核对字段名。 */
function labelFor(item: Record<string, unknown>): string {
  if (item.type === 'file_change') {
    const changes = Array.isArray(item.changes) ? item.changes : []
    const first = asRecord(changes[0])
    const name = first ? baseNameOf(first.path) : ''
    if (name) {
      const verb = kindVerb(first?.kind)
      return changes.length > 1 ? `${verb} ${name} 等 ${changes.length} 处` : `${verb} ${name}`
    }
    return '修改文件'
  }
  return typeof item.type === 'string' ? item.type : ''
}

function kindVerb(kind: unknown): string {
  switch (kind) {
    case 'add':
      return '创建'
    case 'delete':
      return '删除'
    case 'update':
      return '修改'
    default:
      return '变更'
  }
}

function baseNameOf(filePath: unknown): string {
  return typeof filePath === 'string' && filePath.length > 0 ? path.basename(filePath) : ''
}
