// 插件市场的分类分类法（主/渲染共用，**零依赖，可裸测**）。
// 完整市场弹窗左侧的分类栏用它；registry 条目的 `category` 字符串经 categoryIdOf 归到某个桶。
// 用户拍板的八类（2026-09-15）+ 一个「其他」兜底。
// 显示名走 i18n（categoryName 收一个 t）；只引类型，运行时仍零依赖。
import type { I18nKey, T } from './i18n/index.ts'

export interface MarketCategory {
  id: string
  name: string
}

// 图标是单色线条，在渲染层按 id 映射（`pluginCategoryIcons.tsx`）——这里保持零 UI 依赖。
export const MARKET_CATEGORIES: MarketCategory[] = [
  { id: 'office', name: '办公文档' },
  { id: 'life', name: '生活出行' },
  { id: 'dev', name: '开发工具' },
  { id: 'comms', name: '通讯协作' },
  { id: 'media', name: '自媒体' },
  { id: 'design', name: '设计创意' },
  { id: 'data', name: '数据搜索' },
  { id: 'storage', name: '文件存储' },
  { id: 'other', name: '其他' }
]

// registry 里 category 字段可能是中文分类名、也可能是英文（自家老插件写的 "Productivity" 之类）。
// 都映射到一个 id；认不出的进 'other'。
const ALIAS: Record<string, string> = {
  // 中文直接命中
  办公文档: 'office',
  办公: 'office',
  生活出行: 'life',
  生活: 'life',
  开发工具: 'dev',
  开发: 'dev',
  通讯协作: 'comms',
  自媒体: 'media',
  设计创意: 'design',
  设计: 'design',
  数据搜索: 'data',
  文件存储: 'storage',
  // 英文 / 自家老值。"Productivity" 同时是番茄钟与自家工作类插件（看板 / 时间线 / 执行清单）的值，
  // 分类表里没有「效率工具」类，归办公文档（2026-09-30 复核保留；新增分类需用户拍板）
  productivity: 'office',
  office: 'office',
  system: 'dev',
  developer: 'dev',
  'developer tools': 'dev',
  dev: 'dev',
  communication: 'comms',
  design: 'design',
  data: 'data',
  storage: 'storage',
  files: 'storage'
}

/** registry 条目的 category 字符串 → 分类 id。空 / 认不出 → 'other'。 */
export function categoryIdOf(raw?: string): string {
  const k = (raw ?? '').trim().toLowerCase()
  if (!k) return 'other'
  if (ALIAS[k]) return ALIAS[k]
  // 原样命中中文（ALIAS 的 key 存了小写英文，中文得单独查一次原文）
  if (ALIAS[raw!.trim()]) return ALIAS[raw!.trim()]
  return 'other'
}

/** 分类 id → 词条键。`name` 字段是中文原名（分类表的身份），界面显示一律经这里随语言走。 */
const CATEGORY_KEYS: Record<string, I18nKey> = {
  office: 'panels.mk.catOffice',
  life: 'panels.mk.catLife',
  dev: 'panels.mk.catDev',
  comms: 'panels.mk.catComms',
  media: 'panels.mk.catMedia',
  design: 'panels.mk.catDesign',
  data: 'panels.mk.catData',
  storage: 'panels.mk.catStorage',
  other: 'panels.mk.catOther'
}

/** 分类 id → 当前界面语言的显示名。认不出的 id 按「其他」。
 *  **不要直接显示 registry 的 category 原值**：它可能是 "Productivity"（中文界面露英文）或中文（英文界面露中文），
 *  先 categoryIdOf 归桶再走这里（抽屉「发现」区与完整市场弹窗共用，2026-09-30）。 */
export function categoryName(id: string, t: T): string {
  return t(CATEGORY_KEYS[id] ?? CATEGORY_KEYS.other)
}
