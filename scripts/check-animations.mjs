#!/usr/bin/env node
// 盯住一件事：**`infinite` 动画只许动合成属性**（opacity / transform）。
//
// ── 为什么值得一条自动检查（2026-08-30）────────────────────────────
// 用户报「点软件能耗那么高」。查下来是五个 `infinite` 动画在补间
// `box-shadow` / `background` / `filter` —— 那几个属性每一帧都要重新光栅化，
// 而 `infinite` 意味着**开着就永远在烧**，跟用不用它无关。
//
// 同一台机器同一时刻的对照（8 秒静置，20 个呼吸点）：
//
//   box-shadow 呼吸    样式重算 960 次    主线程 0.980s
//   opacity    呼吸    样式重算  25 次    主线程 0.019s
//
// 差 50 倍。用户那台连跑 5 天的机器上表现为 GPU 23% + WindowServer 25% 常驻，
// 而渲染器只有 12% —— 不是 JS 在跑，是合成层一直在重画。
//
// 这类写法**看起来完全正常**，评审时也不会觉得不对（谁都写过
// `animation: pulse 2s infinite` 配 box-shadow）。只有量过才知道代价，
// 所以交给机器每次都查一遍。
//
// ── 判据 ────────────────────────────────────────────────────────
// 只查 `infinite` 的。有限次数的动画（入场、点击反馈）跑完就停，
// 贵一点无所谓 —— 拦它们只会逼人写出更难懂的 CSS。
import fs from 'node:fs'
import path from 'node:path'

/** 合成属性：改它们不触发重绘，也不触发样式重算 */
const CHEAP = new Set(['opacity', 'transform'])
const ROOT = 'src/renderer/src'

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.css')) out.push(p)
  }
  return out
}

const problems = []
for (const file of walk(ROOT)) {
  const css = fs.readFileSync(file, 'utf8')
  if (!css.includes('infinite')) continue

  // 收集所有被 infinite 引用的 keyframes 名。
  // **只认 `animation:` 简写里带 infinite 的那些** —— animation-name 分开写
  // 的情况这个仓库没有，真出现了这条检查会漏，那时候再补
  const names = new Set()
  for (const m of css.matchAll(/animation:\s*([a-zA-Z0-9_-]+)[^;]*infinite/g)) names.add(m[1])
  for (const m of css.matchAll(/animation:[^;]*?infinite[^;]*?\s([a-zA-Z0-9_-]+)\s*;/g)) names.add(m[1])

  for (const name of names) {
    const kf = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`))
    if (!kf) continue // 定义在别的文件里，跨文件解析不值得为它做
    const props = new Set([...kf[1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))
    const bad = [...props].filter((p) => !CHEAP.has(p))
    if (bad.length) problems.push({ file, name, bad })
  }
}

if (problems.length) {
  console.error('✗ 这些 infinite 动画在动「每帧都要重新光栅化」的属性：\n')
  for (const p of problems) {
    console.error(`  ${p.file}`)
    console.error(`    @${p.name} → ${p.bad.join(', ')}`)
  }
  console.error(`
  改法：把要闪的效果**固定画在伪元素上**，动画只改它的 opacity
  （要缩放就配 transform）。视觉一样，但只走合成层。
  canvas.css 的 .cd-proj.breathing 和 voice.css 的 .voice-btn.rec 是改好的样板。

  实测代价：8 秒静置、20 个呼吸点 —— box-shadow 版样式重算 960 次、
  主线程 0.98s；opacity 版 25 次、0.019s。而 infinite 意味着开着就一直烧。`)
  process.exit(1)
}
console.log(`✓ infinite 动画只动合成属性（扫了 ${walk(ROOT).length} 个 CSS 文件）`)
