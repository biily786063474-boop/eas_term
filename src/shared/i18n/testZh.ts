// 测试专用：按中文返回文案的 i18n 替身。
// 有些主进程测试把源码放进 vm 里跑、只放行白名单模块 —— 源码 import 了 main/i18n.ts 时，把这个塞进白名单。
// 测试约定按中文跑（docs/i18n/README.md），所以这里固定中文。
import { translate, type T } from './index.ts'

export const zhT: T = (key, params) => translate('zh', key, params)

/** 形状同 src/main/i18n.ts 的导出 */
export const mainI18nZhMock = {
  t: zhT,
  currentLang: () => 'zh' as const,
  langArg: () => '--eas-lang=zh',
  onLangChanged: () => {},
  initI18n: () => {}
}
