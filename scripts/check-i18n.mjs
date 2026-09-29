#!/usr/bin/env node
// 英文适配的「防回退」检查（接在 npm run check 里）。
//
// 中英词典键是否一致由类型系统保证（en.ts 的类型是 Record<zh 的键, string>），
// 占位符是否一致由 src/shared/i18n/i18n.test.ts 保证。这个脚本只管一件事：
// **已迁移的文件里，不许再出现写死的中文字符串或 JSX 文本** —— 否则新功能会悄悄绕过词典，
// 英文界面上冒出中文，而且没有任何东西提醒。
//
// 注释不算；确需保留中文的行（比如发给 AI 的提示词、语言名「中文」），在行尾写
// `// i18n-allow: 原因`。
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/i18n/migrated.json'), 'utf8'))
const CJK = /[一-鿿]/

function stripComments(src) {
  // 块注释替换成等长空白（保住行号）；行注释去掉行尾部分（字符串里的 // 很少含中文，误伤可接受）
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      if (/\/\/\s*i18n-allow/.test(line)) return ''
      const i = line.search(/(^|[^:])\/\//)
      return i >= 0 ? line.slice(0, i + (line[i] === '/' ? 0 : 1)) : line
    })
}

const problems = []
for (const rel of cfg.files) {
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) { problems.push(`${rel}: 清单里的文件不存在`); continue }
  const lines = stripComments(fs.readFileSync(file, 'utf8'))
  lines.forEach((line, i) => {
    if (CJK.test(line)) problems.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`)
  })
}

if (problems.length) {
  console.error('✗ check-i18n：已迁移文件里出现写死的中文（改用 t(\'键\')，词典在 src/shared/i18n/zh.ts / en.ts）：')
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log(`✓ check-i18n：${cfg.files.length} 个已迁移文件无写死中文`)
