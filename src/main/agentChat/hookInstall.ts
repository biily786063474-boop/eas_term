// 往用户项目的 .claude/settings.json 装 PreToolUse hook 的「合并规划」。
// 背景（spec §九 第 2 条）：那是用户自己的文件，很可能已经有他自己配的 hooks／model／env
// 等字段。这里只算出「下一份配置应该长什么样」，不落盘——落盘是 Task 7 的事，且要过
// fsGuard 边界。本文件不 import fs，也不该 import。
//
// 识别「我们那条 hook」：命令路径里含 EAS_HOOK_MARKER 这个特征。这样升级换了安装位置
// （命令的绝对路径变了）时，能认出旧的那条并替换掉，不会两条并存。
//
// 三条来自对抗性测试（构造真实用户可能写出的畸形/手改 settings.json）才撞出来的坑，
// 读代码看不出来，写在这里防止将来又被"看起来对"的实现改回去：
// 1. 分组的 hooks 数组里混进 null／非对象项是合法但损坏的 JSON——任何读 h.command 的地方
//    都必须先 isPlainObject(h) 守卫，不能假设「判过一次带 marker 就说明整个数组都干净」。
// 2. 换路径时绝不能把整个分组对象整体换掉——分组的 hooks 数组里可能混着用户自己手加的
//    条目（尤其是 matcher 恰好也是 '*' 时，用户很自然会往同一个分组里加东西）。必须只在
//    数组内部摘掉带 marker 的旧条目，其余原样保留，新条目加在同一个位置。
// 3. marker 可能同时出现在多个分组里（历史损坏、用户误复制粘贴）。必须全局扫描全部分组，
//    把带 marker 的旧痕迹统统清掉，只在第一次命中的地方补回一条新的，不能只处理
//    「找到的第一个」就收工。

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
 *   是 null、是数组，或者内部混着 null／非对象项），这些情况一律尽量当空/跳过处理，不抛。
 * @param hookCmd 我们的 hook 脚本命令路径（含 EAS_HOOK_MARKER 特征）。
 */
export function planHookInstall(existing: unknown, hookCmd: string): PlanHookInstallResult {
  const base: Record<string, unknown> = isPlainObject(existing) ? existing : {}
  const existingHooks: Record<string, unknown> = isPlainObject(base.hooks) ? base.hooks : {}
  const existingPreToolUse: unknown[] = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : []

  // 全局收集所有「带 marker 特征」的条目——不管它们分散在几个分组里、
  // 也不管同一分组里还混着什么别的（哪怕是 null）。
  const markerEntries = existingPreToolUse.flatMap((group) => markerHooksOf(group))

  // 干净地已经装好：全局只有一条带 marker 的条目，且命令精确等于这次要装的 hookCmd——
  // 没有旧痕迹要清、也没有别处的重复，原样返回，不做任何拷贝。
  if (markerEntries.length === 1 && markerEntries[0].command === hookCmd) {
    return { changed: false, next: base }
  }

  const freshEntry: HookEntry = { type: 'command', command: hookCmd }
  let inserted = false
  const rebuilt: unknown[] = []

  for (const group of existingPreToolUse) {
    if (!isPlainObject(group)) {
      rebuilt.push(group) // 不认识的形状（比如 null），原样保留，不碰
      continue
    }
    const hooksArr = group.hooks
    if (!Array.isArray(hooksArr)) {
      rebuilt.push(group) // 没有 hooks 数组，不是我们要处理的分组形状，原样保留
      continue
    }
    const strippedHooks = hooksArr.filter((h) => !isMarkerHook(h))
    if (strippedHooks.length === hooksArr.length) {
      rebuilt.push(group) // 这个分组里没有我们的痕迹，原样保留（用户自己的分组，一字不改）
      continue
    }

    // 这个分组里摘掉了至少一条我们的旧痕迹——分组内其余条目（哪怕是用户手加进同一个
    // matcher 分组的脚本）必须留着，不能连带被冲掉。
    if (!inserted) {
      rebuilt.push({ ...group, hooks: [...strippedHooks, freshEntry] })
      inserted = true
    } else if (strippedHooks.length > 0) {
      rebuilt.push({ ...group, hooks: strippedHooks }) // 摘完还剩别的（用户的），分组留着
    }
    // 摘完什么都不剩：这个分组是我们自己造的空壳，直接丢弃，不放回 rebuilt
  }

  if (!inserted) {
    // 全局压根没有任何带 marker 的痕迹：首次安装，追加一个全新分组在最后。
    const freshGroup: HookMatcherGroup = { matcher: '*', hooks: [freshEntry] }
    rebuilt.push(freshGroup)
  }

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
function isMarkerHook(h: unknown): boolean {
  return isPlainObject(h) && typeof h.command === 'string' && h.command.includes(EAS_HOOK_MARKER)
}

/** 某个 PreToolUse 分组里，所有带 marker 特征的 hook 条目（形状不合法时返回空数组，不抛）。 */
function markerHooksOf(group: unknown): { command: string }[] {
  if (!isPlainObject(group)) return []
  const hooksArr = group.hooks
  if (!Array.isArray(hooksArr)) return []
  return hooksArr.filter(isMarkerHook) as { command: string }[]
}
