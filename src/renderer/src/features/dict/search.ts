// 辞典搜索：一个词条有六个地方可能命中，得分清是哪一个。
//
// ── 为什么不能直接用 fuzzyPick ────────────────────────────────────────
// 那个只吃一个字段。辞典要的是「名称命中排在分类命中前面，正文片段垫底」——
// 用户打「防抖」时，名字叫防抖的那条必须在第一位，而不是被某条正文里
// 提了一句防抖的词条挤下去。
//
// ── 长文本**不做子序列匹配**，这是这个文件最要紧的一条 ────────────────
// fuzzyScore 是子序列匹配（按顺序出现即可），这在「Bzone-Gateway」这种短名字上
// 是对的。但 logic 和 prompt 有 200–700 字：**任意三四个字符都能在里面按顺序找到**。
// 对长文本用子序列，等于打什么都匹配 381 条，搜索直接失效。
// 所以长字段只认整段子串（indexOf），短字段才用 fuzzyScore。
import { fuzzyScore } from '../canvas/fuzzy.ts'

export type Searchable = {
  zh: string
  en: string
  keywords: string[]
  category: string
  logic?: string
  prompt?: string
}

export type Hit = 'zh' | 'en' | 'keywords' | 'category' | 'logic' | 'prompt'

/** 字段基准分。**分越小越靠前**，所以这就是「先看名字、再看分类、正文垫底」的顺序。
 *  差值给得比 fuzzyScore 的浮动范围大，避免「正文里恰好整段命中」翻到名字前面。 */
const BASE: Record<Hit, number> = {
  zh: 0,
  en: 3000,
  keywords: 6000,
  category: 9000,
  prompt: 12000,
  logic: 15000
}

/** 正文命中时截多长的一段给用户看 */
const AROUND = 18

const sub = (text: string | undefined, q: string): number | null => {
  if (!text) return null
  const i = text.toLowerCase().indexOf(q)
  return i < 0 ? null : i
}

export type Scored<T> = { item: T; score: number; hit: Hit; excerpt?: string }

/**
 * 给一个词条打分。返回 null = 没匹上。
 *
 * `catLabel` 是分类的中文名（「交互行为」这种）—— 用户想按分类找时打的是它，
 * 不是 `interaction`。传空就等于不搜分类。
 */
export function scoreTerm<T extends Searchable>(
  item: T,
  query: string,
  catLabel?: string
): Scored<T> | null {
  const q = query.trim().toLowerCase()
  if (!q) return { item, score: 0, hit: 'zh' }

  const cands: Scored<T>[] = []
  const short = (v: string, hit: Hit): void => {
    const s = fuzzyScore(v, q)
    if (s !== null) cands.push({ item, score: BASE[hit] + s, hit })
  }
  short(item.zh, 'zh')
  short(item.en, 'en')
  for (const k of item.keywords) short(k, 'keywords')
  if (catLabel) short(catLabel, 'category')

  // 长字段：只认整段子串（见文件头）
  for (const hit of ['prompt', 'logic'] as const) {
    const text = item[hit]
    const at = sub(text, q)
    if (at === null || !text) continue
    const from = Math.max(0, at - AROUND)
    const to = Math.min(text.length, at + q.length + AROUND)
    cands.push({
      item,
      score: BASE[hit] + at,
      hit,
      // 掐头去尾都补省略号，让用户知道这是文中的一段而不是全部
      excerpt: (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '')
    })
  }
  if (!cands.length) return null
  // 同一条词条可能在好几个字段都命中 —— 取最好的那个，别让它在列表里出现两次
  return cands.reduce((a, b) => (b.score < a.score ? b : a))
}

/** 按匹配度筛并排序。**排序稳定**：分一样时保持传入顺序（那个顺序是有意义的）。 */
export function searchTerms<T extends Searchable>(
  items: readonly T[],
  query: string,
  catLabelOf: (t: T) => string | undefined = () => undefined
): Scored<T>[] {
  if (!query.trim()) return items.map((item) => ({ item, score: 0, hit: 'zh' as const }))
  return items
    .map((item, i) => ({ r: scoreTerm(item, query, catLabelOf(item)), i }))
    .filter((x): x is { r: Scored<T>; i: number } => x.r !== null)
    .sort((a, b) => a.r.score - b.r.score || a.i - b.i)
    .map((x) => x.r)
}
