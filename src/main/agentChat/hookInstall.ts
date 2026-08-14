// 往用户项目的 .claude/settings.json 装 PreToolUse hook 的「合并规划」。
// 背景（spec §九 第 2 条）：那是用户自己的文件，很可能已经有他自己配的 hooks／model／env
// 等字段。这里只算出「下一份配置应该长什么样」，不落盘——落盘是 Task 7 的事，且要过
// fsGuard 边界。本文件不 import fs，也不该 import。
//
// 识别「我们那条 hook」：命令路径里含 EAS_HOOK_MARKER 这个特征。这样升级换了安装位置
// （命令的绝对路径变了）时，能认出旧的那条并替换掉，不会两条并存。

const EAS_HOOK_MARKER = 'eas-pretooluse'

interface HookEntry {
  type: 'command'
  command: string
}

interface HookMatcherGroup {
  matcher: string
  hooks: HookEntry[]
}

export interface PlanHookInstallResult {
  /** 这次规划是否改变了配置（已装过同一条命令时为 false，不重复追加）。 */
  changed: boolean
  /** 落盘应该写入的下一份配置。未改变时就是 existing 规范化后的原样内容。 */
  next: Record<string, unknown>
}

/**
 * 算出「安装/更新我们的 PreToolUse hook」之后，settings.json 应该长什么样。
 * 纯函数：不读不写任何文件，只接收内存里的对象、返回下一份对象。
 *
 * @param existing 现有的 settings.json 内容（已 JSON.parse 过）。可能是坏的（不是对象、
 *   是 null、是数组），这些情况一律当成空配置处理，不抛。
 * @param hookCmd 我们的 hook 脚本命令路径（含 EAS_HOOK_MARKER 特征）。
 */
export function planHookInstall(existing: unknown, hookCmd: string): PlanHookInstallResult {
  const base: Record<string, unknown> = isPlainObject(existing) ? existing : {}

  const existingHooks: Record<string, unknown> = isPlainObject(base.hooks) ? base.hooks : {}
  const existingPreToolUse: unknown[] = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : []

  // 找出用户配置里「已经是我们装的那条」（按 EAS_HOOK_MARKER 特征识别，不管具体路径），
  // 其余的（用户自己的、或其它 matcher 下的）原样保留、顺序不变。
  const ourIndex = existingPreToolUse.findIndex((group) => isOurGroup(group))
  const ourGroup = ourIndex >= 0 ? (existingPreToolUse[ourIndex] as HookMatcherGroup) : undefined
  const alreadyInstalled = ourGroup !== undefined && ourGroup.hooks.some((h) => h.command === hookCmd)

  if (alreadyInstalled) {
    // 命令路径没变——不重复追加，也不改变其它任何东西。
    return { changed: false, next: base }
  }

  const nextGroup: HookMatcherGroup = { matcher: '*', hooks: [{ type: 'command', command: hookCmd }] }
  const nextPreToolUse =
    ourIndex >= 0
      ? existingPreToolUse.map((group, i) => (i === ourIndex ? nextGroup : group)) // 换路径：原地替换，不留两条
      : [...existingPreToolUse, nextGroup] // 首次安装：追加在用户已有的后面

  const next: Record<string, unknown> = {
    ...base,
    hooks: { ...existingHooks, PreToolUse: nextPreToolUse }
  }

  return { changed: true, next }
}

// ---- 纯函数小工具 ----

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 判断 PreToolUse 数组里的某一项是不是「我们装的那条」——按命令路径里的特征识别。 */
function isOurGroup(group: unknown): group is HookMatcherGroup {
  if (!isPlainObject(group) || !Array.isArray(group.hooks)) return false
  return group.hooks.some(
    (h) => isPlainObject(h) && typeof h.command === 'string' && h.command.includes(EAS_HOOK_MARKER)
  )
}
