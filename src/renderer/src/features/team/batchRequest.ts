// 派活请求的排队与限流。把 MCP 调用（mcpHandler 的 team_spawn）和确认弹窗接上。
//
// **形状照抄 features/workspace/secretRequest.ts**，那条路已经在密钥场景验证过。
// 但限流比它更严，理由很直接：密钥请求要的是你的注意力，派活请求要的是**你的钱**。
// 一个跑飞的 agent 连开三批 × 6 个 = 18 个 CLI 进程同时烧，等你发现已经晚了。
//
// 三条规则：
//   · 同时最多一个批次在等确认（第二个直接回绝，不排队）
//   · **同时最多一个批次在跑** —— 上一批没收尾，不许开下一批
//   · 同一个 Frame 里连续取消 2 次 → 这个 Frame 本轮不再接受派活（重启 app 才恢复）
//
// 没有「最小间隔」那条：派活本来就低频，而上面第二条已经挡住了连开。
import type { BatchSpec } from './batchSpec'

const CANCEL_LIMIT = 2

export interface BatchRequest {
  spec: BatchSpec
  /** 派活落在哪个 Frame（也是限流的粒度） */
  frameId: string
  /** 这个项目的工作目录，显示给用户看「在哪跑」 */
  cwd: string
}

export type BatchDecision =
  | { go: true }
  | { go: false; reason: string }

let pending: { req: BatchRequest; resolve: (d: BatchDecision) => void } | null = null
/** frameId → 这个 Frame 上正在跑的批次（还没收尾）。**一个 Frame 同时只允许一批** */
const running = new Set<string>()
/** frameId → 连续取消次数 */
const cancelStreak = new Map<string, number>()
/** 被这一轮拉黑的 Frame */
const banned = new Set<string>()
const listeners = new Set<() => void>()

const emit = (): void => listeners.forEach((f) => f())

export function subscribeBatchRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function currentBatchRequest(): BatchRequest | null {
  return pending?.req ?? null
}

/** 弹窗那边调，把用户的决定送回等在 askForBatch 上的 MCP 调用 */
export function resolveBatchRequest(d: BatchDecision): void {
  const p = pending
  if (!p) return
  pending = null
  if (d.go) {
    cancelStreak.delete(p.req.frameId)
    running.add(p.req.frameId)
  } else {
    const n = (cancelStreak.get(p.req.frameId) ?? 0) + 1
    cancelStreak.set(p.req.frameId, n)
    // 连着被拒两次说明它没搞懂你要什么，别再拿清单烦你
    if (n >= CANCEL_LIMIT) banned.add(p.req.frameId)
  }
  emit()
  p.resolve(d)
}

/** 这一批跑完了 / 被全部叫停 —— 放开这个 Frame，允许开下一批 */
export function finishBatch(frameId: string): void {
  running.delete(frameId)
  emit()
}

export function isBatchRunning(frameId: string): boolean {
  return running.has(frameId)
}

/**
 * 弹一张批次清单给用户，等他决定。
 *
 * **抛异常 = 根本没弹**，这时要让 AI 收到明确的错误而不是干等 ——
 * 每条错误都写清「为什么不行、现在该做什么」，否则它会重试到你厌烦。
 */
export function askForBatch(req: BatchRequest): Promise<BatchDecision> {
  if (banned.has(req.frameId)) {
    throw new Error(
      `这个项目的派活请求已被用户连续拒绝 ${CANCEL_LIMIT} 次，本轮不再弹。` +
        '按单会话继续做这件事，不要再试组队。'
    )
  }
  if (running.has(req.frameId)) {
    throw new Error(
      '这个项目已经有一批 agent 在跑了。等它收尾，或者让用户在团队面板里停掉 —— ' +
        '同一个项目不允许两批并行（那样谁也说不清一共烧了多少）。'
    )
  }
  if (pending) throw new Error('已经有一张批次清单在等用户确认了，等那个有结果再说')
  return new Promise<BatchDecision>((resolve) => {
    pending = { req, resolve }
    emit()
  })
}

/** 仅供测试重置模块级状态 */
export function __resetBatchState(): void {
  pending = null
  running.clear()
  cancelStreak.clear()
  banned.clear()
}
