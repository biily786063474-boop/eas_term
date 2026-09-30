// 原型图蓝图的英文显示层。
//
// blueprints.json 里的中文同时是数据键：platform 用来分组 / 判断手机外框，slots.block 用来按区块标签匹配词条。
// 所以正本不动，英文放 blueprints.en.json（按 id 覆盖名称、意图、每个区块的说明），
// 区块名的英文与 dictionary-bundle.en.json 的 taxonomy.blocks 共用一份（blockLabel）。
// **比较 / 筛选一律继续用中文值**，只在显示时换。
import bpEn from './blueprints.en.json' with { type: 'json' }
import type { T } from '../../../../shared/i18n/index.ts'

interface BpLike {
  id: string
  name: string
  intent: string
  platform: string
}
interface BpEn {
  name: string
  intent: string
  notes: Record<string, string>
}
const EN = (bpEn as { blueprints: Record<string, BpEn> }).blueprints

/** 两种端在数据里的中文值（数据键，不是界面文案） */
export const PLATFORM_MOBILE = '移动' // i18n-allow: 数据键
export const PLATFORM_DESKTOP = '桌面' // i18n-allow: 数据键
export const isMobileBlueprint = (bp: { platform: string }): boolean => bp.platform === PLATFORM_MOBILE

/** 「移动端 / 桌面端」 */
export function platformLabel(platform: string, t: T): string {
  if (platform === PLATFORM_MOBILE) return t('dictUi.bp.mobile')
  if (platform === PLATFORM_DESKTOP) return t('dictUi.bp.desktop')
  return platform
}

/** 蓝图在当前语言下的名称 / 意图 / 区块说明。en=false（中文界面）原样返回 */
export function blueprintText(bp: BpLike, en: boolean): { name: string; intent: string; note: (block: string, zh: string) => string } {
  const e = en ? EN[bp.id] : undefined
  return {
    name: e?.name ?? bp.name,
    intent: e?.intent ?? bp.intent,
    note: (block, zh) => e?.notes[block] ?? zh
  }
}
