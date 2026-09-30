// 界面多语言的核心（纯函数，渲染层 / 灵动岛 / 主进程共用，见 docs/i18n/README.md）。
//
// 约定：
// - 代码里只写键名，文案在 zh.ts / en.ts。**en.ts 的类型是 `Record<ZhKey, string>`** ——
//   中文加了一个键、英文没跟上，`npm run typecheck` 当场失败，中英文不会悄悄脱节。
// - 占位符写 `{name}`；中英两边的占位符集合必须一致（i18n.test.ts 逐键校验）。
// - 找不到的键原样返回键名，而不是抛错 —— 界面宁可露出一个键名，也不能整块白屏。
import { zh } from './zh.ts'
import { en } from './en.ts'

export type Lang = 'zh' | 'en'
/** 用户在设置里选的：跟随系统 / 中文 / English */
export type LangPref = 'system' | Lang
export type I18nKey = keyof typeof zh
export type Params = Record<string, string | number>

const DICTS: Record<Lang, Record<I18nKey, string>> = { zh, en }

/** 系统语言以 zh 开头（zh-CN / zh-Hans / zh-TW / zh-HK…）就用中文，其余一律英文 */
export function resolveLang(pref: LangPref | undefined, systemLocale: string | undefined): Lang {
  if (pref === 'zh' || pref === 'en') return pref
  return /^zh\b/i.test(systemLocale ?? '') ? 'zh' : 'en'
}

export function isLangPref(v: unknown): v is LangPref {
  return v === 'system' || v === 'zh' || v === 'en'
}

function fill(text: string, params?: Params): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

export function translate(lang: Lang, key: I18nKey, params?: Params): string {
  const text = DICTS[lang][key] ?? DICTS.zh[key]
  return text === undefined ? key : fill(text, params)
}

export type T = (key: I18nKey, params?: Params) => string
export function createT(lang: Lang): T {
  return (key, params) => translate(lang, key, params)
}

/** 占位符集合（测试用：中英两边必须一致） */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
}

/** BCP-47 标签，给 Intl / toLocale* 用 */
export function localeOf(lang: Lang): string {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}

export { zh, en }
