// 额度用量的共享数据模型 —— 主进程采集、渲染层显示，两边照这一份说话。
//
// ── 两个 CLI，两条完全不同的取数路 ──────────────────────────────────
// **Claude Code**：statusline 机制。CLI 定期调我们装的转发脚本
//   （resources/agent-hooks/eas-statusline.mjs），它把 JSON POST 回 app。
//   字段：rate_limits.five_hour / seven_day 的 used_percentage + resets_at。
//   headless 事件流里**没有**这些（2026-08-18 实测）。
//
// **Codex**：只能读它自己的会话日志。
//   2026-08-21 实测：`codex exec --json` 的 headless 流只有 thread.started /
//   turn.started / item.completed / turn.completed 四种事件，**不含 rate_limits**；
//   而 ~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl 里的 `token_count` 事件带着：
//     rate_limits: { primary: { used_percent, window_minutes, resets_at }, secondary, plan_type }
//   额度是**账号级**的，所以不必对应到某个会话，读最新那份日志就行。
//
// 两边都是「跑过一轮才有数」。**没数就不显示那一侧**（用户 2026-08-21 拍板），
// 不显示 0% 也不显示占位符 —— 一个永远是 — 的格子每天看着，不如没有。

/** 一个额度窗口。percent 是 0–100 的整数。 */
export interface QuotaWindow {
  percent: number
  /** 窗口长度（分钟）。Claude 侧固定 300 / 10080，Codex 侧原样透传 */
  windowMinutes?: number
  /** 什么时候重置（Unix 秒） */
  resetsAt?: number
  /** **这一格自己**的采样时刻（ms epoch）。
   *
   *  不能拿 CliQuota.updatedAt 顶替：那是整个 CLI 共用一个，而两条来源各自只报得出
   *  一部分窗口（statusline 的 five_hour 可能整个缺席，事件流的 five_hour 不带用量）。
   *  只刷新了一格却把整段推到「刚刚」，旁边那个几小时前的数字就会显示成「刚刚采到」。 */
  at: number
  /** 这一格是哪条通道给的。冲突时靠它决定谁说了算（见 SRC_RANK）：
   *  `api` 直连 `/api/oauth/usage`，两个窗口永远都在、服务端原始口径，最权威；
   *  `statusline` 同样精确，但 payload 是条件展开的（某个窗口可能整个缺席）；
   *  `event` 只在跨阈值时报、且五小时不带用量；
   *  `log` 是 Codex 读自己的会话日志。 */
  src: 'api' | 'statusline' | 'event' | 'log'
  /** 服务端对这一格的告警判定原文（`limits[].severity`）。**只有 `api` 这条通道带**。
   *
   *  **存原文不存布尔**：目前只实测见过 `"normal"` 一个值（2026-08-23，当时额度
   *  4%/3%，触发不了任何告警），完整取值未知 —— 去 CLI 二进制里挖到的
   *  `severity:"warning"` 全是**配置校验**子系统的，跟额度无关。存成布尔就把
   *  「到底是哪一档」这个信息在入口处丢掉了，将来想分级得重新采数据。
   *  怎么解释它见 isHot()，那是唯一一处。 */
  severity?: string
}

/** 来源的权威度，数字大的说了算。**新增来源必须在这里排位** ——
 *  漏排会 `?? 0` 落到最低阶，表现成「新通道的数据永远盖不掉旧值」，
 *  而且不报错，只是安静地不更新。 */
const SRC_RANK: Record<QuotaWindow['src'], number> = { api: 3, statusline: 2, event: 1, log: 1 }

/** 一条新数据该不该盖掉这一格已有的值。
 *
 *  **两条来源同时活着是常态**（开着终端 + 用 AI 对话），而它们对同一个窗口给出的数字
 *  会差 1（statusline 的 79 对事件流 0.796×100 四舍五入的 80）。谁后到谁说了算的话，
 *  这一格会在 79/80 之间无限横跳 —— 80 正好是告警阈值，颜色也跟着红/不红地闪。
 *
 *  规则：**更权威的来源无条件覆盖**；低阶来源只在已有值旧到没有参考意义时才顶上；
 *  同级则新的赢。2026-08-23 从「statusline 特判」改成按 SRC_RANK 比较，
 *  因为接进来的 `api` 比 statusline 还权威，再往下特判会越写越绕。 */
export function shouldReplaceWindow(
  prev: QuotaWindow | undefined,
  next: QuotaWindow,
  staleMs: number
): boolean {
  if (!prev) return true
  const pr = SRC_RANK[prev.src] ?? 0
  const nr = SRC_RANK[next.src] ?? 0
  if (nr > pr) return true
  if (nr < pr) return next.at - prev.at >= staleMs
  return next.at >= prev.at
}

