// 把后端词条的分层流向图写进词库。可重跑。
import { readFileSync, writeFileSync } from 'node:fs'
import { buildFlow } from './flow.mjs'
import { FLOWS } from './flowDetails.mjs'

const P = 'src/renderer/src/features/dict/dictionary-bundle.json'
const b = JSON.parse(readFileSync(P, 'utf8'))
const byId = new Map(b.terms.map((t) => [t.id, t]))
const backend = b.terms.filter((t) => t.cat1 === '后端 · 服务')

const errs = []
// 双向核对：图里有的词条要存在，词条也不许漏图 —— 漏一张不会报错，只是那条没预览
for (const id of Object.keys(FLOWS)) if (!byId.has(id)) errs.push(`${id} 不在词库里`)
for (const t of backend) if (!FLOWS[t.id]) errs.push(`${t.id}（${t.zh}）没有图`)

let n = 0
for (const [id, make] of Object.entries(FLOWS)) {
  const t = byId.get(id)
  if (!t) continue
  if (t.cat1 !== '后端 · 服务') { errs.push(`${id} 不是后端词条`); continue }
  const svg = buildFlow(make())
  // sanitizeSvg 对超 8000 的是**整个返回空串且不报错**（main/dict.ts:48）
  if (svg.length > 8000) { errs.push(`${id} 的 svg ${svg.length} 字符，超上限`); continue }
  t.svg = svg
  n++
}
if (errs.length) { console.error('✗ ' + errs.join('\n✗ ')); process.exit(1) }
writeFileSync(P, JSON.stringify(b))   // 压缩格式，见 apply.mjs:33
console.log('✓ 写入', n, '张 · 词库现有 svg', b.terms.filter((t) => t.svg).length, '/', b.terms.length)
