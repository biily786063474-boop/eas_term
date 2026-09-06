// 截图里**哪些窗口要涂黑**。纯函数，有测试。
//
// 设计稿 §二 A2：全屏截图必然拍到密码管理器、终端里的 token、聊天窗口，而这些图会进
// 模型上下文、发到云端。所以**默认清单非空**（§三 决定 5）—— 默认安全，用户可以往下减，
// 但不能因为「忘了配」就把密码拍进去。
//
// 匹配两样：bundle id（准，优先）与窗口标题（兜底，因为有些 App 拿不到 bundle id）。

export interface WindowInfo {
  /** 窗口在逻辑坐标里的位置（点） */
  bounds: { x: number; y: number; width: number; height: number }
  title?: string
  bundleId?: string
}

/** 默认要涂黑的 bundle id。宁可多涂 —— 涂错了用户看得见，漏涂了他永远不知道。 */
export const DEFAULT_REDACT_BUNDLES = [
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.apple.keychainaccess',
  'com.bitwarden.desktop',
  'com.lastpass.LastPass',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.mitchellh.ghostty',
  'com.apple.Passwords'
] as const

/** 标题里出现这些词也涂黑（大小写不敏感）。终端标题常带这些。 */
export const DEFAULT_REDACT_TITLE_WORDS = ['password', '密码', 'secret', 'token', 'api key', 'apikey', 'credential', '私钥', 'passphrase'] as const

export interface RedactRules {
  bundles?: readonly string[]
  titleWords?: readonly string[]
  /** 用户显式放行的 bundle（从默认清单里减掉）。**只能减 bundle，不能减标题词** */
  allowBundles?: readonly string[]
}

export function shouldRedact(w: WindowInfo, rules: RedactRules = {}): boolean {
  const allow = new Set((rules.allowBundles ?? []).map((s) => s.toLowerCase()))
  const id = (w.bundleId ?? '').toLowerCase()
  if (id && allow.has(id)) return false
  const bundles = (rules.bundles ?? DEFAULT_REDACT_BUNDLES).map((s) => s.toLowerCase())
  if (id && bundles.includes(id)) return true
  const title = (w.title ?? '').toLowerCase()
  if (!title) return false
  return (rules.titleWords ?? DEFAULT_REDACT_TITLE_WORDS).some((word) => title.includes(word.toLowerCase()))
}

/** 要涂黑的矩形（逻辑点）。给截图后处理用。 */
export function redactRects(windows: readonly WindowInfo[], rules?: RedactRules): WindowInfo['bounds'][] {
  return windows.filter((w) => shouldRedact(w, rules)).map((w) => w.bounds)
}
