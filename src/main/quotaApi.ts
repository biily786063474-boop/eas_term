// 直连 `/api/oauth/usage` 取 Claude 额度。**一次普通的 HTTPS GET，不花任何推理 token**
// —— 问的是用户自己账号的用量。
//
// ── 为什么要有这条路（2026-08-23 实测打通，HTTP 200）───────────────────────
// 百分比本来就是服务端下发的，CLI 只是转述，而它唯一会转述出来的出口是
// **statusline** —— 那是交互式 TUI 才有的东西。AI 对话走 `claude -p`，没有状态栏，
// 过去只能吃事件流那条残缺通道（实测：五小时那格连 `utilization` 字段都没有）。
// 当天验证过的三条死路，别再重试：
//   · 起 TUI 不发消息 —— statusline **确实被调用**，但 payload 里没有 `rate_limits` 键
//   · TUI 空跑 100 秒 —— 全程只调用 1 次 statusline，**没有定时拉取**
//   · 发一句极短消息 —— 拿得到，但 `"hi"` 的账单是 48,440 input token / $0.33，
//     地板是系统提示词+工具定义，**发多短都一样**
//
// ── 四条纪律 ───────────────────────────────────────────────────────────────
// 1. **token 只在内存里过一遍，绝不落盘、绝不进日志。** 每次现从 keychain 取 ——
//    CLI 自己会刷新它，我们缓存反而会拿到过期的那份。
// 2. **失败一律安静降级。** 拿不到就是拿不到，事件流那条路还在兜着。
//    为一个百分比弹错误框，比额度条空着更烦人。
// 3. **401 之后退避。** token 过期时每轮对话都去撞一次没有意义，
//    等用户重新登录、CLI 把新 token 写回 keychain。
// 4. **认账号。** 响应本身不带 accountUuid，但 `~/.claude.json` 带。
//    2026-08-23 实测过一次真事故：`/login` 换账号后，落盘的额度快照还是上一个账号的
//    （缓存里 seven_day 94%，接口实际 3%）—— 那已经不是「显示个旧数字」，
//    是**显示别人的额度**。所以每次取数都把 accountUuid 一起带出去比对。
import { execFile } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/** keychain 里那条凭证的 service 名。Claude Code 自己写的，别改。 */
const KEYCHAIN_SERVICE = 'Claude Code-credentials'

/** 单次请求的上限。额度是个瞥一眼的东西，卡住不如没有。 */
const TIMEOUT_MS = 8000

/** 撞到 401 之后歇多久再试。token 过期只能等 CLI 刷新，
 *  在那之前每轮对话都去撞一次纯属浪费。 */
const AUTH_BACKOFF_MS = 10 * 60_000

let authBlockedUntil = 0

export interface UsageFetch {
  /** 原始响应，交给 shared/quota.ts 的 claudeQuotaFromUsageApi 解析 */
  data: unknown
  /** 这份数据属于哪个账号。取不到就是 null —— 那就别做账号比对，
   *  宁可不比，也不能拿 null 去跟真 uuid 比然后误判成「换账号了」。 */
  accountUuid: string | null
}

/** 从 macOS keychain 取 OAuth access token。**返回值绝不能进日志。** */
function readToken(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(null) // 没登录过、条目被删、用户拒绝授权 —— 一律当没有
        try {
          const j = JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: string } }
          const t = j.claudeAiOauth?.accessToken
          resolve(typeof t === 'string' && t.length > 0 ? t : null)
        } catch {
          resolve(null)
        }
      }
    )
  })
}

/** 当前登录的是哪个账号。取不到返回 null（见 UsageFetch.accountUuid 的注释）。
 *
 *  这个文件 175KB 量级，一轮对话读一次可以接受；但**别放进热路径**。 */
function readAccountUuid(): string | null {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')
    const j = JSON.parse(raw) as { oauthAccount?: { accountUuid?: string } }
    const id = j.oauthAccount?.accountUuid
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

/** 拉一次额度。任何一步不顺就返回 null —— 调用方照旧走事件流那条。 */
export async function fetchUsage(now: number = Date.now()): Promise<UsageFetch | null> {
  if (now < authBlockedUntil) return null
  const token = await readToken()
  if (!token) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        // 不伪装成别的东西，就说明自己是谁在问
        'User-Agent': 'Eas-Term (quota-bar)'
      },
      signal: ctl.signal
    })
    if (res.status === 401 || res.status === 403) {
      authBlockedUntil = now + AUTH_BACKOFF_MS
      return null
    }
    if (!res.ok) return null
    return { data: await res.json(), accountUuid: readAccountUuid() }
  } catch {
    // 断网、代理拦截、超时、响应不是 JSON —— 都不值得惊动用户
    return null
  } finally {
    clearTimeout(timer)
  }
}
