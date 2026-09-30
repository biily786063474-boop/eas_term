// 发布台违禁词检测（P2）。纯本地、纯函数：不联网、不调模型。
// 设计纪律（docs/superpowers/specs/2026-09-29-publish-desk-design.md 第五节 + 第八节第 3 条）：
//   - 没有任何官方违禁词表。每条词条必须挂依据（法条 / 平台规范原文 + 链接），缺依据的词条**拒绝加载**，
//     不是跳过 —— 一条没出处的「违禁词」会被当成事实转述给用户，比漏报更糟。
//   - 命中一律是「提示」，不是「禁止」：绝对化用语要结合语境（执法指南第五、六条列了不算违法的情形），
//     插件判断不了语境，只把依据和建议摆出来，由人决定。
//   - 不导入网传「违禁词大全」。
import { PLATFORM_IDS } from './platforms.mjs'

export const KINDS = ['absolute', 'guarantee', 'traffic', 'brand', 'link', 'user']
export const KIND_LABEL = { absolute: '绝对化用语', guarantee: '承诺保证', traffic: '站外引流', brand: '他平台 / 外部品牌', link: '外部链接', user: '我记下的' }
const LEVELS = ['high', 'medium', 'low']
const CONFIDENCE = ['law', 'guideline', 'observed']
// 引流类常见的拆字手法：「微 信」「v·x」「1 3 8」。只在 loose 词条上允许，最多隔 2 个分隔符
const SEP = '[\\s·•．.。,，_\\-—*|/\\\\~～]{0,2}'
const ZERO_WIDTH = /[​-‍⁠﻿]/

function bad(message) { throw Object.assign(new Error(message), { code: 'BAD_LEXICON' }) }
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v, max = 500) => typeof v === 'string' && v.trim() && v.length <= max

/**
 * 词条结构：
 * { id, kind, level, confidence, platforms: 'all' | PlatformId[],
 *   terms?: string[], pattern?: string, loose?: boolean,   // 二选一或都给；pattern 是作用于归一化文本的正则源码
 *   except?: string[],                                       // 语境例外：这些正则在命中附近匹配到且覆盖命中时，不算命中
 *   basis: { title, clause?, url?, quote?, date?, platform? },   // 非 user 类必须有 url；user 类必须有 date + platform
 *   hint, suggest?, context? }
 */
export function validateEntry(e, where = '词条') {
  if (!isObj(e)) bad(`${where} 不是对象`)
  const allowed = ['id', 'kind', 'level', 'confidence', 'platforms', 'terms', 'pattern', 'loose', 'except', 'basis', 'hint', 'suggest', 'context']
  const extra = Object.keys(e).filter((k) => !allowed.includes(k))
  if (extra.length) bad(`${where} 有未知字段：${extra.join(', ')}`)
  if (!str(e.id, 80)) bad(`${where} 缺 id`)
  const at = `${where}「${e.id}」`
  if (!KINDS.includes(e.kind)) bad(`${at} kind 无效`)
  if (!LEVELS.includes(e.level)) bad(`${at} level 无效`)
  if (!CONFIDENCE.includes(e.confidence)) bad(`${at} confidence 无效`)
  if (e.platforms !== 'all' && (!Array.isArray(e.platforms) || !e.platforms.length || e.platforms.some((p) => !PLATFORM_IDS.includes(p)))) bad(`${at} platforms 无效`)
  if (e.terms === undefined && e.pattern === undefined) bad(`${at} 既没有 terms 也没有 pattern`)
  if (e.terms !== undefined && (!Array.isArray(e.terms) || !e.terms.length || e.terms.some((t) => !str(t, 40)))) bad(`${at} terms 无效`)
  if (e.pattern !== undefined) { if (!str(e.pattern, 500)) bad(`${at} pattern 无效`); try { new RegExp(e.pattern, 'gu') } catch { bad(`${at} pattern 不是合法正则`) } }
  if (e.loose !== undefined && typeof e.loose !== 'boolean') bad(`${at} loose 无效`)
  if (e.except !== undefined) {
    if (!Array.isArray(e.except) || e.except.some((x) => !str(x, 300))) bad(`${at} except 无效`)
    for (const x of e.except) { try { new RegExp(x, 'gu') } catch { bad(`${at} except 不是合法正则：${x}`) } }
  }
  if (!str(e.hint, 300)) bad(`${at} 缺 hint（为什么要注意）`)
  for (const k of ['suggest', 'context']) if (e[k] !== undefined && !str(e[k], 300)) bad(`${at} ${k} 无效`)
  // 依据：这是整套词库可信的全部来源，校验最严
  const b = e.basis
  if (!isObj(b) || !str(b.title, 200)) bad(`${at} 缺依据（basis.title）`)
  if (e.kind === 'user') {
    if (e.confidence !== 'observed') bad(`${at} 我记下的词条只能是 observed`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '') || !PLATFORM_IDS.includes(b.platform)) bad(`${at} 我记下的词条要写日期（YYYY-MM-DD）和平台`)
  } else {
    if (e.confidence === 'observed') bad(`${at} 内置词条不能是 observed`)
    if (!/^https?:\/\//.test(b.url ?? '')) bad(`${at} 缺依据链接（basis.url）`)
  }
  for (const k of ['clause', 'quote']) if (b[k] !== undefined && !str(b[k], 600)) bad(`${at} basis.${k} 无效`)
  return e
}

