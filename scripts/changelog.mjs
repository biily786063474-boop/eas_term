#!/usr/bin/env node
// CHANGELOG.md → 官网更新日志页 + 应用内更新提示要用的 JSON。
//
// 一份来源两处消费，是刻意的：更新日志最容易烂在「官网写了、应用里忘了改」上。
//
//   node scripts/changelog.mjs html   → 写 site/changelog.html
//   node scripts/changelog.mjs notes <版本>  → 打印该版本条目的 JSON 数组（发布脚本塞进 latest.json）
//   node scripts/changelog.mjs check <版本>  → 该版本有没有条目，没有就非零退出

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'CHANGELOG.md')

/** 解析成 [{ version, date, groups: [{ title, items: [] }] }]，按文件里的顺序（新→旧） */
function parse() {
  const lines = fs.readFileSync(SRC, 'utf8').split('\n')
  const out = []
  let cur = null
  let group = null
  for (const line of lines) {
    // `## 0.4.2 — 2026-08-03`：破折号用的是 U+2014，顺手也认普通连字符，免得手写时踩到
    const v = line.match(/^##\s+(\d+\.\d+\.\d+)\s*[—-]\s*(\d{4}-\d{2}-\d{2})\s*$/)
    if (v) {
      cur = { version: v[1], date: v[2], groups: [] }
      group = null
      out.push(cur)
      continue
    }
    // 「更早的版本」这类没有版本号的二级标题：收尾，后面的内容不再归属任何版本
    if (/^##\s/.test(line)) {
      cur = null
      group = null
      continue
    }
    if (!cur) continue
    const g = line.match(/^###\s+(.+?)\s*$/)
    if (g) {
      group = { title: g[1], items: [] }
      cur.groups.push(group)
      continue
    }
    const item = line.match(/^-\s+(.+?)\s*$/)
    if (item && group) {
      group.items.push(item[1])
      continue
    }
    // 条目的续行（上一行没写完，缩进接着写）
    const cont = line.match(/^\s{2,}(\S.*?)\s*$/)
    if (cont && group && group.items.length) {
      group.items[group.items.length - 1] += ' ' + cont[1]
    }
  }
  return out
}

/** 去掉 markdown 标记。应用内的通知是纯文本渲染，
 *  `**x**` 和 `[名字](链接)` 原样出现都很难看 —— 链接只留可读的那部分。 */
const plain = (s) =>
  s
    .replace(/\[(.+?)\]\((?:[^)]+)\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** markdown 的 **粗体** / `代码` → HTML。先转义再替换，顺序反了会把用户内容当标签 */
const rich = (s) =>
  esc(s)
    // 链接放在最前面转：先转粗体的话，链接文字里的 ** 会把方括号拆开
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

function buildHtml(versions) {
  const items = versions
    .map(
      (v) => `      <section class="rel">
        <div class="rel-head">
          <h2 id="v${v.version}">${v.version}</h2>
          <time datetime="${v.date}">${v.date}</time>
        </div>
${v.groups
  .map(
    (g) => `        <h3 class="grp">${esc(g.title)}</h3>
        <ul>
${g.items.map((i) => `          <li>${rich(i)}</li>`).join('\n')}
        </ul>`
  )
  .join('\n')}
      </section>`
    )
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>更新日志 · Eas-Term</title>
<meta name="description" content="Eas-Term 每个版本的更新内容。">
<link rel="stylesheet" href="style.css">
<style>
/* 只加更新日志自己的排版，骨架（nav / wrap / footer）全部继承 style.css。
   类名必须跟 privacy.html 保持一致，另起炉灶会导致页头页脚样式全丢。 */
.rel { padding: 30px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
.rel:last-of-type { border-bottom: none; }
.rel-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 4px; }
.rel-head h2 { font-size: 21px; margin: 0; letter-spacing: -.01em; }
.rel-head time { font-size: 13px; opacity: .5; font-variant-numeric: tabular-nums; }
.grp { font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase;
       opacity: .45; font-weight: 600; margin: 18px 0 8px; }
.rel ul { margin: 0; padding-left: 20px; }
.rel li { margin: 7px 0; line-height: 1.75; }
.rel code { font-size: .92em; padding: 1px 5px; border-radius: 4px;
            background: rgba(255,255,255,.07); }
.cl-body { padding-bottom: 60px; }
</style>
</head>
<body>
    <header class="nav">
      <div class="nav-inner">
        <a class="nav-brand" href="index.html">
          <img src="assets/icon.png" alt="" width="26" height="26" />
          <span>Eas-Term</span>
        </a>
        <nav class="nav-links" aria-label="主导航">
          <a href="index.html#scenes">核心场景</a>
          <a href="index.html#features">能力清单</a>
          <a href="index.html#ai">AI 接入</a>
          <a class="nav-cta" href="download.html">下载</a>
        </nav>
      </div>
    </header>

    <main>
      <section class="page-head">
        <div class="wrap">
          <p class="eyebrow">更新日志</p>
          <h1 class="section-title">每个版本改了什么</h1>
          <p class="lede">
            只记你能感觉到的变化。想知道当前装的是哪一版，看应用标题栏右侧的设置里。
          </p>
        </div>
      </section>

      <div class="wrap cl-body">
${items}
      </div>
    </main>

    <footer class="footer">
      <div class="wrap footer-inner">
        <div class="footer-brand">
          <img src="assets/icon.png" alt="" width="22" height="22" />
          <span>Eas-Term</span>
        </div>
        <nav class="footer-links" aria-label="页脚导航">
          <a href="index.html#features">能力清单</a>
          <a href="download.html">下载</a>
          <a href="changelog.html">更新日志</a>
          <a href="privacy.html">隐私与数据</a>
        </nav>
        <p class="footer-copy">© 2026 Eas-Term</p>
      </div>
    </footer>
    <script src="analytics.js"></script>
</body>
</html>
`
}

const [cmd, arg] = process.argv.slice(2)
const versions = parse()

if (cmd === 'html') {
  const dest = path.join(ROOT, 'site', 'changelog.html')
  fs.writeFileSync(dest, buildHtml(versions))
  console.log(`已生成 ${path.relative(ROOT, dest)}（${versions.length} 个版本）`)
} else if (cmd === 'notes') {
  const v = versions.find((x) => x.version === arg)
  // 找不到就给空数组而不是报错：发布流程里由 check 负责拦，这里只管输出
  process.stdout.write(JSON.stringify(v ? v.groups.flatMap((g) => g.items.map(plain)) : []))
} else if (cmd === 'check') {
  const v = versions.find((x) => x.version === arg)
  if (!v || !v.groups.some((g) => g.items.length)) {
    console.error(`✗ CHANGELOG.md 里没有 ${arg} 的更新内容，先补上再发布`)
    process.exit(1)
  }
  console.log(`✓ ${arg} 有 ${v.groups.reduce((n, g) => n + g.items.length, 0)} 条更新说明`)
} else {
  console.error('用法: changelog.mjs html | notes <版本> | check <版本>')
  process.exit(2)
}
