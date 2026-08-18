#!/usr/bin/env node
// 面 6（会话驱动）的**静态**审计：不起进程、不烧额度、秒回。
//
// 它抓的是「加了 adapter 却忘了别处」这类漏 —— 那种漏不报错、测试全绿，
// 只在真用起来时表现为「新 CLI 在终端里跑，灵动岛认不出它」这种静默失败。
//
// 真起一轮会话的那部分**没法自动化**（要花用户的额度，还要人眼看流式和时序），
// 清单在 SKILL.md 的「验收」一节，手动过。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const R = (p) => path.join(ROOT, p)
const read = (p) => { try { return fs.readFileSync(R(p), 'utf8') } catch { return '' } }
const G = (s) => `\x1b[32m${s}\x1b[0m`, Y = (s) => `\x1b[33m${s}\x1b[0m`, D = (s) => `\x1b[90m${s}\x1b[0m`

let warn = 0

console.log('\n═══ adapter 注册表 ═══')
const adapterDir = 'src/main/agentChat/adapters'
const files = fs.readdirSync(R(adapterDir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const index = read(`${adapterDir}/index.ts`)
const registered = [...index.matchAll(/(\w+Adapter)/g)].map((m) => m[1])
for (const f of files.filter((f) => !['index.ts', 'detect.ts'].includes(f))) {
  const src = read(`${adapterDir}/${f}`)
  const name = (src.match(/export const (\w+Adapter)/) || [])[1]
  const inReg = name && registered.includes(name)
  console.log(`  ${inReg ? G('✓') : Y('!')} ${f.padEnd(12)} ${name ?? '(没找到 export const *Adapter)'}${inReg ? '' : '  ← 没在 index.ts 注册，永远不会被用到'}`)
  if (!inReg) warn++
  // 七个字段逐个报，缺的不一定是错（有些是可选的降级），但必须是**想清楚才不写**
  const has = (k) => new RegExp(`\\b${k}\\s*[:(]`).test(src)
  const fields = ['capabilities', 'detect', 'buildArgs', 'createTranslator', 'approvalHook', 'paramChange']
  console.log(D(`     ${fields.map((k) => `${has(k) ? '·' : '×'}${k}`).join('  ')}`))
}

console.log('\n═══ 不许按 CLI 名字分支 ═══')
// adapter 存在的全部意义就是「下游判能力，不判名字」。
// 这里扫的是**下游**——adapter 自己文件里出现自己的 id 是正常的。
const downstream = ['src/main/agentChat/session.ts', 'src/renderer/src/features/agentChat']
let branches = []
const walk = (p) => {
  const abs = R(p)
  if (!fs.existsSync(abs)) return
  if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs)) walk(path.join(p, f)); return }
  if (!/\.(ts|tsx)$/.test(p) || p.endsWith('.test.ts')) return
  read(p).split('\n').forEach((line, i) => {
    const t = line.trim()
    // 跳过注释：讲「不要写 `id === 'codex'`」的说明文字本身会命中这个正则，
    // 报出来就是误报，而误报会让人下次直接无视这个脚本
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    if (/(cli|id|kind)\s*===\s*['"](claude|codex)['"]/.test(t)) branches.push(`${p}:${i + 1}  ${t.slice(0, 70)}`)
  })
}
downstream.forEach(walk)
if (branches.length === 0) console.log(`  ${G('✓')} 下游没有 \`=== 'claude'\` 这类硬分支`)
else { branches.forEach((b) => console.log(`  ${Y('!')} ${b}`)); warn += branches.length }

console.log('\n═══ 加新 CLI 时要一起扩的联合类型 ═══')
// 这一步最容易漏，而且漏了不报错。pty.ts 的 agentOnTty 尤其要紧：
// 它按终端里的进程名认 agent，不扩的话新 CLI 跑起来，通知/灵动岛/状态机全认不出。
const hits = new Map()
const scan = (p) => {
  const abs = R(p)
  if (!fs.existsSync(abs)) return
  if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs)) if (f !== 'node_modules') scan(path.join(p, f)); return }
  if (!/\.(ts|tsx)$/.test(p)) return
  const n = (read(p).match(/'claude' \| 'codex'/g) || []).length
  if (n) hits.set(p, n)
}
scan('src')
const total = [...hits.values()].reduce((a, b) => a + b, 0)
console.log(`  ${total ? Y('!') : G('✓')} 共 ${total} 处 / ${hits.size} 个文件`)
for (const [f, n] of [...hits].sort((a, b) => b[1] - a[1])) {
  const key = f.includes('pty.ts') ? '  ← agentOnTty 按进程名认 agent，不扩它新 CLI 会一路静默' : ''
  console.log(D(`     ${String(n).padStart(2)} × ${f}${key}`))
}

console.log(`\n${warn ? Y(`⚠ ${warn} 处要看一眼`) : G('✓ 面 6 静态检查通过')}`)
console.log(D('真起一轮会话的验收清单在 SKILL.md「验收」一节，那部分只能手动过。\n'))
