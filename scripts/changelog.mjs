#!/usr/bin/env node
// CHANGELOG.md → 官网更新日志页 + 应用内更新提示要用的 JSON。
//
// 一份来源两处消费，是刻意的：更新日志最容易烂在「官网写了、应用里忘了改」上。
//
//   node scripts/changelog.mjs html   → 写 site/changelog.html 与英文版 site/en/changelog.html
//   node scripts/changelog.mjs notes <版本> [en]  → 打印该版本条目的 JSON 数组（发布脚本塞进 latest.json）
//   node scripts/changelog.mjs check <版本>  → 该版本有没有条目，没有就非零退出
//
// 英文来源是 CHANGELOG.en.md（同一套格式，版本行一字不差）。某个版本还没译时：
// 英文页照样列出这一版、条目用中文原文并标注「Not yet translated」，check 只警告不拦发布；
// notes en 拿不到就输出空数组，应用会退回中文条目。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'CHANGELOG.md')
const SRC_EN = path.join(ROOT, 'CHANGELOG.en.md')

/** 解析成 [{ version, date, groups: [{ title, items: [] }] }]，按文件里的顺序（新→旧） */
function parse(file = SRC) {
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
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

const TEXT = {
  zh: {
    htmlLang: 'zh-CN', prefix: '', title: '更新日志 · Eas-Term', desc: 'Eas-Term 每个版本的更新内容。',
    mainNav: '主导航', scenes: '核心场景', features: '能力清单', ai: 'AI 接入', manual: '使用手册', download: '下载',
    eyebrow: '更新日志', heading: '每个版本改了什么',
    lede: '只记你能感觉到的变化。想知道当前装的是哪一版，看应用标题栏右侧的设置里。',
    footNav: '页脚导航', changelog: '更新日志', privacy: '隐私与数据', spbTitle: 'SPB 空间 —— 超能力基地',
    langHref: 'en/changelog.html', langLabel: 'EN', untranslated: ''
  },
  en: {
    htmlLang: 'en', prefix: '../', title: 'Changelog · Eas-Term', desc: 'What changed in every Eas-Term release.',
    mainNav: 'Main navigation', scenes: 'Workflows', features: 'Features', ai: 'AI Integration', manual: 'Manual', download: 'Download',
    eyebrow: 'Changelog', heading: 'What changed in each release',
    lede: 'Only the changes you can actually feel. To see which version you have, open Settings from the right side of the app title bar.',
    footNav: 'Footer navigation', changelog: 'Changelog', privacy: 'Privacy & Data', spbTitle: 'SPB Space — the superpower base',
    langHref: '../changelog.html', langLabel: '中文', untranslated: 'Not yet translated — showing the original Chinese notes.'
  }
}

function buildHtml(versions, lang = 'zh') {
  const L = TEXT[lang]
  const P = L.prefix
  const items = versions
    .map(
      (v) => `      <section class="rel">
        <div class="rel-head">
          <h2 id="v${v.version}">${v.version}</h2>
          <time datetime="${v.date}">${v.date}</time>
        </div>
${v.untranslated ? `        <p class="grp-note">${esc(L.untranslated)}</p>\n` : ''}${v.groups
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
<html lang="${L.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title}</title>
<meta name="description" content="${L.desc}">
<link rel="stylesheet" href="${P}vendor/spb-design/spb-lockup.css">
<link rel="stylesheet" href="${P}style.css">
<link rel="alternate" hreflang="zh-CN" href="${lang === 'zh' ? 'changelog.html' : '../changelog.html'}">
<link rel="alternate" hreflang="en" href="${lang === 'zh' ? 'en/changelog.html' : 'changelog.html'}">
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
.grp-note { font-size: 13px; opacity: .5; margin: 10px 0 0; }
</style>
</head>
<body>
    <header class="nav">
      <div class="nav-inner">
        <span class="spb-lockup"><a class="spb-mark" href="https://spb.biily.top/" title="${L.spbTitle}">SPB<em>.</em></a><span class="spb-sep" aria-hidden="true">|</span><a class="nav-brand" href="index.html">
          <img src="${P}assets/icon.png" alt="" width="26" height="26" />
          <span>Eas-Term</span>
        </a></span>
        <nav class="nav-links" aria-label="${L.mainNav}">
          <a href="index.html#scenes">${L.scenes}</a>
          <a href="index.html#features">${L.features}</a>
          <a href="index.html#ai">${L.ai}</a>
          <a href="manual.html">${L.manual}</a>
          <a href="${L.langHref}" lang="${lang === 'zh' ? 'en' : 'zh-CN'}" hreflang="${lang === 'zh' ? 'en' : 'zh-CN'}">${L.langLabel}</a>
          <a class="nav-cta" href="download.html">${L.download}</a>
        </nav>
      </div>
    </header>

    <main>
      <section class="page-head">
        <div class="wrap">
          <p class="eyebrow">${L.eyebrow}</p>
          <h1 class="section-title">${L.heading}</h1>
          <p class="lede">
            ${L.lede}
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
          <img src="${P}assets/icon.png" alt="" width="22" height="22" />
          <span>Eas-Term</span>
        </div>
        <nav class="footer-links" aria-label="${L.footNav}">
          <a href="index.html#features">${L.features}</a>
          <a href="manual.html">${L.manual}</a>
          <a href="download.html">${L.download}</a>
          <a href="changelog.html">${L.changelog}</a>
          <a href="privacy.html">${L.privacy}</a>
        </nav>
        <p class="footer-copy">© 2026 Eas-Term</p>
      </div>
    </footer>
    <script src="${P}analytics.js"></script>
</body>
</html>
`
}

const [cmd, arg] = process.argv.slice(2)
const versions = parse()

/** 英文版：以中文的版本列表为准，缺译的版本用中文条目顶上并打标 */
function englishVersions() {
  const en = new Map(parse(SRC_EN).map((v) => [v.version, v]))
  return versions.map((v) => {
    const e = en.get(v.version)
    return e && e.groups.some((g) => g.items.length) ? e : { ...v, untranslated: true }
  })
}

if (cmd === 'html') {
  const dest = path.join(ROOT, 'site', 'changelog.html')
  fs.writeFileSync(dest, buildHtml(versions))
  console.log(`已生成 ${path.relative(ROOT, dest)}（${versions.length} 个版本）`)
  const enVersions = englishVersions()
  const destEn = path.join(ROOT, 'site', 'en', 'changelog.html')
  fs.mkdirSync(path.dirname(destEn), { recursive: true })
  fs.writeFileSync(destEn, buildHtml(enVersions, 'en'))
  const gaps = enVersions.filter((v) => v.untranslated).map((v) => v.version)
  console.log(`已生成 ${path.relative(ROOT, destEn)}（${enVersions.length} 个版本${gaps.length ? `，${gaps.length} 个未译：${gaps.join(' ')}` : ''}）`)
} else if (cmd === 'notes') {
  const v = (process.argv[4] === 'en' ? parse(SRC_EN) : versions).find((x) => x.version === arg)
  // 找不到就给空数组而不是报错：发布流程里由 check 负责拦，这里只管输出
  process.stdout.write(JSON.stringify(v ? v.groups.flatMap((g) => g.items.map(plain)) : []))
} else if (cmd === 'check') {
  const v = versions.find((x) => x.version === arg)
  if (!v || !v.groups.some((g) => g.items.length)) {
    console.error(`✗ CHANGELOG.md 里没有 ${arg} 的更新内容，先补上再发布`)
    process.exit(1)
  }
  console.log(`✓ ${arg} 有 ${v.groups.reduce((n, g) => n + g.items.length, 0)} 条更新说明`)
  const e = parse(SRC_EN).find((x) => x.version === arg)
  if (!e || !e.groups.some((g) => g.items.length)) {
    // 只警告：英文缺译不拦发布，官网英文页会标注未译、应用内退回中文条目
    console.error(`⚠ CHANGELOG.en.md 里没有 ${arg} 的英文条目，英文用户会看到中文原文`)
  }
} else {
  console.error('用法: changelog.mjs html | notes <版本> [en] | check <版本>')
  process.exit(2)
}
