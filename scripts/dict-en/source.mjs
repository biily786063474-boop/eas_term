// 创作参考英文对照的「原文指纹」：中文词条的解释 / 提示词 / 配图文字一变，指纹就变，
// check-dict-en 就能指出哪几条英文过期了。merge 与 check 共用这一份，别各写一套。
import crypto from 'node:crypto'

const CJK = /[一-鿿]/

/** 配图里需要翻译的文字节点（去重排序） */
export function svgTexts(svg) {
  return [...new Set([...(svg || '').matchAll(/>([^<>]*)</g)].map((m) => m[1]).filter((s) => CJK.test(s)))].sort()
}

export function termHash(t) {
  const src = [t.logic || '', t.prompt || '', ...svgTexts(t.svg)].join('\u0000')
  return crypto.createHash('sha1').update(src).digest('hex').slice(0, 12)
}