/** 没有服务端判定时，多少算「该紧张了」。
 *
 *  **这个数是我们自己拍的，服务端从没说过 80 是个坎** —— 它只是个不至于太早
 *  也不至于太晚的经验值。凡是 `severity` 拿得到的地方都不该走到这里。 */
export const HOT_FALLBACK_PERCENT = 80

/** 这一格要不要标红。**全项目唯一的告警判定处。**
 *
 *  优先信服务端：`severity` 不是 `normal` 就告警。为什么这么写而不是枚举出
 *  `warning` / `critical` 各自怎么办 —— 见 QuotaWindow.severity 的注释，
 *  完整取值我们没有实测依据。**「不是正常就告警」对任何没见过的新档位都成立**，
 *  而照着猜出来的枚举写分支，撞上没列到的值会静默地不告警。
 *
 *  拿不到 severity（statusline / 事件流 / Codex 日志）才回退到百分比阈值。
 *  这也是为什么阈值不能直接删掉：三条通道里只有一条带判定。
 *
 *  顺带治了旧的 79/80 横跳：那个 bug 的根子是「80 这个坎正好压在两条来源的
 *  舍入误差缝里」（statusline 报 79、事件流 0.796×100 进位成 80，颜色跟着闪）。
 *  severity 不是从百分比推的，没有这条缝。 */
export function isHot(w: QuotaWindow): boolean {
  if (typeof w.severity === 'string') return w.severity !== 'normal'
  return w.percent >= HOT_FALLBACK_PERCENT
}

/** 这一格是不是已经过了重置时刻 —— 过了就该作废，不能继续显示。
 *
 *  事件流只在跨阈值时才报，所以「本周 79% → 周窗口重置 → 下周一直没到阈值」
 *  这条路上没有任何东西会来覆盖它，那个 79% 会一直挂着，
 *  tooltip 里的「X 月 X 日重置」指的还是已经过去的时刻。 */
export function isWindowExpired(w: QuotaWindow | undefined, now: number): boolean {
  return !!w && typeof w.resetsAt === 'number' && w.resetsAt * 1000 < now
}

/** 一个 CLI 的额度快照。两个窗口都可能缺 —— 缺了就不显示那一格。 */
export interface CliQuota {
  /** 短窗口：Claude 是 5 小时，Codex 是 primary（付费计划通常也是 5 小时） */
  primary?: QuotaWindow
  /** 长窗口：Claude 是 7 天，Codex 是 secondary（free 计划为 null） */
  secondary?: QuotaWindow
  /** 这份数据是什么时候采到的（ms epoch）。落盘后重开软件显示「上次更新于」 */
  updatedAt: number
  /** Codex 侧带的计划类型，Claude 侧没有。只用于 hover 说明，不参与判断 */
  planType?: string
}

export interface QuotaSnapshot {
  claude?: CliQuota
  codex?: CliQuota
  /** 落盘的这份 Claude 额度属于哪个账号（`~/.claude.json` 的 oauthAccount.accountUuid）。
   *
   *  **不是可有可无的元数据**：2026-08-23 实测过一次真事故 —— `/login` 换账号后
   *  `cachedUsageUtilization` 连同我们自己的落盘快照都还是上一个账号的
   *  （里面 seven_day 94%，接口实际 3%）。那已经不是「显示个旧数字」，
   *  是**显示别人的额度**。对不上就把 claude 那半整个丢掉，宁可空着。
   *
   *  只对 Claude 侧有意义；Codex 那半读的是本机会话日志，不存在这个问题。 */
  claudeAccountUuid?: string
}

/** 百分比归一到 0–100 的整数。
 *
 *  **两边的口径不一样**：Claude 的 used_percentage 已经是 0–100，
 *  Codex 的 used_percent 也是（实测 `used_percent: 1.0` = 1%，不是 100%）。
 *  但 headless 事件流里那个 `utilization` 是 0–1 —— 所以调用方要自己传对，
 *  这里只做范围钳制，不猜单位。猜错的代价是显示一个差 100 倍的数字。 */
