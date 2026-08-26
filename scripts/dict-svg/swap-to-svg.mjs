// 把某个动效词条从「播短片」换成「显示手画 SMIL」。
//
// 用在**组件本身坏了、录不出正确画面**的词条上：与其留一段误导人的片子，
// 不如手画一张说清楚。DictView 里 clip 优先于 svg，所以必须把 clip 删掉，
// 只留 svg 是不够的。
//
//   node scripts/dict-svg/swap-to-svg.mjs <批次文件> <导出名> [--dry]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verify } from './verify.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const BUNDLE = path.join(ROOT, 'src/renderer/src/features/dict/dictionary-bundle.json')

const mod = await import(pathToFileURL(path.resolve(HERE, process.argv[2])).href)
const entries = mod[process.argv[3] ?? Object.keys(mod)[0]]
const dry = process.argv.includes('--dry')

const { fails } = await verify(entries)
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1) }

const b = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'))
const byId = new Map(b.terms.map((t) => [t.id, t]))
const freed = []
for (const [id, svg] of Object.entries(entries)) {
  const t = byId.get(id)
  if (!t) { console.error(`  ✗ 词库里没有 ${id}`); process.exit(1) }
  if (t.clip) { freed.push(t.clip); delete t.clip }
  t.svg = svg
  console.log(`  ${id}  ${t.zh}  短片 → 手画图（${svg.length}B）`)
}
// **保持单行、无尾换行**，跟仓库里原本的格式一致
if (!dry) fs.writeFileSync(BUNDLE, JSON.stringify(b))
console.log(dry ? '  （--dry 空跑，文件未动）' : `  已写入。腾出来的短片：${freed.join(', ') || '无'}`)
