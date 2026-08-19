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
//
// ── 「有没有一批在跑」为什么不由本模块维护 ────────────────────────────
// 第一版在这里存了一个 `running: Set<frameId>`，`askForBatch` 成功时 add、
// 由 `finishBatch()` 来 delete。结果是 **finishBatch 只在「起到一半失败」的
// catch 里被调过**，成功路径一次都没调 —— 派一批就永久锁死一个 Frame，
// 而错误信息里指的补救动作（去面板停会话）跟这个 Set 根本没接线，
// 停多少次都没用，唯一出路是重启 app。（2026-08-19 真实触发，
// 由一个 cross-checker agent 抓到。）
//
// 教训不是「记得调 finishBatch」，是**别自己维护一份会和现实脱节的状态**。
// 现在由调用方现算传进来：「这个 Frame 上还有没有 owner:'team' 且进程还活着
// 的会话」。那份判断读的是真实的会话表，不可能忘记清。
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
  /** reason 可选：用户点「算了」时通常什么都不说，硬要一个理由等于逼 UI 编一个。
   *  有理由就带上（比如「这个项目已经有一批在跑」），AI 能据此调整。 */
  | { go: false; reason?: string }

let pending: { req: BatchRequest; resolve: (d: BatchDecision) => void } | null = null
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
  } else {
    const n = (cancelStreak.get(p.req.frameId) ?? 0) + 1
    cancelStreak.set(p.req.frameId, n)
    // 连着被拒两次说明它没搞懂你要什么，别再拿清单烦你
    if (n >= CANCEL_LIMIT) banned.add(p.req.frameId)
  }
  emit()
  p.resolve(d)
}

/**
 * 弹一张批次清单给用户，等他决定。
 *
 * **抛异常 = 根本没弹**，这时要让 AI 收到明确的错误而不是干等 ——
 * 每条错误都写清「为什么不行、现在该做什么」，否则它会重试到你厌烦。
 */
/** 自己也要超时，且**必须比主进程那侧短**。
 *
 *  两侧各等各的：主进程 invokeRenderer 超时后只清它自己那份 pending，
 *  渲染层这边的弹窗还挂着。用户过一会儿点了「开工」→ running.add 执行 →
 *  这个 Frame 被标记成「有批次在跑」，可实际一个 agent 都没起，
 *  之后再派活永远被「已经有一批在跑」挡住，除非重启 app。
 *  （2026-08-19 端到端第一次验证时踩到，那次主进程侧只给了 15 秒。）
 *
 *  比主进程短，保证「先由这边判超时」——那样至少 running 不会被脏标记。 */
const WAIT_MS = 9 * 60 * 1000

/**
 * @param alreadyRunning 这个 Frame 上是不是已经有一批在跑。**由调用方现算传入** ——
 *   见下面 askForBatch 文档里那段说明。
 */
export function askForBatch(req: BatchRequest, alreadyRunning: boolean): Promise<BatchDecision> {
  if (banned.has(req.frameId)) {
    throw new Error(
      `这个项目的派活请求已被用户连续拒绝 ${CANCEL_LIMIT} 次，本轮不再弹。` +
        '按单会话继续做这件事，不要再试组队。'
    )
  }
  if (alreadyRunning) {
    throw new Error(
      '这个项目已经有一批 agent 在跑了。等它收尾，或者让用户在团队面板里停掉 —— ' +
        '同一个项目不允许两批并行（那样谁也说不清一共烧了多少）。'
    )
  }
  if (pending) throw new Error('已经有一张批次清单在等用户确认了，等那个有结果再说')
  return new Promise<BatchDecision>((resolve) => {
    // 守卫必须比**一个稳定的身份**，不能比 resolve。
    //
    // 第一版写的是 `if (pending?.resolve !== resolve) return` —— 那是死代码：
    // pending.resolve 存的是下面那个**包装闭包**，而 resolve 是 Promise 的原始
    // resolve，两者永远不是同一个引用，于是超时回调每次都直接 return，
    // 不清 pending、不 emit、不 resolve。整条 9 分钟超时一次都不会生效。
    // （2026-08-19 由一个 cross-checker agent 用 mock.timers 推过 9 分钟实测抓到，
    //   而当时 7 条单测全在状态机层、没有一条碰超时，所以它带着「全过」进了仓库。）
    let timer: ReturnType<typeof setTimeout>
    const mine: NonNullable<typeof pending> = {
      req,
      resolve: (d) => {
        clearTimeout(timer)
        resolve(d)
      }
    }
    timer = setTimeout(() => {
      if (pending !== mine) return // 已经被用户处理掉了，或者换了一张新清单
      pending = null
      emit()
      // 当成没同意，但**不计入「连续取消」** —— 他只是没在电脑前，不是拒绝了你
      resolve({ go: false, reason: '清单一直没人处理（等了 9 分钟）' })
    }, WAIT_MS)
    // 浏览器里没有 unref，可选链跳过；node --test 下不 unref 的话这条 9 分钟的
    // 定时器会让测试进程挂到超时才退出（同 main/agentChat/session.ts 的写法）
    ;(timer as unknown as { unref?: () => void }).unref?.()
    pending = mine
    emit()
  })
}

/** 仅供测试重置模块级状态 */
export function __resetBatchState(): void {
  pending = null
  cancelStreak.clear()
  banned.clear()
}
