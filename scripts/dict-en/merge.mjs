// 把翻译批次合进 src/renderer/src/features/dict/dictionary-bundle.en.json。
// 用法：node scripts/dict-en/merge.mjs <批次目录> <taxonomy.json>
//   批次目录里每个 *.json 形如 { "<id>": { logic, prompt, svg: { 原文: 英文 } } }。
//   已有的对照会保留，批次里的条目覆盖同 id 的旧条目；指纹按当前中文重算。
// 词条更新后的流程：check-dict-en 报出过期 id → 只译这几条 → 再跑一次 merge。
import fs from 'node:fs'
import path from 'node:path'
import { svgTexts, termHash } from './source.mjs'

const [dir, taxFile] = process.argv.slice(2)
const root = path.resolve(import.meta.dirname, '../..')
const bundlePath = path.join(root, 'src/renderer/src/features/dict/dictionary-bundle.json')
const outPath = path.join(root, 'src/renderer/src/features/dict/dictionary-bundle.en.json')
const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { version: 1, terms: {} }
const byId = new Map(bundle.terms.map((t) => [t.id, t]))
const terms = { ...prev.terms }
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const batch = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  for (const [id, e] of Object.entries(batch)) {
    const t = byId.get(id)
    if (!t) { console.error(`跳过未知 id：${id}（${f}）`); continue }
    const svg = {}
    for (const k of svgTexts(t.svg)) if (e.svg?.[k]) svg[k] = e.svg[k]
    terms[id] = { hash: termHash(t), logic: e.logic ?? '', prompt: e.prompt ?? '', svg }
  }
}
const taxonomy = taxFile ? JSON.parse(fs.readFileSync(taxFile, 'utf8')) : prev.taxonomy
const ordered = Object.fromEntries(bundle.terms.filter((t) => terms[t.id]).map((t) => [t.id, terms[t.id]]))
fs.writeFileSync(outPath, JSON.stringify({ version: 1, taxonomy, terms: ordered }, null, 1) + '\n')
console.log(`已写 ${Object.keys(ordered).length}/${bundle.terms.length} 条 → ${path.relative(root, outPath)}`)
