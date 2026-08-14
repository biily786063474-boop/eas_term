// 审批链路在 mcpBridge 里的路由逻辑：hook 脚本 POST /agent-approval/request 阻塞等决定，
// 渲染层 POST /agent-approval/resolve 把决定写回来。
//
// 背景（task-7-brief）：mcpBridge.ts 已经在 127.0.0.1 监听、用 x-eas-token 鉴权，这里只提供
// 两个端点各自需要的逻辑，由 mcpBridge.ts 的请求处理直接调用（同一进程内的函数调用，
// 不是再起一次 HTTP）。哪条 approvalId 对应哪个等待者，全放在本文件的模块级 Map 里。
//
// 边界（审查后补，修复轮）：本文件只负责「把 hook 送来的完整 payload 留住、并且能被订阅」——
// **不产出 ChatEvent，不 import createApprovalRegistry，不碰任何"会话"概念**。
// 谁来订阅、怎么把 payload 转成带 title/detail/kind 的 approval.request 事件推给渲染层，
// 是下一个任务（会话进程管理）的事，见下面的 onApprovalRequest。这条边界是特意划的：
// 早先的实现把 payload 解析出来只取了 approvalId 就丢弃，tool_name/tool_input/cwd
// ——审批卡片要显示的全部内容——全没了；修复时的诱惑是"干脆在这里也把 registry 接上"，
// 但那样会把 session 概念拖进这一层，所以只做到"留住数据 + 可订阅"为止。
//
// ⚠️ hookResponseBody 产出的响应体形状，与 resources/agent-hooks/responseBody.mjs 里
// 同名的函数必须保持逐字一致 —— hook 脚本是**独立的 Node 进程**，import 不到这份 TS 代码，
// 两边只能各写一份。**改一处必须改另一处**，这是跨进程边界所迫、已被裁定接受的重复
// （见 .superpowers/sdd/2026-08-14-会话内核/progress.md Ruling 2）。
// ⚠️ 同理，resources/agent-hooks/eas-pretooluse.mjs 里 fetch 用的超时字面量
// （FETCH_TIMEOUT_MS）是下面 APPROVAL_TIMEOUT_MS 的独立副本，import 不到，
// **改一处必须改另一处**。

import type { HookPayload } from './approvalRegistry.ts'

export type ApprovalDecision = 'allow' | 'deny'

/** 审批等待的超时上限，也是实际生效的上限。**兜底一律是 deny**，所以这个值不能短到
 *  让用户还在看卡片时就被自动拒绝——不短于一分钟（下面测试锁死）。取 5 分钟：参考
 *  mcpBridge.ts 里 wiki_archive_plan 的 10 分钟先例（同样是「等人在界面上点确认」的
 *  场景），但审批卡片比归档计划更轻量，5 分钟已经给足反应时间。
 *
 *  Task 7 审查阶段已实测：Claude Code 自身的 PreToolUse hook 在**没有显式声明 timeout
 *  字段**时不会在 60 秒掐断——真实测过让 hook 睡 70 秒，Claude 仍正常等到并拿到 allow、
 *  文件真的建了。所以不需要给 hookInstall.ts 装的条目额外加 timeout 字段（最初怀疑
 *  "Claude 侧会先在 60 秒超时"是错的，已被实测推翻）。
 *
 *  resources/agent-hooks/eas-pretooluse.mjs 里的 fetch 超时（FETCH_TIMEOUT_MS）是这个值
 *  的独立副本（外加一点缓冲，让服务端自己的超时先触发、给出更精确的 reason）——
 *  import 不到这个常量，改一处必须改另一处。 */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

/** 把任意输入归一化成决定。**兜底一律是 deny**——这是整条审批链路的安全底线：
 *  拿不到明确的 'allow'（值缺失、类型不对、拼错、被篡改）就一律当拒绝处理。
 *  前端崩了或用户没看见时默默放行一次写文件/跑命令，是这里最不能犯的错。 */
export function normalizeDecision(d: unknown): ApprovalDecision {
  return d === 'allow' ? 'allow' : 'deny'
}

/** hook 响应体：Claude Code 认的那个形状（实测确认过，见 task-7-brief）。
 *  ⚠️ 与 resources/agent-hooks/responseBody.mjs 的同名函数必须保持同一形状，
 *  改一处必须改另一处——hook 脚本是独立进程，import 不到这份代码。 */
export function hookResponseBody(decision: ApprovalDecision, reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  })
}

/** 从 hook 送来的原始请求体里取 tool_use_id，充当 approvalId（与 Task 3 的
 *  ApprovalRegistry 用同一个键，approvalRegistry.ts 里也是拿它当 approvalId）。
 *  形状上是 HookPayload，但这是外部进程经网络送进来的数据，运行时当 unknown 处理、
 *  不假设一定合法。 */
