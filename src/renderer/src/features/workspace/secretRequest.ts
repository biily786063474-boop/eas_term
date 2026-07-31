// AI 索要密钥的排队与限流。把 MCP 调用（mcpHandler）和弹窗（SecretRequestModal）接上。
//
// 限流是这个功能的安全组件，不是体验优化：一个跑飞的 agent 能连弹几十个窗，
// 弹到第五个的时候人就开始无脑点「确定」了 —— 弹窗疲劳本身就是攻击面。
// 规则（见设计文档「两个必须防的坑」第 2 条）：
//   · 两次请求至少隔 60 秒
//   · 同一个终端里连续取消 2 次 → 这个终端本轮不许再弹（重启 app 才恢复）
//   · 同时最多一个弹窗，第二个直接回绝而不是排队等
import type { SecretRequest, SecretRequestResult } from './SecretRequestModal'

const MIN_GAP_MS = 60_000
const CANCEL_LIMIT = 2

// ptyId 存在 pending 里，而不是让弹窗在 resolve 时回传 ——
// 回传过一次就漏过一次：取消次数记到了 '-' 上，而限流查的是真实 ptyId，
// 于是「连续拒绝 2 次拉黑」整个不生效（端测抓到的）。请求自己知道自己是谁，最稳。
let pending: {
  req: SecretRequest
  resolve: (r: SecretRequestResult) => void
  ptyId?: string
} | null = null
const listeners = new Set<() => void>()
/**
 * 「索要」和「报错要改」各算各的间隔。
 *
 * 合用一个计时器的话会挡掉最常见的那条路：存完 key（t=0）→ 拿去跑（t=5s）→
 * 服务说 401 → 报错要改（t=5s）**被自己刚才那次索要挡住**，agent 只能干等一分钟，
 * 多半就绕回「你把 key 贴给我看看」了 —— 正好是这个功能要消灭的事。
 * 两者都还是 60 秒窗口（防刷），也都照常计入「连续取消 2 次拉黑」。
 */
const lastAskAt = { ask: 0, fix: 0 }
/** ptyId → 连续取消次数。一个终端 ≈ 一轮 agent 会话 */
const cancelStreak = new Map<string, number>()
/** 被这一轮拉黑的终端 */
const banned = new Set<string>()

const emit = (): void => listeners.forEach((f) => f())

export function subscribeSecretRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function currentSecretRequest(): SecretRequest | null {
  return pending?.req ?? null
}

/** 弹窗那边调，把用户的选择送回等在 askForSecret 上的 MCP 调用 */
export function resolveSecretRequest(r: SecretRequestResult): void {
  const p = pending
  if (!p) return
  pending = null
  const key = p.ptyId || '-'
  if (r.saved) {
    cancelStreak.delete(key)
  } else {
    const n = (cancelStreak.get(key) ?? 0) + 1
    cancelStreak.set(key, n)
    // 连着被拒两次说明 AI 在乱要，别再让它烦人
    if (n >= CANCEL_LIMIT) banned.add(key)
  }
  emit()
  p.resolve(r)
}

/**
 * 弹一个密钥请求给用户，等他决定。
 * 抛异常 = 根本没弹（限流/重复），这时候要让 AI 收到明确的错误而不是干等。
 */
export function askForSecret(req: SecretRequest, ptyId?: string): Promise<SecretRequestResult> {
  const key = ptyId || '-'
  if (banned.has(key)) {
    throw new Error(
      `这个终端里的密钥请求已被用户连续拒绝 ${CANCEL_LIMIT} 次，本轮不再弹窗。` +
        '需要密钥的话，让用户自己在标题栏的密钥柜里添加。'
    )
  }
  if (pending) throw new Error('已经有一个密钥请求在等用户处理了，等那个结束再说')
  const kind = req.mode === 'fix' ? 'fix' : 'ask'
  const wait = MIN_GAP_MS - (Date.now() - lastAskAt[kind])
  if (wait > 0) {
    throw new Error(`密钥请求太频繁，${Math.ceil(wait / 1000)} 秒后才能再弹一次`)
  }
  lastAskAt[kind] = Date.now()
  return new Promise<SecretRequestResult>((resolve) => {
    pending = { req, resolve, ptyId }
    emit()
  })
}
