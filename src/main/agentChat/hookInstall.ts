// 往用户项目的 .claude/settings.json 装 PreToolUse hook 的「合并规划」。
// 背景（spec §九 第 2 条）：那是用户自己的文件，很可能已经有他自己配的 hooks／model／env
// 等字段。这里只算出「下一份配置应该长什么样」，不落盘——落盘是 Task 7 的事，且要过
// fsGuard 边界。本文件不 import fs，也不该 import。
//
// 识别「我们那条 hook」：命令路径里含 EAS_HOOK_MARKER 这个特征。这样升级换了安装位置
// （命令的绝对路径变了）时，能认出旧的那条并替换掉，不会两条并存。
//
// 四条来自对抗性测试（构造真实用户可能写出的畸形/手改 settings.json）才撞出来的坑，
// 读代码看不出来，写在这里防止将来又被"看起来对"的实现改回去：
// 1. 分组的 hooks 数组里混进 null／非对象项是合法但损坏的 JSON——任何读 h.command 的地方
//    都必须先 isPlainObject(h) 守卫，不能假设「判过一次带 marker 就说明整个数组都干净」。
// 2. 摘除旧痕迹之后，分组本身（含它的 matcher、以及分组里其它非 marker 条目）必须原样
//    保留——那是用户的分组，不是我们的，哪怕我们曾经往里面装过东西。
// 3. marker 可能同时出现在多个分组里（历史损坏、用户误复制）。必须全局扫描全部分组，
//    把带 marker 的旧痕迹统统清掉。
// 4. 【最要紧】我们的新条目永远只能落进 matcher: '*' 的分组——绝不能「摘除旧痕迹后，
//    把新条目放回原来那个分组」，因为那个分组的 matcher 可能不是 '*'（比如用户手改成
//    了 'Write'）。PreToolUse hook 的本意是拦下所有工具调用去弹审批卡片，一旦 matcher
//    被静默收窄，其它工具（Bash/Edit/...）就完全不经过审批、直接放行，没有任何报错。
//    所以「摘除旧痕迹」和「新条目该放哪」必须是两件独立的事，不能因为在同一次遍历里
//    顺手做就合并成一步。

const EAS_HOOK_MARKER = 'eas-pretooluse'

interface HookEntry {
  type: 'command'
  command: string
}

interface HookMatcherGroup {
  matcher: string
  hooks: HookEntry[]
}

interface MarkerHit {
  command: string
  matcher: unknown
}

export interface PlanHookInstallResult {
  /** 这次规划是否改变了配置（已装过同一条命令、且没有其它痕迹要清理时为 false）。 */
  changed: boolean
  /** 落盘应该写入的下一份配置。未改变时就是 existing 规范化后的原样内容。 */
  next: Record<string, unknown>
}

/**
 * 算出「安装/更新我们的 PreToolUse hook」之后，settings.json 应该长什么样。
 * 纯函数：不读不写任何文件，只接收内存里的对象、返回下一份对象，也不修改传入的 existing。
 *
 * @param existing 现有的 settings.json 内容（已 JSON.parse 过）。可能是坏的（不是对象、
 *   是 null、是数组，或者内部混着 null／非对象项、matcher 被改动过），这些情况一律
 *   尽量当空/跳过处理，不抛。
 * @param hookCmd 我们的 hook 脚本命令路径（含 EAS_HOOK_MARKER 特征）。
 */