export function clampPercent(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** 从 Codex 会话日志的一行里抽额度。不是那种行就返回 null。
 *
 *  只认 `payload.type === 'token_count'` 里的 rate_limits —— 结构见文件头。
 *  **容错要宽**：这是别人的私有日志格式，随时可能变。任何一处对不上就当没有，
 *  绝不猜、绝不用别的字段倒推。 */
export function codexQuotaFromLine(line: string, now: number): CliQuota | null {
  let j: unknown
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  const rec = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  const payload = rec(rec(j)?.payload)
  if (payload?.type !== 'token_count') return null
  const rl = rec(payload.rate_limits)
  if (!rl) return null
  const win = (v: unknown): QuotaWindow | undefined => {
    const w = rec(v)
    if (!w) return undefined
    const percent = clampPercent(w.used_percent)
    if (percent === undefined) return undefined
    return {
      percent,
      windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : undefined,
      resetsAt: typeof w.resets_at === 'number' ? w.resets_at : undefined,
      at: now,
      src: 'log'
    }
  }
  const primary = win(rl.primary)
  const secondary = win(rl.secondary)
  if (!primary && !secondary) return null
  return {
    primary,
    secondary,
    updatedAt: now,
    planType: typeof rl.plan_type === 'string' ? rl.plan_type : undefined
  }
}

/** 从 statusline 转发脚本回传的那份 JSON 里抽 Claude 额度。拿不到就返回 null。
 *
 *  **字段名是驼峰**——回传的不是 Claude Code 原始的 statusline JSON，而是
 *  resources/agent-hooks/eas-statusline.mjs 挑出来重拼的 `{ contextWindow, rateLimits }`
 *  （只带我们要的两块，不让 transcript_path / cwd 这些路径信息经过这条通道）。
 *  2026-08-22 的事故就出在这：读取端照着原始 JSON 的 `rate_limits` 取，永远取不到，
 *  而失败是无声的（HTTP 照回 ok:true），于是额度条上 Claude 那半永远空着，
 *  Codex 那半（走会话日志、不经这条通道）却一切正常。两种都认，
 *  日后谁直接把原始 JSON 发过来也不会再哑掉。
 *
 *  五小时 / 七天两个窗口**只有这条通道里有**，headless 事件流里没有（见文件头）。
 *  used_percentage 已经是 0–100，不用换算。 */
export function claudeQuotaFromStatusline(data: unknown, now: number): CliQuota | null {
  const rec = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  const d = rec(data)
  const rl = rec(d?.rateLimits ?? d?.rate_limits)
  if (!rl) return null
  // 窗口长度是**我们**知道的（five_hour / seven_day 就是名字本身的意思），
  // 回传里不带 window_minutes——这点和 Codex 那条不同，别去取。
  const win = (v: unknown, minutes: number): QuotaWindow | undefined => {
    const w = rec(v)
    if (!w) return undefined
    const percent = clampPercent(w.used_percentage)
    if (percent === undefined) return undefined
    return {
      percent,
      windowMinutes: minutes,
      resetsAt: typeof w.resets_at === 'number' ? w.resets_at : undefined,
      at: now,
      src: 'statusline'
    }
  }
  const primary = win(rl.five_hour, 300)
  const secondary = win(rl.seven_day, 10080)
  if (!primary && !secondary) return null
  return { primary, secondary, updatedAt: now }
}

/** ISO 8601 → Unix 秒。**只有 `/api/oauth/usage` 这条通道需要它** ——
 *  statusline 和事件流给的本来就是 Unix 秒。
 *
 *  认不出来返回 undefined，**绝不返回 NaN**：NaN 会一路漂到倒计时和
 *  isWindowExpired 里，表现成「重置时刻空白 + 这一格永远不过期」，
 *  比干脆没有值更难查。 */
export function isoToUnixSeconds(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const ms = Date.parse(v)
  if (!Number.isFinite(ms)) return undefined
  return Math.floor(ms / 1000)
}

/** 直连 `/api/oauth/usage` 拿回来的那份 JSON → Claude 额度。拿不到就返回 null。
 *
 *  **这条通道绕开 CLI 直接问服务端**（2026-08-23 打通，HTTP 200 实测）。
 *  为什么值得多一条路：百分比本来就是服务端下发的，CLI 只是转述，而它唯一会
 *  转述出来的出口是 statusline —— 那是交互式 TUI 才有的东西。AI 对话走
 *  `claude -p`，没有状态栏，过去只能吃事件流那条残缺通道（五小时那格连
 *  utilization 字段都没有）。这条对谁都一样管用，且**不花任何推理 token**。
 *
 *  三个和别处不同、写错就是 bug 的地方：
 *
 *  · **`resets_at` 是 ISO 字符串**（`"2026-08-23T16:39:59.856192+00:00"`），
 *    不是 statusline / 事件流那种 Unix 秒。忘了换算就是 NaN，见 isoToUnixSeconds。
 *  · **`utilization` 是 0–100 的浮点**（实测 `4.0` 就是 4%），
 *    不是事件流那种 0–1。当成 0–1 去乘 100 会得到一个差 100 倍的数字。
 *  · **响应里有一大批 null 的代号窗口** —— 实测见到 `tangelo`、`nimbus_quill`、
 *    `iguana_necktie`、`omelette_promotional`、`cinder_cove`、`amber_ladder`、
 *    `seven_day_opus`、`seven_day_sonnet`、`seven_day_cowork` 等，是未启用的实验额度，
 *    **会随账号和计划变**。所以**只认 five_hour / seven_day 两个键，其余一律不碰**：
 *    遍历所有键去猜哪个是「周额度」，迟早撞上一个我们没见过的新代号。 */
export function claudeQuotaFromUsageApi(data: unknown, now: number): CliQuota | null {
  const rec = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  const d = rec(data)
  if (!d) return null
  // 窗口长度是**我们**知道的（five_hour / seven_day 就是名字本身的意思），
  // 响应里不带 window_minutes —— 和 statusline 那条一样，别去取
  // 服务端对每个窗口的告警判定藏在**另一个数组**里，得按 kind 认回去。
  //
  // **必须按 `kind` 而不是 `group`**：实测响应里 `weekly_all` 和 `weekly_scoped`
  // 的 group 都是 `"weekly"`，按 group 认会让「按模型分的那条周额度」
  // 覆盖掉真正的周额度判定。
  //
  // kind ↔ 窗口的对应关系是**对着实测数据核过的**，不是猜的：
  //   session    percent 4 / resets 2026-08-23T16:39:59.856192Z  ← 与 five_hour 逐字段一致
  //   weekly_all percent 3 / resets 2026-08-30T03:59:59.856221Z  ← 与 seven_day 逐字段一致
  const limits = Array.isArray(d.limits) ? d.limits : []
  const severityOfKind = (kind: string): string | undefined => {
    for (const item of limits) {
      const r = rec(item)
      if (r?.kind === kind && typeof r.severity === 'string') return r.severity
    }
    return undefined // 没有就没有 —— isHot() 会回退到百分比阈值
  }
  const win = (v: unknown, minutes: number, kind: string): QuotaWindow | undefined => {
    const w = rec(v)
    if (!w) return undefined
    const percent = clampPercent(w.utilization)
    if (percent === undefined) return undefined
    const resetsAt = isoToUnixSeconds(w.resets_at)
    const severity = severityOfKind(kind)
    return {
      percent,
      windowMinutes: minutes,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      ...(severity !== undefined ? { severity } : {}),
      at: now,
      src: 'api'
    }
  }
  const primary = win(d.five_hour, 300, 'session')
  const secondary = win(d.seven_day, 10080, 'weekly_all')
  if (!primary && !secondary) return null
  return { primary, secondary, updatedAt: now }
}

/** headless 事件流里的 `rate_limit_event` → 一个额度窗口。取不到百分比就返回 null。
 *
 *  **这是「只用 AI 对话的人」唯一拿得到额度的通道**：AI 对话走
 *  `claude -p --output-format stream-json`，没有状态栏，statusline 那条路整个不存在。
 *
 *  实测 payload（2026-08-17，见 main/agentChat/claudeEvents.ts 的注释）：
 *    five_hour：{ status, resetsAt, rateLimitType } —— **不带 utilization**
 *    seven_day：{ status:'allowed_warning', resetsAt, utilization:0.79, surpassedThreshold:0.75 }
 *  也就是说**只有超过阈值的那个窗口才报用量**，平时的五小时窗口报不出百分比。
 *  所以这条通道是 statusline 的**补充**而不是替代：它能填上的那个窗口就填，
 *  填不了的保持原样，绝不要因为「这次没报」就把已有的数字抹掉。
 *
 *  utilization 是 0~1，与 statusline 的 0~100 口径不同，这里换算。 */
export function claudeQuotaWindowFromEvent(
  window: string,
  utilization: number | undefined,
  resetsAt: number | undefined,
  now: number
): { slot: 'primary' | 'secondary'; w: QuotaWindow } | null {
  // 窗口名按已知的认，认不出来就不猜 —— 猜错会把用量记到另一个窗口上，
  // 那比不显示更糟（用户会以为五小时快满了）
  const slot: 'primary' | 'secondary' | null =
    window === 'five_hour' ? 'primary' : window === 'seven_day' || window === 'weekly' ? 'secondary' : null
  if (!slot) return null
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null
  const percent = clampPercent(utilization * 100)
  if (percent === undefined) return null
  return {
    slot,
    w: {
      percent,
      windowMinutes: slot === 'primary' ? 300 : 10080,
      ...(typeof resetsAt === 'number' ? { resetsAt } : {}),
      at: now,
      src: 'event'
    }
  }
}

/** 这个数是多久以前采到的。
 *
 *  额度**本来就不是实时的**：Claude 只能等 statusline 被动回传（CLI 什么时候刷
 *  由它决定，headless 模式下压根不刷），Codex 要等它自己写日志。与其假装实时，
 *  不如把新鲜度摆出来——用户至少知道眼前这个数该不该信。 */
export function agoLabel(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}

/** 窗口长度 → 给人看的说法。hover 时用。 */
export function windowLabel(minutes?: number): string {
  if (!minutes) return '当前窗口'
  if (minutes <= 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
  const days = Math.round(minutes / 1440)
  return days === 7 ? '本周' : `${days} 天`
}
