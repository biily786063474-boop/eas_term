// 灵动岛折叠条「N 个项目」的单复数（2026-09-30）。i18n 没有复数机制，也不为一个词条引库：
// 在这里按数值挑词条 —— 1 用 island.projectCountOne（英文 "1 project"），其余用 island.projectCount。
// 纯函数（只引类型），node --test 直接跑。
import type { T } from '../../shared/i18n/index.ts'

export function projectCountLabel(tr: T, n: number): string {
  return n === 1 ? tr('island.projectCountOne') : tr('island.projectCount', { n })
}
