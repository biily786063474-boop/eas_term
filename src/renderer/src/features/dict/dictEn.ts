// 创作参考的英文内容。
//
// 中文正本 dictionary-bundle.json 不动（分类名、区块名同时是 dict_add 校验和筛选用的键）；
// 英文放在 dictionary-bundle.en.json 里按 id 覆盖，**只在英文界面才按需加载**，中文界面零开销。
// 同步保障：scripts/check-dict-en.mjs 按中文原文指纹比对，中文改了英文没跟上，npm run check 失败。
//
// 自建词条（user）是用户自己的数据，不翻，原样显示。
import { useEffect, useState } from 'react'
import { useLang, getLang } from '../../i18n.ts'

export interface DictEnTerm {
  hash: string
  logic: string
  prompt: string
  /** 配图文字：中文原文 → 英文 */
  svg: Record<string, string>
}
export interface DictEnBundle {
  version: number
  taxonomy: {
    groups: Record<string, string>
    categories: Record<string, string>
    blocks: Record<string, string>
    /** 二级分类：中文名 → [英文名, 英文说明] */
    names: Record<string, [string, string]>
  }
  terms: Record<string, DictEnTerm>
}

let cache: DictEnBundle | null = null
let loading: Promise<DictEnBundle> | null = null

export function loadDictEn(): Promise<DictEnBundle> {
  loading ??= import('./dictionary-bundle.en.json').then((m) => (cache = m.default as unknown as DictEnBundle))
  return loading
}

/** 英文界面返回英文对照（首次加载完成前为 null，界面先显示中文正本再刷新）；中文界面恒为 null */
export function useDictEn(): DictEnBundle | null {
  const lang = useLang()
  const [b, setB] = useState<DictEnBundle | null>(cache)
  useEffect(() => {
    if (lang === 'en' && !cache) void loadDictEn().then(setB)
  }, [lang])
  return lang === 'en' ? (b ?? cache) : null
}

/** 非 React 场景（插入提示词、画布气泡）：英文界面且已加载时返回对照，否则 null */
export function dictEnNow(): DictEnBundle | null {
  if (getLang() !== 'en') return null
  if (!cache) void loadDictEn()
  return cache
}

const svgMemo = new Map<string, string>()

function localizeSvg(id: string, svg: string, map: Record<string, string>): string {
  const hit = svgMemo.get(id)
  if (hit !== undefined) return hit
  // 只换文字节点（>原文<），不碰属性和路径数据
  const out = svg.replace(/>([^<>]*)</g, (m, text: string) => (map[text] !== undefined ? `>${map[text]}<` : m))
  svgMemo.set(id, out)
  return out
}

interface TermLike {
  id: string
  zh: string
  en: string
  logic: string
  prompt?: string
  /** 少数动效词条只有短片没有配图 */
  svg?: string
  user?: boolean
}

/** 词条在当前语言下的显示名：英文界面用 en（自建词条没填 en 时退回 zh） */
export function termName(t: { zh: string; en: string }, en: DictEnBundle | null): string {
  return en ? t.en || t.zh : t.zh
}

/** 把内置词条的解释 / 提示词 / 配图文字换成英文；没有对照或是自建词条时原样返回 */
export function localizeTerm<T extends TermLike>(t: T, en: DictEnBundle | null): T {
  if (!en || t.user) return t
  const e = en.terms[t.id]
  if (!e) return t
  return {
    ...t,
    logic: e.logic || t.logic,
    prompt: e.prompt || t.prompt,
    svg: t.svg ? localizeSvg(t.id, t.svg, e.svg) : t.svg
  }
}

/** 一级分类（「前端 · 组件」这类）的显示名 */
export function groupLabel(zh: string, en: DictEnBundle | null): string {
  return en?.taxonomy.groups[zh] ?? zh
}
/** 二级分类的显示名 */
export function cat2Label(zh: string, en: DictEnBundle | null): string {
  return en?.taxonomy.names[zh]?.[0] ?? zh
}
/** 二级分类的一句说明 */
export function cat2Desc(zh: string, desc: string | undefined, en: DictEnBundle | null): string | undefined {
  return en?.taxonomy.names[zh]?.[1] ?? desc
}
/** 区块标签（导航栏、弹层……）的显示名 */
export function blockLabel(zh: string, en: DictEnBundle | null): string {
  return en?.taxonomy.blocks[zh] ?? zh
}
/** 老的三类（interaction / motion / visual / backend）的显示名 */
export function categoryLabel(key: string, zh: string, en: DictEnBundle | null): string {
  return en?.taxonomy.categories[key] ?? zh
}
