import { t, getLang } from '../../i18n.ts'
import dsEn from './design-systems.en.json' with { type: 'json' }

export interface DesignSystem {
  designSpec?: { text: string; tokensCss: string; page: string }
  interfaceTypes?: string[]; classificationNote?: string
  slug: string; title: string; services: string[]; tone: string
  corpus: string; swatch: { n: string; v: string }[]; tokenCount: number; colorCount: number
}
export type DesignScope = 'colors' | 'system'
export const interfaceTypeIds = ['all', 'website', 'webapp', 'mobile', 'desktop', 'hardware', 'component', 'unknown'] as const
type InterfaceTypeId = (typeof interfaceTypeIds)[number]
/** 界面类型的显示名。**调用时取**（语言可切换），不做成模块顶层常量 */
export function interfaceTypeLabel(id: string): string {
  const k = (interfaceTypeIds as readonly string[]).includes(id) ? (id as InterfaceTypeId) : 'unknown'
  return t(`dictUi.ds.type.${k}` as const)
}
export function designTypes(s: DesignSystem): string[] {
  return s.interfaceTypes?.length ? s.interfaceTypes : ['unknown']
}
export function designTypeLabel(s: DesignSystem): string {
  return designTypes(s).map(interfaceTypeLabel).join(' / ')
}

// ── 英文显示层 ─────────────────────────────────────────────────────────
// design-systems.json 不动（307 条是从选型库生成的）；英文界面下标题里的中文片段、分类名、
// 摘要标签按 design-systems.en.json 映射。映射不到的标题整段保留原文，不拼半中半英。
const EN = dsEn as unknown as {
  titleKit: [string, string]; titleSuffix: [string, string]
  titlePhrases: Record<string, string>; services: Record<string, string>; notes: Record<string, string>
  categoryLabel: [string, string]; corpus: [string, string][]
}
const CJK = /[\u4e00-\u9fff]/
const isEn = (): boolean => getLang() === 'en'

/** 标题的英文显示：「X 设计系统 Design Kit — …」→「X Design Kit — …」，「… · 中文 · 设计套件」→「… · Design Kit」 */
export function localizeDesignTitle(title: string, en = isEn()): string {
  if (!en || !CJK.test(title)) return title
  const parts = title.replace(EN.titleKit[0], EN.titleKit[1]).split(' · ')
  const out: string[] = []
  for (const p of parts) {
    if (!CJK.test(p)) out.push(p)
    else if (p === EN.titleSuffix[0]) out.push(EN.titleSuffix[1])
    else if (p in EN.titlePhrases) { if (EN.titlePhrases[p]) out.push(EN.titlePhrases[p]) }
    else return title
  }
  const r = out.join(' · ')
  return CJK.test(r) ? title : r
}
/** 卡片 / chip 上的短名（与中文界面同一套切法：先按原文切，再做英文映射） */
export function designShortName(s: DesignSystem, en = isEn()): string {
  return localizeDesignTitle(s.title.split(' Design')[0].split(' 设计系统')[0], en) // i18n-allow: 切分原始标题数据
}
export function designServiceLabel(service: string, en = isEn()): string {
  return en ? EN.services[service] ?? service : service
}
export function designNote(note: string | undefined, en = isEn()): string | undefined {
  return en && note ? EN.notes[note] ?? note : note
}
/** 摘要（corpus）的英文显示：标题行、分类行、各项标签 */
export function localizeDesignCorpus(corpus: string, en = isEn()): string {
  if (!en) return corpus
  return corpus.split('\n').map((line) => {
    if (line.startsWith('## ')) return '## ' + localizeDesignTitle(line.slice(3), true)
    if (line.startsWith(EN.categoryLabel[0]))
      return EN.categoryLabel[1] + line.slice(EN.categoryLabel[0].length).split(' / ').map((x) => designServiceLabel(x, true)).join(' / ')
    let l = line
    for (const [a, b] of EN.corpus) l = l.split(a).join(b)
    return l
  }).join('\n')
}

export function findDesignSystems(rows: DesignSystem[], query: string, tone: string, type = 'all'): DesignSystem[] {
  const q = query.trim().toLowerCase()
  const en = isEn()
  return rows.filter(s => (tone === 'all' || s.tone === tone) &&
    (type === 'all' || designTypes(s).includes(type)) &&
    // 英文界面额外搜英文标题 / 分类名；中文原文照样能搜到
    (s.title + ' ' + s.slug + ' ' + s.services.join(' ') + ' ' + designTypeLabel(s) +
      (en ? ' ' + localizeDesignTitle(s.title, true) + ' ' + s.services.map(x => designServiceLabel(x, true)).join(' ') : '')).toLowerCase().includes(q))
}
/** 发给 AI 的设计参考提示词。创作参考是「AI 提示词不翻」的例外：英文界面发英文，中文逐字节不变 */
export function designPrompt(s: DesignSystem, scope: DesignScope): string {
  const en = isEn()
  const heading = t('dictUi.ds.prompt.heading', { title: localizeDesignTitle(s.title, en) }) + '\n'
  const corpus = localizeDesignCorpus(s.corpus, en)
  if (scope === 'system') return heading + '\n' + (s.designSpec ? t('dictUi.ds.prompt.specFirst') : corpus) +
    (s.designSpec ? '\n\n' + t('dictUi.ds.prompt.specBody', { text: s.designSpec.text, css: s.designSpec.tokensCss }) : '\n\n' + t('dictUi.ds.prompt.noSpec')) +
    '\n\n' + t('dictUi.ds.prompt.footer')
  const keyLine = s.corpus.split('\n').find(line => line.includes('关键色板')) ?? '' // i18n-allow: 按原始数据里的中文标签找行
  const key = localizeDesignCorpus(keyLine, en)
  const colors = s.swatch.map(c => t('dictUi.ds.prompt.swatch', { n: c.n, v: c.v })).join('\n')
  return heading + '\n' + t('dictUi.ds.prompt.colorsOnly') + '\n' + key + '\n' + colors +
    '\n\n' + t('dictUi.ds.prompt.colorsFooter')
}
export function previewColors(s: DesignSystem): { background: string; color: string } {
  const match = s.corpus.match(/背景 (.*?) \/ 文字 (.*?) \/ /) // i18n-allow: 解析原始数据里的中文标签
  return { background: match?.[1] || (s.tone === 'dark' ? '#202124' : '#fafafa'), color: match?.[2] || (s.tone === 'dark' ? '#e2e4ea' : '#202124') }
}
