// 分类的读取端：把「skill 路径 → 分类名」的原始配置，安全地变成面板要显示的分组。
//
// **这一半只读。** 写入（给 agent 开的 MCP 分类口子）是另一半任务，那边落盘的数据
// 必须能被这里读到，所以形状先在这儿定下来：一份 `Record<skillPath, categoryName>`，
// 存在 app 自己的配置里（跟禁用清单同一处，见 skillLibrary/index.ts 的 cfgFile）。
//
// 「扁平一层，不可嵌套」「没有分类时全部归到未分类」是用户已经拍板的两条
// （design 文档 §六 第 3 条），下面的分组逻辑照这两条实现。
//
// 不引 electron/fs：输入是已经读出来的 JSON 值和一份「当前有效 skill 路径」的集合，
// node --test 直接测。

import type { SkillCategoryGroup, SkillInfo } from '../../shared/types'

export const UNCATEGORIZED = '未分类'

/** 分类名的长度上限（design 文档 §四：「分类名是字符串、非空、有长度上限」）。
 *  写入端（第二半 MCP 工具）校验用同一个常量，这里额外拿它做读取时的防御性过滤——
 *  正常不会触发，只防配置文件被手改成异常内容。 */
export const CATEGORY_NAME_MAX = 40

export type CategoryAssignment = Record<string, string>

/**
 * 校验 + 过滤一份原始分类配置（读盘拿到的 `unknown`）。
 *
 * **丢弃单条脏数据，不作废整份配置**——这是读取端的降级策略，跟写入端「引用了不存在
 * 的 skill 就拒绝整批」是两回事（那是 MCP 工具校验请求时的规则，写的时候就该挡住；
 * 这里处理的是已经落盘之后、磁盘状态可能已经变化的配置——比如 skill 目录后来被删了，
 * 配置里还留着一条指向它的分类。不能因为这一条脏，就让同一份配置里其余几十条分类全部失效）。
 *
 * 丢弃条件：不是字符串值 / 修剪后为空 / 超长 / 引用的 skill 路径当前不存在。
 */
export function sanitizeCategoryAssignment(raw: unknown, validSkillPaths: ReadonlySet<string>): CategoryAssignment {
  const out: CategoryAssignment = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [skillPath, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name || name.length > CATEGORY_NAME_MAX) continue
    if (!validSkillPaths.has(skillPath)) continue
    out[skillPath] = name
  }
  return out
}

/**
 * 按分类分组。未分类固定排最后一组——不管它是不是最大的一组，用户更想先看到
 * 「已经被整理过」的部分，未分类那堆本来就是待处理的，排前面反而抢眼。
 * 已命名分类之间按名称排序，保证同一份数据每次分组结果的组顺序都一样（不依赖
 * Map 的插入序，插入序取决于 skills 数组顺序，容易在不同调用间意外变化）。
 */
export function groupByCategory(skills: readonly SkillInfo[], assignment: CategoryAssignment): SkillCategoryGroup[] {
  const buckets = new Map<string, string[]>()
  for (const sk of skills) {
    const cat = assignment[sk.path]?.trim() || UNCATEGORIZED
    const list = buckets.get(cat)
    if (list) list.push(sk.path)
    else buckets.set(cat, [sk.path])
  }
  const names = [...buckets.keys()].filter((n) => n !== UNCATEGORIZED).sort((a, b) => a.localeCompare(b, 'zh'))
  if (buckets.has(UNCATEGORIZED)) names.push(UNCATEGORIZED)
  return names.map((name) => ({ name, skillPaths: buckets.get(name)! }))
}
