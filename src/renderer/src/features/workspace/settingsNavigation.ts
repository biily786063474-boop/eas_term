// 导航只描述信息层级，不复制偏好值或快捷键注册表。
// 文案（名称/分组/描述/关键词）在调用时按当前语言取，不能在模块顶层固化。
import { t } from '../../i18n.ts'

export const SETTINGS_PAGES = [
 {key:'theme',group:'work'},
 {key:'board',group:'work'},
 {key:'sound',group:'work'},
 {key:'keys',group:'work'},
 {key:'ai',group:'ai'},
 {key:'mcp',group:'ai'},
 {key:'phone',group:'ai'},
 {key:'update',group:'system'},
 {key:'runtime',group:'system'},
 {key:'perf',group:'system'},
 {key:'privacy',group:'system'},
 // 2026-09-29：开源致谢 + 完整第三方许可（用户要致敬借鉴的开源库，并补齐许可声明）；文案在 settings 词典
 {key:'about',group:'system'}
] as const
export type SettingsPageKey = (typeof SETTINGS_PAGES)[number]['key']
export type SettingsGroupKey = (typeof SETTINGS_PAGES)[number]['group']
export const SETTINGS_GROUPS: readonly SettingsGroupKey[] = ['work', 'ai', 'system']
export function settingsGroupLabel(group: SettingsGroupKey): string {
 return t(`settings.nav.group.${group}` as const)
}
export interface SettingsPageInfo {
 key: SettingsPageKey
 groupKey: SettingsGroupKey
 label: string
 group: string
 description: string
 keywords: string
}
function info(p: (typeof SETTINGS_PAGES)[number]): SettingsPageInfo {
 return {
  key: p.key,
  groupKey: p.group,
  group: settingsGroupLabel(p.group),
  label: t(`settings.nav.${p.key}.label` as const),
  description: t(`settings.nav.${p.key}.description` as const),
  keywords: t(`settings.nav.${p.key}.keywords` as const)
 }
}
export function settingsPage(key: unknown): SettingsPageInfo {
 return info(SETTINGS_PAGES.find(p=>p.key===key) ?? SETTINGS_PAGES[0])
}
export function findSettingsPages(query: string): SettingsPageInfo[] {
 const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean)
 return SETTINGS_PAGES.map(info).filter(p=>terms.every(w=>[p.label,p.group,p.description,p.keywords].join(' ').toLowerCase().includes(w)))
}
