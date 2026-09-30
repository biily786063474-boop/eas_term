// 测试专用：「源码是不是在显示某句中文」在迁移到词典后的判定方式。
//
// 迁移前很多测试直接在源码里搜中文（assert.match(source, /获取密钥/)）。文案进了词典之后，
// 源码里只剩键名。这里的判定是：源码里出现了某个键（带引号），且这个键的中文等于 / 包含这句话。
// 测试意图不变 —— 界面上显示的仍是那句中文。
import { zh } from './zh.ts'

/** 中文等于（exact）或包含这句话的所有键 */
export function zhKeys(text: string, exact = false): string[] {
  return Object.entries(zh)
    .filter(([, v]) => (exact ? v === text : v.includes(text)))
    .map(([k]) => k)
}

/** 源码是否通过词典键（或仍然直接）显示这句中文 */
export function usesZh(source: string, text: string, exact = false): boolean {
  if (source.includes(text)) return true
  return zhKeys(text, exact).some((k) => source.includes(`'${k}'`) || source.includes(`"${k}"`))
}
