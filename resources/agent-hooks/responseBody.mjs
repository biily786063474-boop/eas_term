// ⚠️ 与 src/main/agentChat/approvalRoute.ts 里的 hookResponseBody 必须保持逐字同一形状——
// 这份是独立 Node 进程用的 .mjs，import 不到那份 TS 代码，只能各写一份。
// **改一处必须改另一处**，两边若不一致就是 bug（审批响应体的形状会跟 Claude Code 对不上）。
export const hookResponseBody = (decision, reason) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  })
