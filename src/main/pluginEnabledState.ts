// 插件「开启/关闭」总闸的纯状态逻辑。**零 electron，`node --test` 裸跑。**
//
// 设计决定（2026-09-15，用户拍板 A）：这个开关管**所有**插件（自家 + Claude / Codex），
// 只有开启的才出现在双击的插入面板和输入框 @ 里。**默认开启** —— 所以持久化的是
// 「被明确关掉的 id 集合」（disabled），不在集合里 = 开着。这样新装 / 新出现的插件默认就亮，
// 不会因为「没在启用名单里」而凭空消失（同 mcpOptOut 的倒向：默认可用，只有明确拒绝才拒绝）。
export interface EnabledState {
  /** 被用户明确关掉的插件 id（PluginInfo.id，形如 `eas:board` / `claude:xxx` / `codex:xxx`）。 */
  disabled: string[]
}

const EMPTY: EnabledState = { disabled: [] }

/** 读盘内容 → 规范状态。任何异常都退回空（默认全开）—— 一个坏文件不该把所有插件关掉。 */
export function parseEnabledState(raw: unknown): EnabledState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { disabled: [] }
  const d = (raw as { disabled?: unknown }).disabled
  if (!Array.isArray(d)) return { disabled: [] }
  const seen = new Set<string>()
  for (const x of d) if (typeof x === 'string' && x) seen.add(x)
  return { disabled: [...seen] }
}

/** 这个插件现在开着吗？不在 disabled 里 = 开着（默认开启）。 */
export function isPluginEnabled(id: string, state: EnabledState): boolean {
  return !state.disabled.includes(id)
}

/** 开/关一个插件，返回新状态（不改入参）。开 = 从 disabled 移除；关 = 加进 disabled。 */
export function setPluginEnabled(state: EnabledState, id: string, enabled: boolean): EnabledState {
  const set = new Set(state.disabled)
  if (enabled) set.delete(id)
  else set.add(id)
  return { disabled: [...set] }
}

export const EMPTY_ENABLED_STATE = EMPTY
