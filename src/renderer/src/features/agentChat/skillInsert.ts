// 输入框里选中一个 skill 之后，插进去（也就是最终发给 CLI）的那句话。纯函数，node --test 直接跑。
//
// 三种写法，按「能直接调用就直接调用」排：
//
// 1. **Claude + 消息开头的 `/` + skill 在 Claude 会加载的目录里** → 原生 `/名字`。
//    2026-09-30 实测（stream-json 模式，与 Eas-Term 起会话的方式相同）：零工具调用直接执行，
//    后面追加说明也照样生效；「AI 自动发现」关掉（skillOverrides=user-invocable-only）之后仍可用。
//    `/` 模式只在整条消息以 `/` 开头时触发（triggerAt），正好满足原生命令必须在开头的要求。
// 2. **skill 被「AI 自动发现」关掉、又走不了原生命令**（`@` 句中引用 / Codex / CLI 不扫的目录）
//    → 「按照 <SKILL.md> 中的说明执行」。**不写「使用技能 X」**：那句会让 Claude 先去调 Skill 工具，
//    被拒后在回复里说「这个 skill 被禁用了」再去读文件 —— 用户主动点名时不该看到这句。
// 3. 其余照旧：「使用技能「名字」（路径）」—— 开着的 skill，模型会走 CLI 自己的 skill 机制。

export interface SkillInsertInput {
  cli?: string
  mode?: '/' | '@'
  skillPath: string
  /** frontmatter 名（解析不出时是目录名） */
  name: string
  /** 这个 skill 当前是否对模型暴露（shared/skillExposure.ts 算） */
  exposed: boolean
  /** Claude 会加载的 skill 目录（全局 `~/.claude/skills` + 当前项目 `.claude/skills`） */
  claudeDirs: readonly string[]
}

const trim = (p: string): string => p.replace(/[/\\]+$/, '')
const parentOf = (p: string): string => trim(p).replace(/[/\\][^/\\]+$/, '')
const dirNameOf = (p: string): string => trim(p).split(/[/\\]/).pop() ?? ''

export function skillInsertText(i: SkillInsertInput): string {
  const md = `${trim(i.skillPath)}/SKILL.md`
  if (i.cli === 'claude' && i.mode === '/' && i.claudeDirs.some((d) => trim(d) === parentOf(i.skillPath))) {
    // 命令名：frontmatter 名能当命令就用它（和面板上显示的一致），否则退回目录名 —— 两个 Claude 都认（实测）
    const cmd = /^[\w.:-]+$/.test(i.name) ? i.name : dirNameOf(i.skillPath)
    return `/${cmd}`
  }
  if (!i.exposed) return `按照 ${md} 中的说明执行` // i18n-allow: 插入输入框、发给 AI 的原文
  return `使用技能「${i.name}」（${md}）` // i18n-allow: 插入输入框、发给 AI 的原文
}
