// 一个 agent 会话烧了多少：token 累加、花费取最新。
//
// **这两个字段的语义是相反的，2026-08-19 实测确认，不能混着用。**
// 测法：一个 `claude -p --input-format stream-json` 进程连喂两条「只回一个字」的消息，
// 看两个 result 事件：
//
//   #   in   out   cache_read   total_cost_usd   num_turns
//   1    2     3        15895         0.321313           1
//   2    2     3        47223         0.345369           1
//
// · `output_tokens` 两轮都是 3（各回一个字）→ **单轮值**。累计的话第二轮该是 6
// · `total_cost_usd` 0.321 → 0.345 → **会话累计**。第二轮几乎没建新缓存
//   （cache_creation 是最贵的一档），单轮花费不可能比第一轮还高
// · `num_turns` 两次都是 1，也是单轮值
//
// 所以：**token 自己累加，花费直接取最新**。反过来做的话，
// 要么把花费翻几倍报给用户，要么把 token 停在最后一轮的数上。
//
// 纯函数、不引 electron，node --test 直接跑。

export interface CostTally {
  /** 累加的输入 token（含缓存命中的部分 —— 那也是真的读进去了） */
  tokensIn: number
  /** 累加的输出 token */
  tokensOut: number
  /** 会话累计花费（美元）。CLI 不报就是 undefined，**不要拿 0 冒充「免费」** */
  costUsd?: number
}

export const ZERO_TALLY: CostTally = { tokensIn: 0, tokensOut: 0 }

/**
 * 收到一个 turn.done，把它并进累计。
 *
 * @param usage 这一轮的用量（单轮值）
 * @param costUsd CLI 报的会话累计花费；**没有就保留上一次的**，
 *                不能置回 undefined —— 有的轮次不带这个字段，
 *                置回去会让面板上的金额忽然消失。
 */
export function tally(prev: CostTally, usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }, costUsd?: number): CostTally {
  return {
    tokensIn: prev.tokensIn + (usage.inputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
    tokensOut: prev.tokensOut + (usage.outputTokens ?? 0),
    costUsd: costUsd ?? prev.costUsd
  }
}

/** 「46.2K」这种。面板一列，越短越好读；不足 1K 直接报原数 */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** 「$0.83」。**拿不到就返回空串，不显示 $0.00** —— 那会被读成「没花钱」，
 *  而真相是「这个 CLI 不报价」（Codex 就不报）。 */
export function fmtCost(usd?: number): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return ''
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}
