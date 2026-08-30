// 从 CLI 的事件里认出「这次失败是因为没登录」。
//
// ── 为什么需要它 ────────────────────────────────────────────────────
// 用户报的症状是「AI 对话里一输入就自动关掉 CLI 进程」。2026-08-30 用空配置目录
// 复现，两边的真实表现**都不是「静默关闭」，而是各自难懂**：
//
// · codex：`{"type":"error","message":"Reconnecting... 2/5 (unexpected status
//   401 Unauthorized: Missing bearer or basic authentication in header, url:
//   wss://api.openai.com/v1/responses, cf-ray: …)"}` **连刷十条**，然后
//   `turn.failed`，退出码 1。用户看到满屏 cf-ray 和 wss:// 。
//
// · claude：**一条 `type:'result'` 就没了**，而且 `subtype` 写的是
//   **`"success"`**，`result` 字段是 `"Not logged in · Please run /login"`，
//   `terminal_reason:"api_error"`，退出码 1。
//   而 translateResult 只取 usage / cost，`result` 文本**看都不看** ——
//   于是界面上是一个空轮次加一句红色的「CLI 进程退出（code 1）」。
//   这就是「一输入就自动关闭」的真相。
//
// ── 两个能把人带沟里的字段 ──────────────────────────────────────────
// ① **`subtype` 是 `"success"`**。拿它判成败，未登录会被当成功。
//    真正可信的是 **`is_error: true`**（同一条事件里两个字段互相打架，实测确认）。
// ② **claude 那句话让人去敲 `/login`** —— 那是终端里的命令。用户明确要求
//    「不能让用户在终端模式下登陆，需要全部是 AI 对话模块的 GUI」，
//    所以这句原文**不能原样端给用户看**，必须换成我们自己的登录入口。
//
// ── 只看错误通道，绝不看模型回复 ────────────────────────────────────
// **判据只取错误字段**（codex 的 error.message / turn.failed；claude 的
// result 且 is_error 为真），**不碰 assistant 的正文**。
// 否则用户问一句「401 Unauthorized 是什么意思」、模型复述了这个词，
// 就会被判成掉线 —— 一个正在正常聊天的人被弹去登录。
//
// ── 认出来了也只是「怀疑」，不是「结论」 ────────────────────────────
// 命中之后**不直接断言未登录**：渲染层收到这个标记会再查一次
// `cliAuth.check`，以 status 为准。理由跟 parse.ts 的 looksSucceeded 一样 ——
// 文本匹配是提示，CLI 自己报的状态才是判据。这样即使这里误判（比如上游哪天
// 用 401 表达别的意思），用户也只是多等一次查询，不会被推去做无用的重新登录。

/** 未登录/掉线的说法。**每一条都来自真样本或官方措辞，不臆造。** */
const PATTERNS: RegExp[] = [
  // codex：401 是核心信号。**要求 401 和 unauthorized 同时出现** ——
  // 只匹配「401」会把模型讨论 HTTP 状态码的内容也算进去（虽然我们只看错误通道，
  // 但错误通道里也可能透出用户自己的 API 调用结果）
  /\b401\b[\s\S]{0,80}unauthoriz/i,
  /unauthoriz[\s\S]{0,80}\b401\b/i,
  // claude 真样本原文
  /not\s+logged\s+in/i,
  /please\s+run\s+\/login/i,
  // 两边都可能出现的说法
  /invalid\s+api[_\s-]?key/i,
  /authentication[_\s-]?error/i,
  /\bunauthenticated\b/i,
  /(oauth\s+)?token\s+(has\s+)?expired/i,
  /credentials?\s+(are\s+)?(invalid|expired)/i
]

/** 一段文本看起来像不像「没登录」。**不导出给外面直接用** ——
 *  外面该用下面那个吃事件的版本，那个才带着「只看错误通道」的保护。 */
function textLooksUnauthed(s: string): boolean {
  return PATTERNS.some((re) => re.test(s))
}

/**
 * **只有这三种事件可能携带登录失败**。判定分支和前置过滤共用这一份，
 * 是为了让两处不可能走样：新增一个分支就得往这里加一个类型，
 * 而漏加会被 detect.test.ts 里那条「每个分支都过得了前置过滤」直接照出来。
 *
 * 按类型过滤而不是按关键词过滤，是上一版改过来的：关键词并集里删掉一个词，
 * 样本里通常还有别的词兜住，测试照样绿 —— 那种前置过滤是测不住的。
 */
export const AUTH_BEARING_TYPES = ['error', 'turn.failed', 'result'] as const

/**
 * 一条原始 CLI 事件是不是在说「没登录」。
 *
 * 传进来的是**还没翻译的原始 JSON 对象**（translate 之前那一层），
 * 因为翻译层会把 claude 的 result 文本整个丢掉 —— 等翻译完就没得判了。
 *
 * @returns 命中的原文（给日志用，**不直接展示给用户**），没命中返回 null
 */
export function unauthedReason(j: unknown): string | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>

  // ── codex：顶层 error 事件 ──
  // 这是 CLI 自己的错误通道，不是工具输出，所以可以放心读
  if (o.type === 'error' && typeof o.message === 'string') {
    return textLooksUnauthed(o.message) ? o.message : null
  }
  // ── codex：turn.failed ──
  if (o.type === 'turn.failed') {
    const err = o.error
    const msg = err && typeof err === 'object' ? (err as Record<string, unknown>).message : undefined
    if (typeof msg === 'string' && textLooksUnauthed(msg)) return msg
    return null
  }
  // ── claude：result ──
  // **判据是 is_error，不是 subtype** —— 未登录时 subtype 写的是 "success"
  //（同一条事件里 is_error 为 true，两个字段互相打架，2026-08-30 实测）
  if (o.type === 'result') {
    if (o.is_error !== true) return null
    const r = typeof o.result === 'string' ? o.result : ''
    // terminal_reason:'api_error' 是佐证，但**不作为必要条件** ——
    // 上游随时可能换个说法，而 result 文本已经足够清楚
    if (textLooksUnauthed(r)) return r
    return null
  }
  return null
}

/**
 * 吃**一整行原始 stdout**（还没 JSON.parse 的），认出未登录。
 *
 * 为什么给行不给对象：调用点在 session.ts 的 feed()，那里每行都要再喂给翻译器
 * 解析一次。**热路径上不做第二次 JSON.parse** —— 流式输出一秒能有几百行，
 * 单行还可能上百 KB。先用一次廉价的子串扫描过滤，命中了才解析。
 *
 * 过滤**按事件类型走**（AUTH_BEARING_TYPES），跟判定分支同一份来源。
 * 高频的那些行（stream_event / item.* 增量）在这里就被挡住，根本不进解析。
 */
export function unauthedInLine(line: string): string | null {
  // 一次正则扫描就是绝大多数行的全部开销。
  // 容忍 `"type" : "error"` 这种带空格的写法 —— 实测两个 CLI 都输出紧凑 JSON，
  // 但没有任何东西保证它们一直如此，而这里松一点不花什么钱
  if (!TYPE_PREFILTER.test(line)) return null
  try {
    return unauthedReason(JSON.parse(line))
  } catch {
    return null
  }
}

const TYPE_PREFILTER = new RegExp(
  `"type"\\s*:\\s*"(${AUTH_BEARING_TYPES.map((t) => t.replace('.', '\\.')).join('|')})"`
)
