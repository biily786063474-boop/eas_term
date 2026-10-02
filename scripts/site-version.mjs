#!/usr/bin/env node
// 官网页面的版本号回填 + 残留检查。publish-site.sh 调它；逻辑在这里是为了能单测
//（原先是 shell 里的 sed，2026-10-02 发 0.4.120/0.4.121 时撞上两个漏洞，都只能手动绕）：
//
//  1. 下载链接用通配回填：`/download/v任意/Eas-Term-任意-arm64.dmg` 一律改成新版 ——
//     下载页刻意保留的 macOS 11 旧入口（0.4.113）也被改掉，旧系统用户的下载链接指向一个不支持他的版本。
//     现在**只改「上一个发布版本」的链接**：上一版 = 页面里 `<!-- vX.Y.Z -->` 标记写的那个版本。
//     其余版本的链接都是刻意钉住的旧入口（或落后的 Windows 包），原样保留，交给调用方去服务器核对存在。
//  2. 残留检查只看下载链接和标记，管不到新首页上显示的版本标签
//     （`<div class="win-ver">v0.4.120</div>`、`macOS · Windows · v0.4.120</p>`）——
//     发 0.4.120 时首页上 34 处旧版本号全靠手动改。现在标签也一起回填、一起检查。
//
// 用法：
//   node scripts/site-version.mjs backfill <版本> [--win] <页面…>   就地回填，打印 JSON 报告；有残留退出 1
//   node scripts/site-version.mjs refs <页面…>                         只读：列出页面引用的所有下载版本
// --win：本地有这一版的 Windows 包，exe 链接也跟着改；不带则 exe 停在旧版（允许落后，进 pinned 由调用方核对）。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const V = String.raw`\d+\.\d+\.\d+`
const MARKER = new RegExp(String.raw`<!-- v(${V}) -->`, 'g')
// 页面上显示给人看的版本标签：紧跟在 `>` 或 `· ` 后面、直到 `<` 的整段文字。
// 限定这两种上下文，避免误碰 SVG 路径里形如 v1.2 的坐标（那里后面跟的不是 `<`）。
const LABEL = new RegExp(String.raw`(>|· )v(${V})<`, 'g')
const LINK = new RegExp(String.raw`/download/v(${V})/Eas-Term-(${V})-([A-Za-z0-9.-]+)`, 'g')

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 页面里版本标记写的版本（= 上一次发布时回填进去的那一版） */
export function markerVersions(html) {
  return [...new Set([...html.matchAll(MARKER)].map((m) => m[1]))]
}

/** 把「上一版」old 的标记、标签、mac 包链接改成 version；win=true 时 exe 也改。其他版本一律不动。 */
export function backfill(html, version, olds, { win = false } = {}) {
  let out = html
  for (const old of olds) {
    if (old === version) continue
    const o = esc(old)
    out = out
      .replace(new RegExp(String.raw`<!-- v${o} -->`, 'g'), `<!-- v${version} -->`)
      .replace(new RegExp(String.raw`(>|· )v${o}<`, 'g'), `$1v${version}<`)
      .replace(new RegExp(String.raw`/download/v${o}/Eas-Term-${o}-((?:arm64|x64)\.(?:dmg|zip))`, 'g'), `/download/v${version}/Eas-Term-${version}-$1`)
    if (win) {
      out = out.replace(new RegExp(String.raw`/download/v${o}/Eas-Term-${o}-x64-setup\.exe`, 'g'), `/download/v${version}/Eas-Term-${version}-x64-setup.exe`)
    }
  }
  return out
}

/** 回填之后核对。stale：本该是新版却不是的（标记、标签、上一版的 mac 包链接）→ 必须为空。
 *  pinned：指向其他版本的下载链接（钉住的旧入口、落后的 Windows 包）→ 调用方逐个去服务器核对存在。 */
export function audit(html, version, olds) {
  const stale = []
  const pinned = []
  for (const m of html.matchAll(MARKER)) if (m[1] !== version) stale.push(m[0])
  for (const m of html.matchAll(LABEL)) if (m[2] !== version) stale.push(m[0])
  for (const m of html.matchAll(LINK)) {
    const [url, dirV, fileV, tail] = m
    if (dirV !== fileV) { stale.push(url); continue } // 目录与文件名版本不一致，必是改坏了
    if (dirV === version) continue
    const isExe = tail === 'x64-setup.exe'
    if (olds.includes(dirV) && !isExe) stale.push(url) // 上一版的 mac 包链接没被改到
    else pinned.push(url)
  }
  return { stale: [...new Set(stale)], pinned: [...new Set(pinned)] }
}

/** 页面引用的全部下载版本（清理旧版本时，这些一个都不能删） */
export function referencedVersions(html) {
  return [...new Set([...html.matchAll(LINK)].map((m) => m[1]))]
}

function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'refs') {
    const vs = new Set()
    for (const f of rest) if (fs.existsSync(f)) for (const v of referencedVersions(fs.readFileSync(f, 'utf8'))) vs.add(v)
    console.log([...vs].sort().join('\n'))
    return 0
  }
  if (cmd === 'backfill') {
    const version = rest.shift()
    const win = rest[0] === '--win' ? (rest.shift(), true) : false
    if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !rest.length) {
      console.error('用法: site-version.mjs backfill <版本> [--win] <页面…>')
      return 2
    }
    const pages = rest.map((f) => ({ f, html: fs.readFileSync(f, 'utf8') }))
    // 「上一版」按所有页面的标记合起来算：首页没有标记，版本标签靠下载页的标记来认
    const olds = [...new Set(pages.flatMap((p) => markerVersions(p.html)))]
    const report = { version, olds, changed: [], stale: [], pinned: [] }
    for (const p of pages) {
      const next = backfill(p.html, version, olds, { win })
      if (next !== p.html) { fs.writeFileSync(p.f, next); report.changed.push(p.f) }
      const a = audit(next, version, olds)
      report.stale.push(...a.stale.map((s) => `${p.f}: ${s}`))
      report.pinned.push(...a.pinned)
    }
    report.pinned = [...new Set(report.pinned)]
    console.log(JSON.stringify(report, null, 2))
    return report.stale.length ? 1 : 0
  }
  console.error('用法: site-version.mjs backfill <版本> [--win] <页面…> | refs <页面…>')
  return 2
}

// 判断「是被命令行直接执行」：两边都取真实路径再比。
// 仓库路径带空格（`vibe coding`）时 import.meta.url 里是 %20；从软链路径（macOS 的 /tmp → /private/tmp）
// 执行时 import.meta.url 是解析后的真实路径而 argv[1] 不是 —— 直接拼 `file://${argv[1]}` 两种情况都永远不相等，
// main 静默不跑、回填什么都不做（2026-10-02 试跑与单测各抓到一种）。
const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
