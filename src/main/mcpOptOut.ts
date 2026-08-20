// 用户明确关掉 MCP 接入之后，要不要在下次启动时又给他装回来。
//
// 背景：`setupAgents()` 挂在 MCP bridge 的 listen 回调里，**每次 app 启动都跑一遍**，
// 无条件写 ~/.claude.json 和 ~/.codex/config.toml。于是「足迹」面板上那颗「移除」
// 按钮点下去只管当次：重启一遍配置又回来了。用户点移除表达的是「我不要这个」，
// 软件第二天自己装回去，是不听话。
//
// 但反过来也不能一刀切成「只要文件读不到就不装」—— 不装的后果是画板工具**整个不可用**
// （卡片文案自己写着「不配这个，画板工具完全不可用」），而误装的后果只是用户再点一次
// 移除。两边代价差得远，所以判定必须是**只有明确的拒绝才算拒绝**，其余一律倒向装。
//
// 不引 electron/fs，node --test 直接跑。

export interface OptOutState {
  /** 用户是否明确关掉过 */
  optedOut: boolean
  /** 关掉的时刻，只用于展示与排障 */
  at?: number
}

/**
 * 读到的标记文件内容 → 这次启动要不要自动装 MCP 配置。
 *
 * `raw` 为 null 表示文件不存在（绝大多数用户的情况）。
 *
 * **任何异常都返回 true。** 文件损坏、字段缺失、类型不对 —— 一律当成「没拒绝过」。
 * 反过来写（读不到就不装）会让一个坏掉的小文件把画板功能整个废掉，而且用户在界面上
 * 看到的是「未启用」却又点不出原因。
 */
export function shouldAutoInstall(raw: string | null): boolean {
  if (raw === null) return true
  try {
    const v = JSON.parse(raw) as Partial<OptOutState> | null
    // 严格比对 true：字符串 'true'、1 这类值一律不算数，不猜用户意图
    return v?.optedOut !== true
  } catch {
    return true
  }
}

/** 写回去的内容。集中在这里，免得两处各写各的字段名。 */
export function optOutPayload(optedOut: boolean, now: number): string {
  const s: OptOutState = optedOut ? { optedOut: true, at: now } : { optedOut: false }
  return JSON.stringify(s, null, 2)
}
