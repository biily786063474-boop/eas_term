// 待处理审批的登记表——不是「缝合器」。
// 背景（2026-08-14 实测证伪见 task-3 brief）：原计划假设审批信息分两路到达、按
// tool_use_id 缝合；实测流里的 hook 事件只有 hook_id，hook 脚本那一路才有
// tool_use_id，两路没有共同的关联键，缝不了。
//
// 所以这里只有一个输入源：hook 脚本回调的 HookPayload。
// - approval.request 只从 fromHook() 产生，approvalId 取 tool_use_id
// - approval.resolved 在我们自己调用 resolve() 回传决定时产生——我们知道回了
//   什么，不需要、也没有办法从流里读
// - Claude 流里的 PreToolUse hook 事件（system:hook_started / hook_response）
//   不经过这个模块，在 claudeEvents.ts 里就已经当噪音丢弃

import path from 'node:path'
import type { ChatEvent } from '../../shared/agentChat.ts'

export interface HookPayload {
  session_id: string
  cwd: string
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  /** Eas-Term 自己的会话标记（=spawn 时注入的 EAS_AGENT_CHAT_SESSION），由 hook 脚本
   *  附加在 Claude 原生 payload 之外，不是 Claude 协议的一部分。session.ts 用它直接点名
   *  找到会话，不必再靠 session_id 反查 resumeId（2026-08-14 全分支评审 C1 ①：那条路径
   *  在 session.ready 事件把 resumeId 落进 SessionRecord 之前会找不到会话）。
   *  本文件的 fromHook() 不使用这个字段——它只关心 tool_use_id/tool_name/tool_input/cwd。 */
  eas_session_id?: string
}

interface PendingApproval {
  kind: 'exec' | 'patch' | 'tool'
  title: string
  detail: string
  cwd: string
}

export interface ApprovalRegistry {
  /** 喂一条 hook payload。已登记过的 tool_use_id 返回空数组（不重复弹卡片）。 */
  fromHook(p: HookPayload): ChatEvent[]
  /** 回传决定。不在表里的 approvalId 返回空数组、不抛。 */
  resolve(approvalId: string, decision: 'allow' | 'deny'): ChatEvent[]
  pendingCount(): number
}

const PATCH_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])

export function createApprovalRegistry(): ApprovalRegistry {
  const pending = new Map<string, PendingApproval>()

  function fromHook(p: HookPayload): ChatEvent[] {
    if (!p || typeof p !== 'object') return []
    const approvalId = p.tool_use_id
    if (typeof approvalId !== 'string' || !approvalId) return []
    if (pending.has(approvalId)) return []

    const kind = kindOf(p.tool_name)
    const title = titleOf(kind, p.tool_name, p.tool_input)
    const detail = safeStringify(p.tool_input)
    const cwd = typeof p.cwd === 'string' ? p.cwd : ''

    pending.set(approvalId, { kind, title, detail, cwd })
    return [{ k: 'approval.request', approvalId, kind, title, detail, cwd }]
  }

  function resolve(approvalId: string, decision: 'allow' | 'deny'): ChatEvent[] {
    if (typeof approvalId !== 'string' || !approvalId) return []
    if (!pending.has(approvalId)) return []
    pending.delete(approvalId)
    return [{ k: 'approval.resolved', approvalId, decision }]
  }

  function pendingCount(): number {
    return pending.size
  }

  return { fromHook, resolve, pendingCount }
}

// ---- 纯函数小工具 ----

function kindOf(toolName: unknown): 'exec' | 'patch' | 'tool' {
  if (toolName === 'Bash') return 'exec'
  if (typeof toolName === 'string' && PATCH_TOOLS.has(toolName)) return 'patch'
  return 'tool'
}

function titleOf(kind: 'exec' | 'patch' | 'tool', toolName: unknown, toolInput: unknown): string {
  const i = (toolInput ?? {}) as Record<string, unknown>
  switch (kind) {
    case 'exec':
      return `运行 ${commandPreview(i.command)}`
    case 'patch':
      return `修改 ${baseNameOf(i.file_path)}`
    default:
      return typeof toolName === 'string' ? toolName : ''
  }
}

function commandPreview(command: unknown): string {
  return typeof command === 'string' ? command.slice(0, 60) : ''
}

function baseNameOf(filePath: unknown): string {
  return typeof filePath === 'string' && filePath.length > 0 ? path.basename(filePath) : ''
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? {})
  } catch {
    return String(v)
  }
}
