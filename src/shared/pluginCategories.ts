// 插件市场的分类分类法（主/渲染共用，**零依赖，可裸测**）。
// 完整市场弹窗左侧的分类栏用它；registry 条目的 `category` 字符串经 categoryIdOf 归到某个桶。
// 用户拍板的八类（2026-09-15）+ 一个「其他」兜底。

export interface MarketCategory {
  id: string
  name: string
  /** 侧栏图标（emoji，够用；真实商店里换成线性图标） */
  icon: string
}

export const MARKET_CATEGORIES: MarketCategory[] = [
  { id: 'office', name: '办公文档', icon: '📄' },
  { id: 'life', name: '生活出行', icon: '🗺️' },
  { id: 'dev', name: '开发工具', icon: '🧩' },
  { id: 'comms', name: '通讯协作', icon: '💬' },
  { id: 'media', name: '自媒体', icon: '📣' },
  { id: 'design', name: '设计创意', icon: '🎨' },
  { id: 'data', name: '数据搜索', icon: '🔎' },
  { id: 'storage', name: '文件存储', icon: '📁' },
  { id: 'other', name: '其他', icon: '🧰' }
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
  // 英文 / 自家老值
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

export function categoryName(id: string): string {
  return MARKET_CATEGORIES.find((c) => c.id === id)?.name ?? '其他'
}
