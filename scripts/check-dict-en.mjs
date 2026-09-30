// 创作参考英文对照的同步检查（npm run check 的一环）。
// 每条内置词条都要有英文，且英文是照着**当前**中文译的（指纹一致）；配图里每段中文都有英文；
// 分类表（一级 / 二级 / 区块）每个名字都有英文。失败时列出要补译的 id，补法见 scripts/dict-en/merge.mjs。
import fs from 'node:fs'
import path from 'node:path'
import { svgTexts, termHash } from './dict-en/source.mjs'

const root = path.resolve(import.meta.dirname, '..')
const dir = path.join(root, 'src/renderer/src/features/dict')
const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'dictionary-bundle.json'), 'utf8'))
const en = JSON.parse(fs.readFileSync(path.join(dir, 'dictionary-bundle.en.json'), 'utf8'))
const CJK = /[一-鿿]/
const missing = [], stale = [], svgGap = [], leak = []
for (const t of bundle.terms) {
  const e = en.terms[t.id]
  if (!e) { missing.push(t.id); continue }
  if (e.hash !== termHash(t)) stale.push(t.id)
  if (svgTexts(t.svg).some((k) => !e.svg?.[k])) svgGap.push(t.id)
  if ([e.logic, e.prompt, ...Object.values(e.svg || {})].some((v) => CJK.test(v))) leak.push(t.id)
}
const tx = en.taxonomy || {}
const taxGap = []
for (const [g, list] of Object.entries(bundle.taxonomy || {})) {
  if (!tx.groups?.[g]) taxGap.push(g)
  for (const x of list) if (!tx.names?.[x.name]) taxGap.push(x.name)
}
for (const b of new Set(bundle.terms.flatMap((t) => t.blocks || []))) if (!tx.blocks?.[b]) taxGap.push(b)
for (const c of Object.keys(bundle.categories || {})) if (!tx.categories?.[c]) taxGap.push(c)
const problems = [['没有英文', missing], ['中文改过、英文过期', stale], ['配图文字没译全', svgGap], ['英文里混了中文', leak], ['分类表缺英文', taxGap]].filter(([, l]) => l.length)
if (problems.length) {
  console.error('✗ check-dict-en：创作参考英文对照不同步（补译后跑 node scripts/dict-en/merge.mjs）')
  for (const [k, l] of problems) console.error(`  ${k}（${l.length}）：${l.slice(0, 20).join('、')}${l.length > 20 ? ' …' : ''}`)
  process.exit(1)
}
console.log(`✓ check-dict-en：${bundle.terms.length} 条词条英文对照齐全且未过期`)