export function approvalIdOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const id = (payload as Partial<HookPayload>).tool_use_id
  return typeof id === 'string' ? id : ''
}

interface PendingApproval {
  /** hook 送来的完整原始 payload（不只是 approvalId）。上一轮审查的 Important 发现：
   *  这份数据曾经被解析出来又立刻丢弃，只留 approvalId，审批卡片需要显示的
   *  tool_name/tool_input/cwd 全没了。现在原样留着，通过 onApprovalRequest() 广播出去，
   *  由订阅方（Task 8 的 session.ts）喂给 approvalRegistry.ts 的
   *  createApprovalRegistry().fromHook()，转成带 title/detail/kind 的 approval.request
   *  事件推给渲染层——那一步转换需要认识"会话"，不是这一层的责任。 */
  payload: HookPayload
  resolve: (v: { decision: ApprovalDecision; reason: string }) => void
}

// approvalId → 等待中的请求（含原始 payload + resolver）。一个 approvalId 同一时刻只应该
// 有一个等待者（Claude 对同一次工具调用只起一个 hook 进程）；万一并发到达，后一次
// waitForApproval 会顶掉前一个等待者的引用，先到的那个不会串话——它自己的定时器仍在跑，
// 会在超时后独立兜底为 deny，只是永远等不到 resolveApproval 命中（这种情况理论上不应该发生）。
const waiters = new Map<string, PendingApproval>()

type ApprovalRequestListener = (payload: HookPayload) => void
const listeners = new Set<ApprovalRequestListener>()

/** 订阅"有一个新的审批请求到达、正在等决定"。回调拿到 hook 送来的完整 payload——
 *  这是本文件唯一对外广播 payload 的地方。**只负责广播，不做任何转换**：不产出
 *  ChatEvent，不认识"会话"是什么。订阅方（目前是 Task 8 的 session.ts）拿到 payload 后
 *  自己决定喂给哪个会话的 createApprovalRegistry()。
 *
 *  返回一个取消订阅函数。**通知发生在等待者已经登记进 waiters 之后**（见 waitForApproval
 *  内部顺序）——这样即使订阅方的回调里同步调用 resolveApproval，也一定能命中，不会
 *  因为"请求还没登记"被误判成"没有这个 approvalId"（下面有测试锁这个顺序）。 */
export function onApprovalRequest(cb: ApprovalRequestListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 挂起等待一个决定：登记等待者（含完整 payload）、起一个超时定时器、广播给订阅者，
 *  返回的 Promise 会在「被 resolveApproval() 命中」或「超时」之一发生时 settle。
 *  **超时兜底固定是 deny。** payload 里取不到合法 tool_use_id 时立即兜底 deny、
 *  不登记也不广播——没有 key 的请求没法被 resolve，登记了也只会占内存等到超时，
 *  广播出去也没人能拿它去调 resolveApproval。
 *  timeoutMs 默认取 APPROVAL_TIMEOUT_MS，暴露成参数只是为了让测试不必真等 5 分钟。 */
export function waitForApproval(
  payload: unknown,
  timeoutMs: number = APPROVAL_TIMEOUT_MS
): Promise<{ decision: ApprovalDecision; reason: string }> {
  const approvalId = approvalIdOf(payload)
  if (!approvalId) {
    return Promise.resolve({ decision: 'deny', reason: '请求缺少 tool_use_id' })
  }
  const hookPayload = payload as HookPayload
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(approvalId)
      resolve({ decision: 'deny', reason: '等待超时，Eas-Term 没能在限定时间内收到人工决定' })
    }, timeoutMs)
    waiters.set(approvalId, {
      payload: hookPayload,
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      }
    })
    // 必须在登记之后才通知订阅者——见上面 onApprovalRequest 的顺序说明
    for (const cb of listeners) cb(hookPayload)
  })
}

/** 渲染层给出的决定写回来。命中一个仍在等待的 approvalId 才返回 true 并 settle 对应的
 *  Promise；不在表里（已超时 / 已经被回过一次 / 压根没有这个请求）返回 false，
 *  不抛异常——调用方（mcpBridge 的 HTTP 处理）据此决定响应状态码。
 *  decision 经 normalizeDecision 兜底、reason 非字符串时归一化成空串，
 *  不直接信任渲染层传来的原始值。 */
export function resolveApproval(approvalId: unknown, decision: unknown, reason: unknown): boolean {
  const w = typeof approvalId === 'string' && approvalId ? waiters.get(approvalId) : undefined
  if (!w) return false
  waiters.delete(approvalId as string)
  w.resolve({ decision: normalizeDecision(decision), reason: typeof reason === 'string' ? reason : '' })
  return true
}
