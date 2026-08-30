// 从 CLI 的输出里认出「登录状态」和「登录流程走到哪了」。
//
// **纯函数，可单测。** 这一层全是对外部程序输出的解析 —— 上游改一句话就可能失灵，
// 而失灵的表现是「用户明明登录了，我们说他没登录」或者反过来。必须能拿真样本回归。
//
// ── 下面每一条都是 2026-08-29 真跑出来的，不是读文档抄的 ──────────────
//
// claude auth status（默认就是 --json）：
//   { "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
//     "email": "...", "orgId": "..." }
//   退出码 0。
//
// codex login status：
//   已登录 → `Logged in using ChatGPT`
//   未登录 → `Not logged in`
//   **两种情况退出码都是 0** —— 不能看退出码，只能读文本。这一条最容易写错：
//   拿 `code === 0` 当「已登录」会让所有未登录的人都被判成已登录。
//
// claude auth login --claudeai：
//   `Opening browser to sign in…`
//   `If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?...`
//   `Paste code here if prompted > `        ← **要把授权码写回 stdin**
//
// codex login --device-auth：
//   `1. Open this link in your browser and sign in to your account`
//   `   https://auth.openai.com/codex/device`
//   `2. Enter this one-time code (expires in 15 minutes)`
//   `   KC89-BN60L`
//   **不开浏览器**，用户拿码去网站输 —— 正是「不要直接跳网页」要的形态。

export type CliId = 'claude' | 'codex'

export interface AuthStatus {
  loggedIn: boolean
  /** 用什么方式登的（claude.ai / ChatGPT / API key…）。拿不到就 undefined，不编 */
  method?: string
  /** 登录的是哪个账号。**只在 CLI 自己报了的时候才有** */
  account?: string
}

/** 终端色彩转义 —— codex 的输出带一堆 ANSI，直接匹配会全落空 */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g
const clean = (s: string): string => s.replace(ANSI, '')

/**
 * `claude auth status` 的输出（JSON）。
 *
 * **解析不出来时返回 null，不是「未登录」。** 两者的处置完全不同：
 * 未登录要引导登录；解析不出来说明我们跟上游脱节了，那时候把人推去重新登录
 * 只会让他白走一趟 —— 界面该说「读不到登录状态」。
 */
export function parseClaudeStatus(stdout: string): AuthStatus | null {
  const t = clean(stdout).trim()
  if (!t) return null
  // 输出前面可能有别的行（更新提示之类），从第一个 { 开始找
  const i = t.indexOf('{')
  if (i < 0) return null
  try {
    const j = JSON.parse(t.slice(i)) as Record<string, unknown>
    if (typeof j.loggedIn !== 'boolean') return null
    return {
      loggedIn: j.loggedIn,
      method: typeof j.authMethod === 'string' ? j.authMethod : undefined,
      account: typeof j.email === 'string' ? j.email : undefined
    }
  } catch {
    return null
  }
}

/**
 * `codex login status` 的输出（纯文本）。
 *
 * **只认明确的两种说法，其余返回 null。** 不做「没说 Not logged in 就算登录了」
 * 这种推断 —— 上游哪天换个措辞，那种写法会把所有人判成已登录。
 */
export function parseCodexStatus(stdout: string): AuthStatus | null {
  const t = clean(stdout).trim()
  if (!t) return null
  if (/not\s+logged\s+in/i.test(t)) return { loggedIn: false }
  const m = t.match(/logged\s+in(?:\s+using\s+(.+?))?\s*$/im)
  if (m) return { loggedIn: true, method: m[1]?.trim() || undefined }
  return null
}

export function parseStatus(cli: CliId, stdout: string): AuthStatus | null {
  return cli === 'claude' ? parseClaudeStatus(stdout) : parseCodexStatus(stdout)
}

/** 登录流程当前该给用户看什么。 */
export interface LoginPrompt {
  /** 要用户打开的网址 */
  url?: string
  /** 设备码（codex 的 --device-auth 会给）；claude 没有 */
  code?: string
  /** CLI 在等我们把授权码写回 stdin（claude 是这样） */
  needsCode?: boolean
}

/**
 * 从登录进程到目前为止的输出里，认出「现在该让用户干什么」。
 *
 * **累积解析而不是逐行**：URL 和码可能分几次 chunk 到达，
 * 逐行判会在 chunk 边界上把一条 URL 劈成两半。
 */
export function parseLoginOutput(cli: CliId, sofar: string): LoginPrompt {
  const t = clean(sofar)
  const out: LoginPrompt = {}
  // URL：两边都是 https，取第一个看起来像授权地址的。
  // **中英文标点都要挡** —— 中文说明里 URL 常被括号或顿号紧跟着，
  // 只挡半角的话会把「（」连同后面的中文一起吞进 URL
  const url = t.match(/https:\/\/[^\s'"<>()（），。、；：」』]+/)
  if (url) out.url = url[0]
  if (cli === 'codex') {
    // 设备码：`XXXX-XXXXX` 这种形状，出现在「Enter this one-time code」之后。
    // **限定在那句话之后找**，否则 URL 里的随机串也可能撞上这个形状
    const after = t.split(/one-time code/i)[1]
    if (after) {
      const m = after.match(/\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/)
      if (m) out.code = m[1]
    }
  } else {
    // claude 走到「Paste code here」就是在等我们喂码
    if (/paste\s+code\s+here/i.test(t)) out.needsCode = true
  }
  return out
}

/** 登录进程成功了吗。**不看退出码** —— 两边都可能 0 退出却没登上
 *  （用户取消、超时）。真正的判据是登录之后再查一次 status，
 *  这个函数只用来提前给出「看起来成了」的提示。 */
export function looksSucceeded(cli: CliId, sofar: string): boolean {
  const t = clean(sofar)
  return cli === 'claude'
    ? /logged\s+in|success|已登录/i.test(t)
    : /successfully\s+logged\s+in|logged\s+in\s+using/i.test(t)
}
