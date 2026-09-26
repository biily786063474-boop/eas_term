/** Short enough to share across Claude, Codex and OMP without an extra model call. */
export function executionPlanGuidance(enabled: boolean): string {
  return enabled
    ? '多步骤执行任务：开始操作前同轮调用 plan_create；延续任务用 plan_get/step_update；仅在工具成功回执后报告清单变化。普通问答和单步操作无需建计划。'
    : ''
}
