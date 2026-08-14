// 审批链路在 mcpBridge 里的路由逻辑：hook 脚本 POST /agent-approval/request 阻塞等决定，
// 渲染层 POST /agent-approval/resolve 把决定写回来。
//
// 背景（task-7-brief）：mcpBridge.ts 已经在 127.0.0.1 监听、用 x-eas-token 鉴权，这里只提供
// 两个端点各自需要的逻辑，由 mcpBridge.ts 的请求处理直接调用（同一进程内的函数调用，
// 不是再起一次 HTTP）。哪条 approvalId 对应哪个等待者，全放在本文件的模块级 Map 里。
//
// ⚠️ hookResponseBody 产出的响应体形状，与 resources/agent-hooks/responseBody.mjs 里
// 同名的函数必须保持逐字一致 —— hook 脚本是**独立的 Node 进程**，import 不到这份 TS 代码，
// 两边只能各写一份。**改一处必须改另一处**，这是跨进程边界所迫、已被裁定接受的重复
// （见 .superpowers/sdd/2026-08-14-会话内核/progress.md Ruling 2）。

import type { HookPayload } from './approvalRegistry.ts'

export type ApprovalDecision = 'allow' | 'deny'

/** 审批等待的超时上限。**兜底一律是 deny**，所以这个值不能短到让用户还在看卡片时
 *  就被自动拒绝——不短于一分钟（下面测试锁死）。取 5 分钟：参考 mcpBridge.ts 里
 *  wiki_archive_plan 的 10 分钟先例（同样是「等人在界面上点确认」的场景），但审批卡片
 *  比归档计划更轻量，5 分钟已经给足反应时间。
 *
 *  注意：Claude Code 自身的 PreToolUse hook 也有默认超时（未在 settings.json 里显式声明
 *  timeout 字段时是 60 秒，见 hookInstall.ts 装的条目——它没有带 timeout 字段）。也就是说
 *  这个常量目前**不是实际生效的上限**：真实等待多半会先撞上 Claude 那边的 60 秒。
 *  这不是本任务要解决的问题（改 hookInstall.ts 不在 Task 7 范围内），留给 Task 9 端到端
 *  验证时视真实表现决定要不要回头给 hook 条目加 timeout 字段。 */
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

interface Waiter {
  resolve: (v: { decision: ApprovalDecision; reason: string }) => void
}

// approvalId → 等待中的 resolver。一个 approvalId 同一时刻只应该有一个等待者
// （Claude 对同一次工具调用只起一个 hook 进程）；万一并发到达，后一次 waitForApproval
// 会顶掉前一个等待者的引用，先到的那个不会串话——它自己的定时器仍在跑，会在超时后
// 独立兜底为 deny，只是永远等不到 resolveApproval 命中（这种情况理论上不应该发生）。
const waiters = new Map<string, Waiter>()

/** 挂起等待一个决定：登记等待者、起一个超时定时器，返回的 Promise 会在
 *  「被 resolveApproval() 命中」或「超时」之一发生时 settle。**超时兜底固定是 deny。**
 *  timeoutMs 默认取 APPROVAL_TIMEOUT_MS，暴露成参数只是为了让测试不必真等 5 分钟。 */
export function waitForApproval(
  approvalId: string,
  timeoutMs: number = APPROVAL_TIMEOUT_MS
): Promise<{ decision: ApprovalDecision; reason: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(approvalId)
      resolve({ decision: 'deny', reason: '等待超时，Eas-Term 没能在限定时间内收到人工决定' })
    }, timeoutMs)
    waiters.set(approvalId, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      }
    })
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
