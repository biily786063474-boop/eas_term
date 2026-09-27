/** Short enough to share across Claude, Codex and OMP without an extra model call. */
export function executionPlanGuidance(enabled: boolean): string {
  return enabled
    ? '多步骤执行任务：开始操作前同轮调用 plan_create；延续任务用 plan_get/step_update；实际完成并验证后用 step_update reported_done 自动勾选，全部完成后本轮结束自动收尾，无需用户验收；仅在工具成功回执后报告清单变化。普通问答和单步操作无需建计划。'
    : ''
}
