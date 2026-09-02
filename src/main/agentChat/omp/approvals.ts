// omp（ACP）那条路的待决审批表：把「翻译器要一个决定」和「用户点了卡片」接起来。
//
// ── 它不是 approvalRegistry / approvalRoute 的第二份 ────────────────────────
//
// 只**借形状**，不实现它们的接口，也不往它们里面加东西
// （`docs/architecture/03-agent角色边界.md` §3B 明写「不许把 registry 搬回 approvalRoute」）。
// 三者的输入源完全不同：
//   · approvalRegistry —— Claude 的 hook 脚本回调（HookPayload，键是 tool_use_id）
//   · approvalRoute    —— 那条 hook/HTTP 通道的等待者表
//   · 本文件           —— ACP 的 JSON-RPC 服务端请求（键是我们自己造的 approvalId）
// 共用一张表只会让「谁该回谁」变成运行时才发现的问题。
// 两条路在 `agentChat:resolveApproval` 那一处会合：hook 那路没认领的 id 才问这里
// （`resolveApprovalGlobal(...) || resolveAcpApproval(...)`，spec §五 T.1 #7）。
// 反过来也安全：`onApprovalSettled` 遍历各会话时对陌生 id 是空操作
// （`approvalRegistry.ts:65-70` 的 `if (!pending.has(id)) return []`）。
//
// ── 完成判据是「决定已作出」，不是「两条通道都回了」 ────────────────────────
//
// 拒绝之后 omp 内层压根不执行（`session-tools.ts:837-839` 直接 throw ToolError），
// 第二条通道再也不来。所以这张表在**决定作出**的那一刻就把条目销掉，不等第二条。
//
// ── 每个条目**必定** settle 一次，只settle一次 ─────────────────────────────
//
// 出口只有三个：用户点击（resolve）、5 分钟超时兜底（deny）、中断（abortAll，deny）。
// 少一次的后果是 ACP 的 reply 永远不写回去 → `session/prompt` 挂死（实测 180s 超时）；
// 多一次的后果是 `reduce.ts:126` 那个单槽 pending 被清两遍，
// 第二次会把**下一张**卡片误清掉。

import type { ApprovalAsk, ApprovalDecision } from '../ompEvents.ts'

/** 等用户的上限。**独立的一份**，不 import `approvalRoute.ts` 的 APPROVAL_TIMEOUT_MS
 *  —— 那是 hook/HTTP 那条路的私有实现，两条路的超时是各自的政策，同值只是巧合。
 *  值取一致（5 分钟）是为了同一个界面上两种 CLI 的卡片行为一致
 *  （13-矩阵的跨文件同步项：改一边要想想另一边）。
 *
 *  **omp 侧对两条通道都是无限等**（`acp-client-bridge.ts:114-152` 没有 timer；
 *  `extensibility/extensions/wrapper.ts:331` 不传 dialogOptions，所以也没有 elicitation 超时），
 *  所以 5 分钟这一刀是我们单方面的兜底，不会和它的超时打架。 */
export const ACP_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

interface PendingEntry {
  /** 对应的 JSON-RPC 请求 id。只用于排障日志 —— 回话用哪个 id 由 ompEvents 决定 */
  rpcId: number | string
  settle: (d: ApprovalDecision) => void
  timer: ReturnType<typeof setTimeout>
}

export interface AcpApprovals {
  /** 交给 `createOmpTranslator(decide, …)` 的那个决定器。 */
  decide(ask: ApprovalAsk): Promise<ApprovalDecision>
  /** 渲染层点了卡片。**不在表里的 id 返回 false 且不抛** ——
   *  `agentChat:resolveApproval` 要靠这个返回值决定「是不是我这条路的」。 */
  resolve(approvalId: unknown, decision: unknown): boolean
  /** 中断 / 进程退出 / restart：把还没决定的一律按 deny 落地。
   *  返回被落地的 approvalId，方便调用方写日志。 */
  abortAll(): string[]
  pendingCount(): number
}

/** 决定值归一。**认不出的一律 deny** —— 与 `approvalRoute.ts` 的 normalizeDecision 同一条：
 *  渲染层传来的是原始值，猜错方向的代价是替用户放行了一件他没点头的事。 */
function normalize(decision: unknown): ApprovalDecision {
  return decision === 'allow' ? 'allow' : 'deny'
}

export function createAcpApprovals(
  opts: { timeoutMs?: number; onSettled?: (approvalId: string, decision: ApprovalDecision) => void } = {}
): AcpApprovals {
  const timeoutMs = opts.timeoutMs ?? ACP_APPROVAL_TIMEOUT_MS
  const pending = new Map<string, PendingEntry>()

  const finish = (approvalId: string, decision: ApprovalDecision): boolean => {
    const e = pending.get(approvalId)
    if (!e) return false
    pending.delete(approvalId)
    clearTimeout(e.timer)
    e.settle(decision)
    opts.onSettled?.(approvalId, decision)
    return true
  }

  return {
    decide(ask: ApprovalAsk): Promise<ApprovalDecision> {
      const approvalId = ask?.approvalId
      // 没有 id 的请求没法被 resolve，登记了也只会占着内存等到超时 ——
      // 立刻兜底 deny（`approvalRoute.ts:141-143` 对缺 tool_use_id 的 payload 同样处理）
      if (typeof approvalId !== 'string' || !approvalId) return Promise.resolve('deny')
      // 同一张卡片重复来（omp 重发、或我们自己重放）不再开第二个等待者：
      // 复用第一个的 Promise，用户点一次两边都放行
      const exist = pending.get(approvalId)
      if (exist) return new Promise<ApprovalDecision>((r) => queueOn(exist, r))
      return new Promise<ApprovalDecision>((resolve) => {
        const timer = setTimeout(() => finish(approvalId, 'deny'), timeoutMs)
        // **必须 unref**：这是个 5 分钟的定时器，不 unref 的话 `node --test` 会一直等它
        //（测试进程挂 5 分钟才退出），Electron 里也会让一个待决审批拖住退出。
        timer.unref?.()
        pending.set(approvalId, { rpcId: ask.rpcId, settle: resolve, timer })
      })
    },

    resolve(approvalId: unknown, decision: unknown): boolean {
      if (typeof approvalId !== 'string' || !approvalId) return false
      return finish(approvalId, normalize(decision))
    },

    abortAll(): string[] {
      const ids = [...pending.keys()]
      for (const id of ids) finish(id, 'deny')
      return ids
    },

    pendingCount(): number {
      return pending.size
    }
  }
}

/** 把第二个等待者挂到同一个条目上。**不新建条目** —— 见 decide 里那段注释。 */
function queueOn(entry: PendingEntry, resolve: (d: ApprovalDecision) => void): void {
  const prev = entry.settle
  entry.settle = (d) => {
    prev(d)
    resolve(d)
  }
}
