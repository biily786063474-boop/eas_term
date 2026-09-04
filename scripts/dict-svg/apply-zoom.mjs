// 把「全景 → 区块」镜头图写进词库。可重跑（同样的输入产出同样的 svg）。
import { readFileSync, writeFileSync } from 'node:fs'
import { buildSvg } from './zoom.mjs'
import { DETAILS, PLACE } from './details.mjs'

const P = 'src/renderer/src/features/dict/dictionary-bundle.json'
const b = JSON.parse(readFileSync(P, 'utf8'))
const byId = new Map(b.terms.map((t) => [t.id, t]))

let done = 0
const errs = []
for (const [id, [platform, block, cam]] of Object.entries(PLACE)) {
  const t = byId.get(id)
  if (!t) { errs.push(`${id} 不在词库里`); continue }
  if (!t.blocks?.includes(block)) errs.push(`${id} 的 blocks 里没有「${block}」，落点和标签对不上`)
  const svg = buildSvg({ platform, block, detail: DETAILS[id], cam })
  // **sanitizeSvg 对超过 8000 字符的是整个丢掉且不报错**，这里先拦一道
  if (svg.length > 8000) { errs.push(`${id} 的 svg ${svg.length} 字符，超过 sanitizeSvg 的 8000 上限`); continue }
  t.svg = svg
  done++
}
if (errs.length) { console.error('✗ ' + errs.join('\n✗ ')); process.exit(1) }
// 压缩格式（见 apply.mjs:33 的教训）
writeFileSync(P, JSON.stringify(b))
console.log('✓ 写入', done, '条镜头图 · 词库现有 svg', b.terms.filter((t) => t.svg).length, '/', b.terms.length)
