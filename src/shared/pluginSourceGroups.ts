// 插件按来源分组（抽屉「我的插件」与市场「已安装」共用）。纯函数，零依赖。
// 来源只看 `cli` 现有字段；`system` 插件（随包内置能力）不进列表，开关在设置页「内置能力」。
export type SourceKey = 'eas' | 'claude' | 'codex' | 'other'
export const SOURCE_ORDER: readonly { key: SourceKey; title: string }[] = [
  { key: 'eas', title: 'Eas-Term 插件' },
  { key: 'claude', title: '来自 Claude Code' },
  { key: 'codex', title: '来自 Codex' },
  { key: 'other', title: '其他' }
]

export interface SourceGroup<T> { key: SourceKey; title: string; items: T[] }

/** 输入列表 → 有序分组。已排除 system；空组不出现；组内保持输入顺序。 */
export function groupPluginsBySource<T>(list: readonly T[], pick: (t: T) => { cli: string; system?: boolean }): SourceGroup<T>[] {
  const buckets = new Map<SourceKey, T[]>()
  for (const item of list) {
    const { cli, system } = pick(item)
    if (system) continue
    const key: SourceKey = cli === 'eas' || cli === 'claude' || cli === 'codex' ? cli : 'other'
    const arr = buckets.get(key)
    if (arr) arr.push(item)
    else buckets.set(key, [item])
  }
  return SOURCE_ORDER.filter(s => buckets.has(s.key)).map(s => ({ ...s, items: buckets.get(s.key)! }))
}

/** 设置页「内置能力」列表：只取 system:true。 */
export function systemPlugins<T extends { system?: boolean }>(list: readonly T[]): T[] {
  return list.filter(p => p.system === true)
}

/** 市场弹窗各页（精选/分类/搜索/已安装/详情）用：去掉 system 项。
 *  「是否已装」的判断在此之前用完整列表算好，system 插件不会因此被提示安装。 */
export function excludeSystem<T>(list: readonly T[], pick: (t: T) => { system?: boolean } | undefined): T[] {
  return list.filter(t => pick(t)?.system !== true)
}
