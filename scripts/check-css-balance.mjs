#!/usr/bin/env node
// CSS 大括号平衡检查。**放进 npm run check，不是可选项。**
//
// ── 为什么值得单开一个检查 ──────────────────────────────────────────
// 2026-08-29：合并分支时手抖吃掉了 agentChat.css 里一个 `}`，
// 后果不是「那条规则失效」，而是**整个 app 变成没有样式的毛坯房**：
//
//   CSS 解析器遇到未闭合的规则，会把后面所有内容都当成它的声明块吞掉；
//   而 Vite 把全部 CSS 拼进一个 index-*.css，`base.css` 恰好排在最后
//   （main.tsx 里 `import { App }` 在 `import './styles/base.css'` 之前，
//   App 那棵依赖树先求值）——于是整份基础样式被一条断掉的规则吞光。
//
// **构建不会报错**（CSS 没有语法错误的概念，只有"解析到哪算哪"），
// typecheck 和单测也都是绿的。只有真的打开 app 才看得出来 —— 而那正是
// 最容易跳过的一步。这个脚本把它变成 10 毫秒的静态检查。
import fs from 'node:fs'
import path from 'node:path'

// **不要写嵌套的根**（'src/renderer' 已经包含 'src/renderer/src'）——
// 重复遍历会把同一个文件报两遍，看起来像两个 bug
const roots = ['src/renderer', 'src/main', 'resources']
const files = []

function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.css')) files.push(p)
  }
}
for (const r of roots) walk(r)

/** 去掉注释和字符串里的括号 —— 它们不参与配对。
 *  `content: "}"` 和 `/* } *​/` 都是合法的，不能算进去。 */
function strip(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i]
      i++
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1
      i++
      continue
    }
    out += src[i++]
  }
  return out
}

let bad = 0
for (const f of files) {
  const src = strip(fs.readFileSync(f, 'utf8'))
  let depth = 0
  let line = 1
  /** 每一层 `{` 是在第几行开的 —— 文件结束时还没弹出的那些，就是没闭合的 */
  const openLines = []
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') line++
    else if (src[i] === '{') {
      depth++
      openLines.push(line)
    } else if (src[i] === '}') {
      openLines.pop()
      depth--
      if (depth < 0) {
        console.error(`✗ ${f}:${line} 多了一个 }`)
        bad++
        depth = 0
      }
    }
  }
  if (depth !== 0) {
    console.error(`✗ ${f} 少了 ${depth} 个 }（第 ${openLines.join(' / ')} 行的 { 没闭合）`)
    console.error(`   后果不是这条规则失效，是**后面所有 CSS 被吞掉** —— 见本脚本开头的说明`)
    bad++
  }
}

if (bad) {
  console.error(`\n${bad} 个文件括号不平衡`)
  process.exit(1)
}
console.log(`✓ CSS 括号平衡（${files.length} 个文件）`)
