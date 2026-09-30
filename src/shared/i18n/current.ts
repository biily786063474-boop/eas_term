// 「当前界面语言」的进程内单例，**零 electron 依赖**。
// 主进程里很多模块是纯逻辑、在 node --test 里直接跑（不能 import electron），它们要给用户看的错误文案
// 用这里的 tm() —— 主进程启动和切换语言时由 main/i18n.ts 调 setCurrentLang() 同步；测试里不设置，默认中文，
// 于是现有的中文断言不用改（docs/i18n/README.md「测试固定按中文跑」）。
import { translate, type I18nKey, type Lang, type Params } from './index.ts'

let current: Lang = 'zh'
export function setCurrentLang(lang: Lang): void {
  current = lang
}
export function currentLangValue(): Lang {
  return current
}
/** 按当前语言取文案（调用时现取，切换后下一次调用即是新语言） */
export function tm(key: I18nKey, params?: Params): string {
  return translate(current, key, params)
}
