#!/usr/bin/env node
// 实心强调色底上不许配亮色前景。
//
// 起因（2026-08-19）：`--accent` 两个主题都是浅色（#a2b9e0 / #f78bb0），白字压上去
// 只有约 2:1 对比度，远不到 WCAG AA 的 4.5:1。修的时候我用 grep 找 `color: #fff`，
// 报告「一处都没有了」——**漏了 `var(--accent-fg, #fff)` 这种带 fallback 的写法**，
// 而那个变量全仓库根本没定义，所以 fallback 必然生效。一个审查 agent 抓到的。
//
// 所以这个脚本必须覆盖三种写法，缺一条就等于没查：
//   ① 字面量           color: #fff / white / rgba(255,255,255,…)
//   ② 带 fallback 的变量 color: var(--x, #fff)      ← 上次漏的就是它
//   ③ 未定义的变量      color: var(--x)  且 --x 全仓库没有定义（声明作废，落回继承）
//
// 用法：node scripts/check-accent-contrast.mjs   （有问题时退出码 1）

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), 'src', 'renderer', 'src')
const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(css|tsx|jsx)$/.test(e.name)) files.push(p)
  }
})(ROOT)

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
const all = files.map((f) => ({ f, s: strip(fs.readFileSync(f, 'utf8')) }))

// 哪些自定义属性真的被定义过 —— 用来判断第 ③ 种
const defined = new Set()
for (const { s } of all) for (const m of s.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1])

const LIGHT = /^\s*(#fff\b|#ffffff\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i
const bad = []

for (const { f, s } of all) {
  for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().split('\n').pop().trim()
    const body = m[2]
    if (!sel || sel.startsWith('@')) continue
    const bg = body.match(/background(?:-color|-image)?\s*:\s*([^;]+)/)
    if (!bg) continue
    const v = bg[1]
    const a = v.match(/rgba\(\s*var\(--accent-rgb\)\s*,\s*([\d.]+)\)/)
    // **`--hl-bg` 也算实心高亮底**（2026-09-02）：那天把 47 处
    // `background: var(--accent)` 迁成了 `var(--hl-bg)`，这道闸当场就瞎了 ——
    // 它只认 `--accent`，迁完照样报「一处都没有」。
    // 这类「重命名之后检查器静默失效」和当天 omp 那几处手写类型断言是同一个形状：
    // **没报错不等于查过了。**
    const solid =
      (a && parseFloat(a[1]) >= 0.6) || /\bvar\(--accent\)/.test(v) || /\bvar\(--hl-bg\)/.test(v)
    if (!solid) continue

    const col = body.match(/(?<![-\w])color\s*:\s*([^;]+)/)
    if (!col) continue
    const c = col[1].trim()
    const line = s.slice(0, m.index).split('\n').length

    if (LIGHT.test(c)) bad.push([f, line, sel, c, '亮色字面量'])
    else {
      const fb = c.match(/var\(\s*(--[\w-]+)\s*,\s*([^)]+)\)/)
      if (fb && LIGHT.test(fb[2]) && !defined.has(fb[1]))
        bad.push([f, line, sel, c, `变量 ${fb[1]} 没有定义，fallback 生效`])
      else {
        const bare = c.match(/^var\(\s*(--[\w-]+)\s*\)$/)
        if (bare && !defined.has(bare[1]))
          bad.push([f, line, sel, c, `变量 ${bare[1]} 没有定义，整条 color 作废`])
      }
    }
  }
}

if (!bad.length) {
  console.log('✅ 实心 accent 底上没有亮色前景')
  process.exit(0)
}
console.error(`❌ ${bad.length} 处实心 accent 底配了亮色前景（应该用 var(--on-accent)）：\n`)
for (const [f, line, sel, c, why] of bad)
  console.error(`  ${path.relative(process.cwd(), f)}:${line}\n    ${sel} → color: ${c}   （${why}）`)
process.exit(1)
