// 菜单里的关键词匹配。**纯函数** —— 「输入什么能匹到什么」是这类功能唯一
// 会被人反复挑剔的地方，必须能一条条钉死。
//
// ── 判据：子序列匹配 + 打分，不是 includes ────────────────────────
// 项目名常常是「Bzone-Gateway」「vibe coding/terminal」这样的复合词。
// 用 `includes` 的话，输入 "bg" 匹不到 "Bzone-Gateway"，而那正是人最想打的两个字母。
// 子序列匹配（按顺序出现即可）能接住这种输入。
//
// ── 中文按字匹配，不做拼音 ────────────────────────────────────────
// 拼音要带一张几万字的表，随包发出去。而中文项目名一般不长，
// 直接打其中一两个字（「桌面」「整理」）就够收窄了 —— 收益不抵体积。

/** 一次匹配的结果。分越小越靠前。null = 没匹上。 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0
  const t = text.toLowerCase()
  const q = query.toLowerCase()

  // 整段命中最优先：打全了就该排最前，不该被某个「首字母碰巧连着」的项挤下去
  const whole = t.indexOf(q)
  if (whole >= 0) return whole === 0 ? 0 : 1 + whole

  // 子序列：按顺序找每个字符
  let ti = 0
  let score = 1000
  let prev = -2
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return null
    // **连着的字符加分**（at === prev+1）：'bg' 匹 'Bzone-Gateway' 时，
    // 让 b…G 这种「词首」的组合排在 'B…zone里的g' 前面
    if (at !== prev + 1) score += 8
    // 词的开头（首字、或紧跟分隔符）额外加分
    if (at === 0 || /[\s\-_/.·]/.test(t[at - 1])) score -= 6
    score += at - ti // 跳过的字符越多越差
    prev = at
    ti = at + 1
  }
  return score
}

/** 按匹配度筛并排序。**排序稳定** —— 分一样时保持调用方给的顺序，
 *  那个顺序本身是有意义的（状态分层、最近使用）。 */
export function fuzzyPick<T>(items: T[], query: string, textOf: (x: T) => string): T[] {
  if (!query.trim()) return items
  return items
    .map((it, i) => ({ it, i, s: fuzzyScore(textOf(it), query.trim()) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => (a.s as number) - (b.s as number) || a.i - b.i)
    .map((x) => x.it)
}
