// 素材检查（P3）：把 media.mjs 读到的信息和平台表里的素材规格对一遍。
// 规格每个数值都是 R(value, source, verified)：verified=false 的超了只「提醒」，不说「超限」——
// 国内平台的素材规格多数没有公开原文，网上数字互相矛盾，别把参考值当硬线。
import fs from 'node:fs'
import { probe } from './media.mjs'

const cache = new Map()   // 路径 → { key, info }；key = 大小 + 修改时间，文件换了就重读
export function mediaInfo(file) {
  let st
  try { st = fs.statSync(file) } catch { return { error: '文件不存在' } }
  const key = `${st.size}:${st.mtimeMs}`
  const hit = cache.get(file)
  if (hit && hit.key === key) return hit.info
  const info = probe(file)
  if (cache.size > 500) cache.clear()
  cache.set(file, { key, info })
  return info
}

// 十进制（1MB = 10^6 字节）：访达这么算，平台写的「512MB」「300MB」也是（Bluesky lexicon 的 maxSize 是 300000000）
export const mb = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`)
export const fmtDuration = (s) => (s >= 60 ? `${Math.floor(s / 60)}分${String(Math.round(s % 60)).padStart(2, '0')}秒` : `${Math.round(s)}秒`)

function over(rule, what, actual, limit) {
  // rule.note：这条不是上传上限而是归类规则（如 YouTube Shorts 超过 3 分钟会变普通视频），照说明提示
  if (rule.note) return { level: 'warn', message: `${what} ${actual}：${rule.note}`, source: rule.source, verified: rule.verified }
  return { level: rule.verified ? 'over' : 'warn', message: `${what} ${actual}，${rule.verified ? '超过上限' : '超过参考值'} ${limit}` + (rule.verified ? '' : '（以上传页提示为准）'), source: rule.source, verified: rule.verified }
}

/** 单个素材对某平台的检查结果 */
export function checkOne(info, media) {
  const out = []
  if (!media) return out
  if (info.error) return [{ level: 'warn', message: info.error }]
  const spec = info.kind === 'video' ? media.video : info.kind === 'image' ? media.image : null
  if (!spec) {
    if (info.kind === 'video' && media.video === null) out.push({ level: 'warn', message: '不能直接上传视频文件' + (media.videoNote ? `：${media.videoNote}` : '') })
    return out
  }
  if (info.kind === 'video' && info.durationSec != null) {
    if (spec.maxSec && info.durationSec > spec.maxSec.value) out.push(over(spec.maxSec, '时长', fmtDuration(info.durationSec), fmtDuration(spec.maxSec.value)))
    if (spec.minSec && info.durationSec < spec.minSec.value) out.push({ ...over(spec.minSec, '时长', fmtDuration(info.durationSec), ''), message: `时长 ${fmtDuration(info.durationSec)}，${spec.minSec.verified ? '短于下限' : '短于参考值'} ${fmtDuration(spec.minSec.value)}` })
  }
  if (spec.maxBytes && info.bytes > spec.maxBytes.value) out.push(over(spec.maxBytes, '大小', mb(info.bytes), mb(spec.maxBytes.value)))
  if (spec.ratio && info.ratio) {
    const { min, max } = spec.ratio.value
    if (info.ratio.value < min - 1e-3 || info.ratio.value > max + 1e-3) {
      const r = spec.ratio
      if (r.note) { out.push({ level: 'warn', message: `比例 ${info.ratio.label}：${r.note}`, source: r.source, verified: r.verified }); return out }
      out.push({ level: r.verified ? 'over' : 'warn', message: `比例 ${info.ratio.label} 不在${r.verified ? '支持' : '参考'}范围 ${r.value.label} 内` + (r.verified ? '，可能被裁切或拒收' : '（以上传页提示为准）'), source: r.source, verified: r.verified })
    }
  }
  return out
}

/** 一张卡片的全部素材：逐个读信息、逐个检查，再看图片张数 */
export function checkCardMedia(paths, media) {
  // checked：这个平台对这类素材有规格可对照。没有规格时面板说「没有可对照的规格」，不能说「符合」
  const items = paths.map((p) => { const info = mediaInfo(p); const spec = info.kind === 'video' ? media?.video : info.kind === 'image' ? media?.image : undefined; return { path: p, info, checked: !!spec, issues: checkOne(info, media) } })
  const extra = []
  const images = items.filter((x) => x.info.kind === 'image').length
  const cap = media?.image?.maxCount
  if (cap && images > cap.value) extra.push(over(cap, '图片', `${images} 张`, `${cap.value} 张`))
  return { items, issues: extra }
}

const tag = (r) => (r.verified ? '' : '（参考）')
/** 从平台素材规格生成「这个平台要准备什么」，只说规格里有的，不另外编 */
export function mediaChecklist(media) {
  if (!media) return []
  const out = []
  const v = media.video
  if (v === null) out.push('不能直接上传视频文件' + (media.videoNote ? `：${media.videoNote}` : ''))
  else if (v) {
    const parts = []
    if (v.maxSec) parts.push(`${v.maxSec.note ? '' : '≤'}${fmtDuration(v.maxSec.value)}${v.maxSec.note ? '以内' : ''}${tag(v.maxSec)}`)
    if (v.maxBytes) parts.push(`≤${mb(v.maxBytes.value)}${tag(v.maxBytes)}`)
    if (v.ratio) parts.push(`比例 ${v.ratio.value.label}${tag(v.ratio)}`)
    if (parts.length) out.push('视频：' + parts.join('，'))
  }
  const i = media.image
  if (i) {
    const parts = []
    if (i.maxCount) parts.push(`最多 ${i.maxCount.value} 张${tag(i.maxCount)}`)
    if (i.maxBytes) parts.push(`单张 ≤${mb(i.maxBytes.value)}${tag(i.maxBytes)}`)
    if (i.ratio) parts.push(`比例 ${i.ratio.value.label}${tag(i.ratio)}`)
    if (parts.length) out.push('图片：' + parts.join('，'))
  }
  for (const n of media.notes ?? []) out.push(n)
  return out
}
