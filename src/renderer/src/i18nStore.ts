// 渲染层的界面语言状态（主窗口和灵动岛各建一份，来源不同、逻辑相同）。
// 组件用 useT() 取文案 —— 语言一变，用到它的组件自动重渲染；非组件代码用 t()，读当下语言。
import { useSyncExternalStore } from 'react'
import { createT, localeOf, type Lang, type T } from '../../shared/i18n/index.ts'
import { setCurrentLang } from '../../shared/i18n/current.ts'

export interface LangStore {
  /** 组件里用：语言切换后自动重渲染 */
  useT: () => T
  useLang: () => Lang
  /** 非组件代码用：按当下语言现取 */
  t: T
  getLang: () => Lang
  /** 给 Intl / toLocale* 的 locale 标签 */
  locale: () => string
}

export function createLangStore(initial: Lang, subscribeSource: (fn: (l: Lang) => void) => () => void): LangStore {
  let lang: Lang = initial
  const listeners = new Set<() => void>()
  // 共享层的 tm()（shared/i18n/current.ts）在渲染进程里也要跟着这份语言走 ——
  // src/shared 下的显示函数（如 roleBinding 的 capLabel / howText）在渲染层调用时读它
  setCurrentLang(initial)
  const setLang = (l: Lang): void => {
    if (l === lang) return
    lang = l
    setCurrentLang(l)
    if (typeof document !== 'undefined') document.documentElement.lang = localeOf(l)
    for (const fn of listeners) fn()
  }
  if (typeof document !== 'undefined') document.documentElement.lang = localeOf(initial)
  subscribeSource(setLang)
  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  const getLang = (): Lang => lang
  const tFor = new Map<Lang, T>()
  const tOf = (l: Lang): T => {
    let f = tFor.get(l)
    if (!f) tFor.set(l, (f = createT(l)))
    return f
  }
  return {
    useLang: () => useSyncExternalStore(subscribe, getLang, getLang),
    useT: () => tOf(useSyncExternalStore(subscribe, getLang, getLang)),
    t: (key, params) => tOf(lang)(key, params),
    getLang,
    locale: () => localeOf(lang)
  }
}
