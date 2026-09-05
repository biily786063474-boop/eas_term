// 技能库抽屉的搜索：给一个查询串，从一批 skill 里挑出匹配的并**排好序**。
//
// **纯函数，`node --test` 直接跑。** 排序规则错了不会崩，只会表现成「搜出来的
// 顺序不对劲」，肉眼很难在几十个 skill 里核对 —— 抽出来测。
//
// ── 规则（用户 2026-09-05 定的）─────────────────────────────────────────
//   · **description 里含查询串的排最前**：用户找 skill 时记得的是「它干什么」，
//     不是目录名 —— 所以 description 命中比 name 命中优先。
//   · 其次 name 命中；再次是各词分别落在 name / description 里的。
//   · 同一档内保持原来的顺序（分类里的顺序是用户拖出来的，别打乱）。
//   · 大小写不敏感；按空白拆成多个词，**每个词都得命中**才算。

export interface SearchableSkill {
  name: string
  description: string
}

/** 命中档位。数字越小越靠前；-1 = 没命中。 */
function tierOf(s: SearchableSkill, terms: readonly string[]): number {
  const d = s.description.toLowerCase()
  const n = s.name.toLowerCase()
  if (terms.every((t) => d.includes(t))) return 0
  if (terms.every((t) => n.includes(t))) return 1
  if (terms.every((t) => d.includes(t) || n.includes(t))) return 2
  return -1
}

/** 把查询串拆成词。空串 / 全空白 → 空数组（= 不过滤）。 */
export function termsOf(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * 筛选 + 排序。查询为空时原样返回（拷贝），不做任何过滤。
 * 稳定排序：先按档位，同档按原下标。
 */
export function rankSkills<T extends SearchableSkill>(skills: readonly T[], query: string): T[] {
  const terms = termsOf(query)
  if (terms.length === 0) return [...skills]
  return skills
    .map((s, i) => ({ s, i, t: tierOf(s, terms) }))
    .filter((x) => x.t >= 0)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.s)
}
