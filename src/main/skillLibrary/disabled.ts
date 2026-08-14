// 临时禁用清单。**只写这份清单，绝不动硬盘上的 skill 文件**
//（design 文档 §六 第 1 条，用户拍板过）。
//
// 已知并被用户接受的代价：CLI 自己仍然会加载被禁用的 skill，
// 「禁用」只在本软件的视图里生效。面板上要把这句话说给用户看（CanvasSkillPanel 里那行提示），
// 别让人以为点一下就把 Claude Code 那边也关掉了。
//
// 存在 `<userData>/skills.json` 的 `disabled` 字段里，跟 customDirs / categories 同一份文件。
// 不引 electron/fs：输入是读盘拿到的 JSON 值，node --test 直接测。

/** 校验一份读盘拿来的禁用清单。丢弃单条脏数据、不作废整份——
 *  跟 category.ts 的 sanitizeCategoryAssignment 同一条降级策略。
 *
 *  **故意不校验「这个 skill 现在还存不存在」**：跟分类不一样，禁用清单里的陈旧条目
 *  是有用的——用户把某个 skill 目录临时挪走再挪回来，禁用状态应该还在。
 *  一条指向不存在路径的禁用记录不会造成任何显示错误（面板按 skills 列表渲染，
 *  只查 disabled 里有没有它），留着比清掉安全。 */
export function sanitizeDisabled(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const p = v.trim()
    if (!p || !p.startsWith('/')) continue // 只认绝对路径——skill 的唯一 id 就是它的绝对路径
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/** 禁用 / 恢复一个 skill，返回改完之后的整份清单。
 *  幂等：重复禁用不会塞进两条，恢复一个本来就没禁的也不报错。 */
export function applyDisabled(list: readonly string[], skillPath: string, disabled: boolean): string[] {
  const p = skillPath.trim()
  if (!p) return [...list]
  const without = list.filter((x) => x !== p)
  return disabled ? [...without, p] : without
}
