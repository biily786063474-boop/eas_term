// 输入框下方那行统计。
//
// **只放有准确来源的数。** 参考 UI 里还有「LLM 5.5s · 工具调用 0.1s」「首 token
// 平均 1.5s · 100 tok/s」这些，我们的事件流里根本没有这些量 —— 现算等于编，
// 而这条产品线刚因为「上下文百分比不准」把整个仪表盘摘掉过一次。宁可少几项。
//
// 纯函数、不引 electron/react，node --test 直接跑。

export interface StatsInput {
  /** 已完成的轮数 */
  turns: number
  /** 执行步数（工具调用次数） */
  steps: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  costUsd?: number
}

/** 1234 → 1.2K；小于 1000 原样。token 数动辄上万，全写出来一行放不下 */
export function shortNum(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K'
  return (n / 1_000_000).toFixed(1) + 'M'
}

/**
 * 缓存命中率：命中的 / (命中的 + 这次真读的)。
 *
 * 分母**必须把 cached 算进去** —— Anthropic 的 usage 里 `input_tokens` 是
 * 「这次真正读进去的」，缓存那部分单独记在 cache_read 里，两者不重叠。
 * 拿 cached / input 当命中率会算出大于 1 的数。
 */
export function cacheHitRate(inputTokens?: number, cachedInputTokens?: number): number | null {
  const cached = cachedInputTokens ?? 0
  const fresh = inputTokens ?? 0
  const total = cached + fresh
  if (!total || !cachedInputTokens) return null
  return cached / total
}

/** 组装成一行里的若干段。空数组 = 什么都还不知道，调用方整行不渲染。 */
export function statsSegments(s: StatsInput): string[] {
  const out: string[] = []
  if (s.turns > 0) out.push(s.steps > 0 ? `${s.turns} 轮 · ${s.steps} 步` : `${s.turns} 轮`)

  const hit = cacheHitRate(s.inputTokens, s.cachedInputTokens)
  if (hit !== null) out.push(`缓存命中 ${Math.round(hit * 100)}%`)

  if (s.inputTokens != null || s.outputTokens != null) {
    // 输入报**总量**（这次真读的 + 缓存命中的）。只报 inputTokens 的话，缓存命中率高时
    // 会显示成「输入 2」——真跑一轮实测到的数字，看着像坏了。用户想知道的是
    // 「这轮喂进去多少」，不是「其中有多少没走缓存」，后者已经由命中率那段回答了。
    const totalIn = (s.inputTokens ?? 0) + (s.cachedInputTokens ?? 0)
    out.push(`输入 ${shortNum(totalIn)} · 输出 ${shortNum(s.outputTokens ?? 0)}`)
  }
  // 花费只在 CLI 真的报了的时候显示。0 也是有意义的值（免费额度内），所以判 null 不判真值
  if (s.costUsd != null) out.push(`$${s.costUsd < 0.01 ? s.costUsd.toFixed(4) : s.costUsd.toFixed(2)}`)
  return out
}
