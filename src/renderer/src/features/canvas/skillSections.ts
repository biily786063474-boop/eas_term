// Skill 面板的「来源分段」规划。纯函数、零 import——这样 node --test 能直接跑它
// （和 mediaExts.ts / tidyOrder.ts 同一条规矩：值 import 会把 electron 拖进来，测不了）。
//
// 为什么需要分段：选中项目 Frame 时，面板原先把目录**整个换成**该项目的
// `.claude/skills`，全局那几个目录连同下拉按钮一起消失。但用户在项目里干活时，
// 用得最多的恰恰是全局 skill——项目级只有寥寥几个，全局有上百个。
// 「切到项目就看不见全局」等于把常用的那批藏起来了。
//
// 所以改成两段并存：项目级在上、全局在下，各自带来源标注。
// 两段各自是一次独立的 `skillLibrary:list` 调用，分类分组、禁用清单都由主进程按目录算。

export type SkillScope = 'project' | 'global'

export interface SkillSection {
  /** React key，也是段折叠状态的 key。用路径而不是 scope——同一个 scope 的路径会变 */
  key: string
  scope: SkillScope
  /** 段头主标题：项目名 / 目录名 */
  label: string
  /** 来源标注，就是用户要的「标注清楚」 */
  tag: string
  path: string
}

/** 去掉尾部斜杠再比。渲染层不引 node 的 path，历来手拼（见 CanvasSkillPanel 的 projectSkillDir）。 */
const norm = (p: string): string => p.replace(/[/\\]+$/, '')

/**
 * 规划要显示哪几段。项目段永远排在全局段前面——这是用户明确要的顺序，
 * 也符合实际：在项目里干活时先看这个项目自己的 skill。
 *
 * **两段路径撞车时只留项目那段**：用户完全可能把某个项目的 `.claude/skills`
 * 手动加成自定义全局目录（面板本来就允许加任意目录）。不去重的话同一批 skill
 * 会上下各出现一次，右键复制/禁用还会作用到"另一个自己"上，看起来像鬼影。
 */
export function planSkillSections(opts: {
  projectName?: string | null
  projectPath?: string | null
  globalLabel?: string | null
  globalPath?: string | null
}): SkillSection[] {
  const out: SkillSection[] = []
  const projectPath = opts.projectPath?.trim()
  const globalPath = opts.globalPath?.trim()

  if (projectPath) {
    out.push({
      key: norm(projectPath),
      scope: 'project',
      label: opts.projectName?.trim() || '这个项目',
      tag: '项目',
      path: projectPath
    })
  }
  if (globalPath && !out.some((s) => norm(s.path) === norm(globalPath))) {
    out.push({
      key: norm(globalPath),
      scope: 'global',
      label: opts.globalLabel?.trim() || globalPath,
      tag: '全局',
      path: globalPath
    })
  }
  return out
}