export function planHookInstall(existing: unknown, hookCmd: string): PlanHookInstallResult {
  const base: Record<string, unknown> = isPlainObject(existing) ? existing : {}
  const existingHooks: Record<string, unknown> = isPlainObject(base.hooks) ? base.hooks : {}
  const existingPreToolUse: unknown[] = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : []

  // 全局收集所有「带 marker 特征」的条目，连同它们各自所在分组的 matcher。
  const markerHits: MarkerHit[] = existingPreToolUse.flatMap((group) => markerHitsOf(group))

  // 干净地已经装好：全局只有一条带 marker 的条目、命令精确等于这次要装的 hookCmd、
  // 且它就在 matcher: '*' 的分组里——三个条件缺一不可。少了最后一条，会把「装在错误
  // matcher 下」误判成无需改动，静默漏掉审批。
  if (markerHits.length === 1 && markerHits[0].command === hookCmd && markerHits[0].matcher === '*') {
    return { changed: false, next: base }
  }

  // 第一步：全局摘除所有带 marker 的旧条目。分组本身（含它的 matcher、以及分组里其它
  // 非 marker 条目，哪怕是用户手加的）原样保留；摘完空了的分组（通常是我们自己以前
  // 创建的空壳）整个丢弃。这一步完全不关心「新条目该放哪」。
  const stripped = stripMarkerHooks(existingPreToolUse)

  // 第二步：新条目永远落进 matcher: '*' 的分组——这一步之后才决定"放哪"，且只认
  // matcher 字面量是 '*' 的分组，不认任何摘除旧痕迹时顺手保留下来的其它分组。
  // 已经存在这样的分组就并进去，没有就新建一个追加在最后。
  const rebuilt = mergeIntoStarGroup(stripped, { type: 'command', command: hookCmd })

  const next: Record<string, unknown> = {
    ...base,
    hooks: { ...existingHooks, PreToolUse: rebuilt }
  }

  return { changed: true, next }
}

// ---- 纯函数小工具 ----

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 判断某个 hook 条目是不是带 marker 特征——对 null／非对象项一律安全返回 false，不抛。 */
function isMarkerHook(h: unknown): h is { command: string } {
  return isPlainObject(h) && typeof h.command === 'string' && h.command.includes(EAS_HOOK_MARKER)
}

/** 某个 PreToolUse 分组里，所有带 marker 特征的 hook 条目及其所在分组的 matcher。 */
function markerHitsOf(group: unknown): MarkerHit[] {
  if (!isPlainObject(group)) return []
  const hooksArr = group.hooks
  if (!Array.isArray(hooksArr)) return []
  const matcher = group.matcher
  return hooksArr.filter(isMarkerHook).map((h) => ({ command: h.command, matcher }))
}

/**
 * 全局摘除所有分组里带 marker 特征的条目。不认识的形状（非对象、没有 hooks 数组）原样
 * 透传；没有 marker 痕迹的分组原样透传（连引用都不换）；摘完还剩东西的分组保留、且
 * matcher 原封不动；摘完什么都不剩的分组整个丢弃。
 */
function stripMarkerHooks(groups: unknown[]): unknown[] {
  const result: unknown[] = []
  for (const group of groups) {
    if (!isPlainObject(group)) {
      result.push(group)
      continue
    }
    const hooksArr = group.hooks
    if (!Array.isArray(hooksArr)) {
      result.push(group)
      continue
    }
    const remaining = hooksArr.filter((h) => !isMarkerHook(h))
    if (remaining.length === hooksArr.length) {
      result.push(group) // 这个分组里没有我们的痕迹，原样保留（不改 matcher，不改内容）
    } else if (remaining.length > 0) {
      result.push({ ...group, hooks: remaining }) // 摘掉旧痕迹，matcher 与其它条目原样保留
    }
    // remaining.length === 0：这个分组摘完什么都不剩，整个丢弃，不放回 result
  }
  return result
}

// ── 卸载与状态查询（2026-08-14 全分支评审 C1 ③）：与 planHookInstall 共用同一套
// 「全局扫描 marker」逻辑（markerHitsOf / stripMarkerHooks），只是不再往里面装新条目。
// 都是纯函数，落盘/读盘是 session.ts 的事。 ──────────────────────────────────────

