export interface StartupChoice { model: string; effort: string }

/** 首轮与恢复失败后的重试必须使用同一份参数。空选择保留角色/CLI 默认。 */
export function startupParams(choice?: StartupChoice, roleModel?: string, roleEffort?: string): { model?: string; effort?: string } {
  const model = choice?.model || roleModel
  const effort = choice?.effort || (choice?.model ? undefined : roleEffort)
  return { ...(model ? {model} : {}), ...(effort ? {effort} : {}) }
}