/** 归一化（全角转半角、大小写、去零宽字符）并保留每个归一化字符对应原文的位置 */
export function normalize(text) {
  let out = ''
  const from = [], to = []
  let i = 0
  for (const ch of text) {
    const start = i
    i += ch.length
    if (ZERO_WIDTH.test(ch)) continue
    const n = ch.normalize('NFKC').toLowerCase()
    for (let k = 0; k < n.length; k++) { from.push(start); to.push(i) }
    out += n
  }
  return { text: out, from, to }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function termSource(term, loose) {
  const chars = [...normalize(term).text]
  const body = loose ? chars.map(escape).join(SEP) : chars.map(escape).join('')
  // 纯字母数字的词两侧不能紧挨字母，免得 wx 命中 wxyz、vx 命中 devx
  return /^[a-z0-9]+$/.test(chars.join('')) ? `(?<![a-z])${body}(?![a-z])` : body
}

export function compile(entries) {
  return entries.map((e, n) => {
    validateEntry(e, `第 ${n + 1} 条`)
    const parts = []
    if (e.terms) parts.push(...[...e.terms].sort((a, b) => b.length - a.length).map((t) => termSource(t, e.loose)))
    if (e.pattern) parts.push(`(?:${e.pattern})`)
    return { entry: e, re: new RegExp(parts.join('|'), 'gu'), except: (e.except ?? []).map((x) => new RegExp(x, 'gu')) }
  })
}

const applies = (e, platform) => !platform || e.platforms === 'all' || e.platforms.includes(platform)
// 例外判定：在命中前后各 12 个字的窗口里跑例外正则，某次匹配完整覆盖了命中 → 这次命中作废
function excepted(c, norm, s, t) {
  if (!c.except.length) return false
  const w0 = Math.max(0, s - 12), win = norm.slice(w0, t + 12)
  for (const re of c.except) {
    re.lastIndex = 0
    for (const m of win.matchAll(re)) {
      const ms = w0 + m.index, me = ms + m[0].length
      if (ms <= s && me >= t) return true
    }
  }
  return false
}

/** 检查一段文本。返回命中（原文位置、原词、依据、提示），按出现顺序；同一词条重叠的命中只留一个 */
export function check(text, compiled, { platform, field } = {}) {
  if (typeof text !== 'string' || !text) return []
  const n = normalize(text)
  const hits = []
  for (const c of compiled) {
    if (!applies(c.entry, platform)) continue
    c.re.lastIndex = 0
    let lastEnd = -1
    for (const m of n.text.matchAll(c.re)) {
      if (!m[0]) continue
      const s = m.index, t = s + m[0].length
      if (s < lastEnd || excepted(c, n.text, s, t)) continue
      lastEnd = t
      const start = n.from[s], end = n.to[t - 1]
      const e = c.entry
      hits.push({ id: e.id, kind: e.kind, kindLabel: KIND_LABEL[e.kind], level: e.level, confidence: e.confidence, field,
        word: text.slice(start, end), start, end, hint: e.hint, suggest: e.suggest, context: e.context, basis: e.basis })
    }
  }
  return hits.sort((a, b) => a.start - b.start || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
}
