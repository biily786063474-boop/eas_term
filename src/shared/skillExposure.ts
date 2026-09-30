// skill「自动发现」开关的判定 —— 主进程（起会话时算隐藏名单）与渲染层（面板标记、`/` 菜单）
// 共用这一份，两边各写一份迟早对不上：面板显示「需点名」的，必须正好是模型看不到的那些。
// 零依赖，node --test 直接跑。落盘与扫盘在 main/skillLibrary/exposure.ts。

export type Exposure = 'on' | 'off'

export interface ExposureConfig {
  /** 缺省 true = 现状（全部暴露） */
  exposeByDefault: boolean
  /** skill 目录绝对路径 → 单独设置，缺省跟随全局 */
  exposure: Record<string, Exposure>
}

/** 永远不隐藏：Eas-Term 自己分发的能力指引（`main/agentRules.ts` 写进 `~/.claude/skills/` 的目录名）。
 *  关掉它们模型就不知道自己能操作画布、生图、查知识库 —— 那不是省上下文，是把能力拆了。 */
export const EXPOSURE_EXEMPT: ReadonlySet<string> = new Set(['eas-term', 'eas-wiki'])

/** skill 目录名（路径最后一段） */
export function skillDirName(skillPath: string): string {
  const parts = skillPath.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] ?? ''
}

export function isExemptSkill(skillPath: string): boolean {
  return EXPOSURE_EXEMPT.has(skillDirName(skillPath))
}

/** 单个 skill 是否暴露给模型：豁免 > 单独设置 > 全局 */
export function isSkillExposed(cfg: ExposureConfig, skillPath: string): boolean {
  if (isExemptSkill(skillPath)) return true
  const own = cfg.exposure[skillPath]
  if (own) return own === 'on'
  return cfg.exposeByDefault
}
