// 主窗口的界面语言。见 i18nStore.ts 与 docs/i18n/README.md。
import { createLangStore } from './i18nStore.ts'

// 单元测试在 Node 里会间接 import 到这里（没有 window / window.api）—— 那时退回中文、不订阅。
// 测试本来就约定按中文跑（现有中文断言不用改）。
const bridge = typeof window !== 'undefined' ? window.api?.i18n : undefined
const store = createLangStore(bridge?.lang ?? 'zh', (fn) => bridge?.onChange(fn) ?? (() => {}))
export const { useT, useLang, t, getLang, locale } = store
