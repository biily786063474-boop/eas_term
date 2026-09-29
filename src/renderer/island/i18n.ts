// 灵动岛窗口的界面语言（来源是 window.island，而不是主窗口的 window.api）。
import { createLangStore } from '../src/i18nStore.ts'

const store = createLangStore(window.island.lang, (fn) => window.island.onLangChange(fn))
export const { useT, useLang, t, getLang, locale } = store
