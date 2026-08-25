// 重新生成全部会动的词条并写回词库。**改了共用模板就跑这个** ——
// 单独重写某一批会留下「一半新一半旧」的词库，而这种不一致肉眼看不出来。
//
//   node scripts/dict-svg/build.mjs          生成 + 校验 + 写入
//   node scripts/dict-svg/build.mjs --dry    只生成校验，不写文件
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { apply } from './apply.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BATCHES = [
  ['batch-a.mjs', 'A', '时间轴 · 赛跑'],
  ['batch-b.mjs', 'B', '滚动'],
  ['batch-c.mjs', 'C_', '指针手势'],
  ['batch-d.mjs', 'D', '入场 · 文字 · 动画参数'],
  ['batch-e.mjs', 'E', '面板 · 焦点'],
  ['batch-f.mjs', 'FX', '循环特效'],
  ['batch-g.mjs', 'G', '形变 · 3D'],
  ['batch-h.mjs', 'H', '性能 · 网络 · 占位']
]

const dry = process.argv.includes('--dry')
let total = 0
for (const [file, name, label] of BATCHES) {
  const mod = await import(pathToFileURL(path.join(HERE, file)).href)
  const entries = mod[name]
  const { changed, total: n } = await apply(entries, { dry })
  total += n
  console.log(`  ✓ ${String(n).padStart(2)} 条  ${label.padEnd(22)} ${changed ? `${changed} 条有变化` : '无变化'}`)
}
console.log(`\n  ${dry ? '空跑' : '已写入'} ${total} 条`)
