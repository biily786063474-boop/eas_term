#!/usr/bin/env node
// 两个渲染入口（主窗口 index.html / 灵动岛 island.html）的产物自检。
//
// 为什么需要它（2026-08-22 的事故）：用户报「灵动岛不显示」，落盘日志里那条
// CSP 报错的策略内容**逐字等于 index.html 的 CSP**（带 bizone-media: / easfile:，
// 灵动岛从来不需要这两个协议），而 URL 却写着 island.html —— 也就是说那个包里的
// island.html 装的是 index.html 的内容。灵动岛窗口于是去跑主窗口的 React 入口，
// 拿不到 window.island.* 那套 preload API，整棵树卸载成空，表现就是
// 「窗口在、内容永远不来」。同一时段还有一条 `Unexpected token '}'`：app 正在被
// 覆盖打包时读到了写了一半的 chunk。
//
// 这类事故运行时才发现就太晚了（要等用户撞上、还要翻日志反推），所以在打包前拦。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

const OUT = join(process.cwd(), 'out/renderer')
const errs = []
const fail = (m) => errs.push(m)

/** 取 HTML 里所有 <script src> / <link href> 的文件名 */
const refsOf = (html) =>
  [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1])

for (const [name, mustPrefix, forbid] of [
  ['index.html', 'index', null],
  // 灵动岛的 CSP 比主窗口紧：不联网、不加载外部资源，连 img 的 data: 都不需要。
  // 出现 bizone-media: 就说明这份 HTML 是主窗口那份混进来的。
  ['island.html', 'island', 'bizone-media:']
]) {
  const f = join(OUT, name)
  if (!existsSync(f)) { fail(`${name} 不存在`); continue }
  const html = readFileSync(f, 'utf8')

  if (forbid && html.includes(forbid)) {
    fail(`${name} 含 "${forbid}" —— 这份 HTML 疑似是另一个入口的内容（产物串台）`)
  }
  if (!/<div id="root">/.test(html)) fail(`${name} 缺 #root 挂载点`)

  const refs = refsOf(html)
  const entry = refs.find((r) => /\.js$/.test(r) && !/modulepreload/.test(r))
  if (!entry) fail(`${name} 没有引任何入口脚本`)
  else if (!entry.split('/').pop().startsWith(mustPrefix)) {
    fail(`${name} 的入口脚本是 ${entry}，应以 ${mustPrefix}- 开头（入口串台）`)
  }

  // 引用的每个资源都要真实存在且非空——挡住「app 正在被覆盖打包时读到半截文件」
  for (const r of refs) {
    const p = join(dirname(f), r.replace(/^\.\//, ''))
    if (!existsSync(p)) { fail(`${name} 引用的 ${r} 不存在`); continue }
    if (statSync(p).size === 0) fail(`${name} 引用的 ${r} 是空文件`)
  }
}

if (errs.length) {
  console.error('渲染入口产物自检未通过：')
  for (const e of errs) console.error('  ✗ ' + e)
  process.exit(1)
}
console.log('✓ 渲染入口产物自检通过（index / island 各自引对入口、资源齐全）')