export interface HookInstallStatus {
  /** 当前已经装好、且落在正确的 matcher:'*' 分组下、命令路径也对得上 */
  installed: boolean
  /** 装了，但命令路径对不上（换过安装位置）或落在了错误的 matcher 分组——需要重装 */
  outdated: boolean
}

/** 只读查询版的 planHookInstall：算出"当前是否已经装好"，不产出下一份配置、不落盘。
 *  供 agentChat:hookStatus 用——用户想知道"这个项目现在有没有审批保护"，不需要真的
 *  跑一遍安装。判据与 planHookInstall 的"干净地已经装好"分支完全一致：全局只有一条带
 *  marker 的条目、命令精确匹配、且落在 matcher:'*' 分组下，三条缺一都算 outdated。 */
export function hookInstallStatusOf(existing: unknown, hookCmd: string): HookInstallStatus {
  const base: Record<string, unknown> = isPlainObject(existing) ? existing : {}
  const existingHooks: Record<string, unknown> = isPlainObject(base.hooks) ? base.hooks : {}
  const existingPreToolUse: unknown[] = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : []
  const markerHits: MarkerHit[] = existingPreToolUse.flatMap((group) => markerHitsOf(group))
  if (markerHits.length === 0) return { installed: false, outdated: false }
  const clean = markerHits.length === 1 && markerHits[0].command === hookCmd && markerHits[0].matcher === '*'
  return { installed: true, outdated: !clean }
}

export interface PlanHookUninstallResult {
  /** 这次规划是否改变了配置（没有任何我们的痕迹时为 false，不用写盘）。 */
  changed: boolean
  /** 落盘应该写入的下一份配置。未改变时就是 existing 规范化后的原样内容。 */
  next: Record<string, unknown>
}

/**
 * 算出"卸载我们的 PreToolUse hook"之后 settings.json 应该长什么样。纯函数，不落盘。
 * 只摘带 marker 的条目，用户自己的 hook／分组身份／其它字段一个不动——和 agentHook.ts
 * 的 uninstall() 同一个纪律。摘完某个分组空了就整个丢弃；hooks.PreToolUse 摘空了就删掉
 * 这个键，PreToolUse 之外的其它 hook 类型（PostToolUse 等）原样保留，不留空数组当空壳。
 */
export function planHookUninstall(existing: unknown): PlanHookUninstallResult {
  const base: Record<string, unknown> = isPlainObject(existing) ? existing : {}
  const existingHooks: Record<string, unknown> = isPlainObject(base.hooks) ? base.hooks : {}
  const existingPreToolUse: unknown[] = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : []

  const markerHits: MarkerHit[] = existingPreToolUse.flatMap((group) => markerHitsOf(group))
  if (markerHits.length === 0) return { changed: false, next: base }

  const stripped = stripMarkerHooks(existingPreToolUse)
  const nextHooks: Record<string, unknown> = { ...existingHooks }
  if (stripped.length > 0) nextHooks.PreToolUse = stripped
  else delete nextHooks.PreToolUse

  const next: Record<string, unknown> = { ...base }
  if (Object.keys(nextHooks).length > 0) next.hooks = nextHooks
  else delete next.hooks

  return { changed: true, next }
}

/**
 * 把新条目并入 matcher: '*' 的分组——已经存在（且形状合法）就并进去，否则新建一个
 * 追加在最后。绝不把新条目放进任何其它 matcher 的分组。
 */
function mergeIntoStarGroup(groups: unknown[], freshEntry: HookEntry): unknown[] {
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    if (!isPlainObject(g) || g.matcher !== '*') continue
    const hooksArr = g.hooks
    if (!Array.isArray(hooksArr)) continue // matcher 对但形状坏了，跳过，当作没找到
    const merged = groups.slice()
    merged[i] = { ...g, hooks: [...hooksArr, freshEntry] }
    return merged
  }
  const freshGroup: HookMatcherGroup = { matcher: '*', hooks: [freshEntry] }
  return [...groups, freshGroup]
}
