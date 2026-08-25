// 把生成好的示意图写回词典 bundle。
//
// **只覆盖 svg 字段**，其余（zh / en / logic / keywords / category）一个不碰 ——
// 这些是原有内容，生成器没资格改。
// 只认已存在的 id：写错名字就当场报错，不许悄悄新建一条谁也搜不到的词条。
//
//   node scripts/dict-svg/apply.mjs batch-a.mjs A
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verify } from './verify.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.resolve(HERE, '../../src/renderer/src/features/dict/dictionary-bundle.json')

export async function apply(entries, { dry = false } = {}) {
  // **先校验再写。** 静默失效的图写进去就分发出去了，用户 hover 看到一张死图。
  const { fails } = await verify(entries)
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'))
    throw new Error(`${fails.length} 处不合格，拒绝写入`)
  }
  const b = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'))
  const byId = new Map(b.terms.map((t) => [t.id, t]))
  const missing = Object.keys(entries).filter((id) => !byId.has(id))
  if (missing.length) throw new Error(`词库里没有这些 id：${missing.join(', ')}`)
  let changed = 0
  for (const [id, svg] of Object.entries(entries)) {
    const t = byId.get(id)
    if (t.svg !== svg) { t.svg = svg; changed++ }
  }
  // **保持单行、无尾换行** —— 跟仓库里原本的格式一致。
  // 用 JSON.stringify(b, null, 2) 重排过一次，7475 行插入 1 行删除，
  // 真正改的那几十条 svg 全被淹在无关的重排里，review 根本看不出改了什么。
  if (!dry) fs.writeFileSync(BUNDLE, JSON.stringify(b))
  return { changed, total: Object.keys(entries).length }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mod = await import(pathToFileURL(path.resolve(HERE, process.argv[2])).href)
  const entries = mod[process.argv[3] ?? Object.keys(mod)[0]]
  const dry = process.argv.includes('--dry')
  const { changed, total } = await apply(entries, { dry })
  // 空跑时说「已写入」是在骗自己 —— 报告口径必须跟实际动作一致。
  console.log(dry
    ? `  ✓ ${total} 条校验通过，${changed} 条**待**写入（--dry 空跑，文件未动）`
    : `  ✓ ${total} 条校验通过，${changed} 条已写入 dictionary-bundle.json`)
}
