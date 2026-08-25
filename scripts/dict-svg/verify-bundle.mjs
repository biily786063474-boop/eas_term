// 直接从 dictionary-bundle.json 校验所有会动的词条。
//
// **这才是权威检查** —— 批次文件校验过不代表写进去的是同一份东西
// （写入脚本可能截断、可能只写了一半、可能被别的改动覆盖）。
// 分发出去的是这个文件，就校验这个文件。
//
//   node scripts/dict-svg/verify-bundle.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from './verify.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const b = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../src/renderer/src/features/dict/dictionary-bundle.json'), 'utf8'))

const animated = {}
for (const t of b.terms) {
  if (!t.clip && (t.svg || '').includes('<animate')) animated[t.id] = t.svg
}
const ids = Object.keys(animated)
console.log(`  词库里会动的内置词条：${ids.length} 条`)

// electron 一次开太多 div 会吃满内存，分批过
const CH = 40
let fails = []
for (let i = 0; i < ids.length; i += CH) {
  const slice = Object.fromEntries(ids.slice(i, i + CH).map((k) => [k, animated[k]]))
  const r = await verify(slice)
  fails = fails.concat(r.fails)
  process.stdout.write(`  ${Math.min(i + CH, ids.length)}/${ids.length}\r`)
}
if (fails.length) {
  console.log('\n' + fails.map((f) => '  ✗ ' + f).join('\n'))
  console.log(`\n  ✗ ${fails.length} 处不合格`)
  process.exit(1)
}
const sizes = ids.map((k) => animated[k].length).sort((a, b2) => a - b2)
const total = sizes.reduce((a, b2) => a + b2, 0)
console.log(`\n  ✓ ${ids.length} 条全部通过：动画真的在动 · 过得了 sanitizeSvg · 未超 8000 字符`)
console.log(`  体积：合计 ${(total / 1024).toFixed(0)}KB · 中位 ${sizes[sizes.length >> 1]}B · 最大 ${sizes.at(-1)}B`)
