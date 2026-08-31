// 起会话时要不要给子进程打上「这是 agent-chat 会话」的标记。
//
// ── 这个文件为什么存在（2026-08-31 用户报的 bug）────────────────────
// `resources/agent-hooks/eas-pretooluse.mjs` 是 Claude Code 的 PreToolUse hook，
// **旧版本（2026-08-17 之前）会自动把它装进每个项目的 .claude/settings.json**。
// 它的逻辑是：拿得到 EAS_AGENT_CHAT_SESSION → 这是我们的会话 → 拦下来问用户；
// 拿不到 → **无声放行**，交还给 Claude Code 自己的权限流程。
//
// 后来审批改成「伪无头」（不装 hook，改往系统提示里附一段「动手前先说明意图」）。
// 但改的只是**不再装**，用户仓库里**已经装了的那些没人卸**，而这个标记当时是
// **无条件注入**的 —— 于是残留的 hook 照样拦，每次工具调用都弹审批卡片。
//
// 用户的说法是「设置里我写的取消审批，怎么还跳审批」。设置里那个开关叫「先问再做」，
// 它自己的说明写着「不写任何配置文件」—— 它管的是系统提示，从设计上就不碰 hook 文件。
// 所以关掉它对残留 hook 毫无作用。
//
// 修法就是这里：**没启用审批时不打这个标记**，让残留 hook 走它自己设计好的无声放行。
// 不去动用户仓库里的文件（那是他的 .claude/settings.json，我们没有不问就改的道理；
// 设置面板里那个开关切一下会清，那是主动清理的入口）。

/**
 * @param sessionId 这个会话的 id
 * @param skipApprovalHook 这个会话跳过审批 hook（= 没启用审批）。
 *   **undefined 按「跳过」算**（见下）。
 */
export function approvalEnv(
  sessionId: string,
  skipApprovalHook: boolean | undefined
): Record<string, string> {
  // 只有**明确**要审批（=== false）才打标记。
  //
  // undefined 走哪一支是有讲究的：SessionRecord 里这个字段是可选的，从磁盘恢复的
  // 老会话记录可能没有它。倒过来判（undefined 当成「要审批」）的话，那些老会话
  // 一恢复就又被残留 hook 拦上了 —— 而这正是要修的毛病。
  // 所以缺省一律按「不打标记」处理：放行是安全的默认，拦截不是。
  if (skipApprovalHook !== false) return {}
  return { EAS_AGENT_CHAT_SESSION: sessionId }
}
