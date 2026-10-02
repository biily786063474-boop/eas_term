// 生成官网使用手册：site/manual.html（中文）与 site/en/manual.html（英文）。
//   node scripts/build-manual.mjs
// 正文在 scripts/manual/content.{zh,en}.mjs；配图由 scripts/manual-shots.mjs 生成到 site/assets/manual-<lang>-<编号>.webp。
// 两种语言的章节 id、配图编号必须一一对应 —— 对不上就报错退出，不生成（中英要同一批做完）。
import fs from 'node:fs'
import path from 'node:path'
import * as zh from './manual/content.zh.mjs'
import * as en from './manual/content.en.mjs'

const root = path.resolve(import.meta.dirname, '..')
// 章节按「部分」的顺序排（界面区域 → 章节），每章必须恰好属于一个部分
const ordered = (c) => c.parts.flatMap((p) => p.sections.map((id) => c.sections.find((s) => s.id === id)))
const figIds = (c) => [...ordered(c).filter(Boolean).map((s) => s.body).join('\n').matchAll(/\{\{fig:(\d+)\}\}/g)].map((m) => m[1])

// ── 中英对齐检查 ──
const problems = []
for (const [lang, c] of [['zh', zh], ['en', en]]) {
  const inParts = c.parts.flatMap((p) => p.sections)
  for (const s of c.sections) if (inParts.filter((x) => x === s.id).length !== 1) problems.push(`${lang}：章节 ${s.id} 没有归到某个部分，或归了不止一次`)
  for (const id of inParts) if (!c.sections.some((s) => s.id === id)) problems.push(`${lang}：部分里列了不存在的章节 ${id}`)
}
if (zh.parts.map((p) => p.id + ':' + p.sections.join('/')).join(',') !== en.parts.map((p) => p.id + ':' + p.sections.join('/')).join(',')) problems.push('中英「部分」结构不一致')
const zs = ordered(zh).map((s) => s?.id).join(','), es = ordered(en).map((s) => s?.id).join(',')
if (zs !== es) problems.push(`章节 id 不一致：\n  zh ${zs}\n  en ${es}`)
if (figIds(zh).join(',') !== figIds(en).join(',')) problems.push('正文里引用的配图编号或顺序不一致')
for (const [lang, c] of [['zh', zh], ['en', en]]) {
  for (const id of figIds(c)) {
    if (!c.figs[id]) problems.push(`${lang}：配图 ${id} 没有说明`)
    if (!fs.existsSync(path.join(root, `site/assets/manual-${lang}-${id}.webp`))) problems.push(`${lang}：缺图 site/assets/manual-${lang}-${id}.webp`)
  }
  if (c.keys.length !== zh.keys.length) problems.push(`${lang}：快捷键表行数不一致`)
}
if (problems.length) { console.error('✗ build-manual：\n' + problems.join('\n')); process.exit(1) }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function figure(lang, c, id) {
  const f = c.figs[id]
  const pins = (f.pins || []).map((p) => `<span class="mn-pin" style="left:${p.x}%;top:${p.y}%">${p.n}</span>`).join('')
  const legend = f.pins?.length ? `<ol class="mn-legend">${f.pins.map((p) => `<li value="${p.n}">${esc(p.t)}</li>`).join('')}</ol>` : ''
  const src = `${lang === 'zh' ? '' : '../'}assets/manual-${lang}-${id}.webp`
  return `<figure class="mn-fig" id="fig-${id}"><a class="mn-shot" href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(f.cap)}" loading="lazy" width="1600" height="1000">${pins}</a><figcaption>${c.meta.figLabel} ${Number(id)} · ${esc(f.cap)}</figcaption>${legend}</figure>`
}

function keysTable(c) {
  const [a, b, n] = c.meta.keysHead
  return `<div class="pv-table-wrap"><table><tr><th>${a}</th><th>${b}</th><th>${n}</th></tr>${c.keys.map((k) => `<tr><td>${esc(k[0])}</td><td><kbd>${esc(k[1])}</kbd></td><td>${esc(k[2])}</td></tr>`).join('')}</table></div>`
}

const NAV = {
  zh: { skip: '跳到正文', mainNav: '主导航', scenes: '核心场景', features: '能力清单', manual: '使用手册', download: '下载', other: 'en/manual.html', otherLabel: 'EN', otherLang: 'en', footNav: '页脚导航', changelog: '更新日志', privacy: '隐私与数据', spb: 'SPB 空间 —— 超能力基地', p: '' },
  en: { skip: 'Skip to content', mainNav: 'Main navigation', scenes: 'Workflows', features: 'Features', manual: 'Manual', download: 'Download', other: '../manual.html', otherLabel: '中文', otherLang: 'zh-CN', footNav: 'Footer navigation', changelog: 'Changelog', privacy: 'Privacy &amp; Data', spb: 'SPB Space — the superpower base', p: '../' }
}

function page(lang, c) {
  const N = NAV[lang], P = N.p
  const label = (p) => c.meta.partLabel.replace('{n}', p.n)
  const chapter = (s) => `<section class="mn-sec" id="${s.id}"><h2>${esc(s.title)}</h2>${s.body.replace(/\{\{fig:(\d+)\}\}/g, (_, id) => figure(lang, c, id)).replace('{{keys}}', keysTable(c))}</section>`
  const body = c.parts.map((p) => `<div class="mn-part" id="${p.id}"><div class="mn-part-head"><span class="mn-part-label">${esc(label(p))}</span><h2 class="mn-part-title">${esc(p.title)}</h2>${p.intro}<ul class="mn-part-list">${p.sections.map((id) => `<li><a href="#${id}">${esc(c.sections.find((s) => s.id === id).title)}</a></li>`).join('')}</ul></div>${p.sections.map((id) => chapter(c.sections.find((s) => s.id === id))).join('\n')}</div>`).join('\n')
  const toc = c.parts.map((p) => `<li class="mn-toc-part"><a href="#${p.id}"><span>${esc(label(p))}</span>${esc(p.title)}</a><ol>${p.sections.map((id) => `<li><a href="#${id}">${esc(c.sections.find((s) => s.id === id).title)}</a></li>`).join('')}</ol></li>`).join('')
  return `<!doctype html>
<html lang="${c.meta.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(c.meta.title)}</title>
    <meta name="description" content="${esc(c.meta.description)}" />
    <link rel="icon" href="${P}assets/icon.png" />
    <link rel="alternate" hreflang="zh-CN" href="${lang === 'zh' ? 'manual.html' : '../manual.html'}" />
    <link rel="alternate" hreflang="en" href="${lang === 'zh' ? 'en/manual.html' : 'manual.html'}" />
    <link rel="stylesheet" href="${P}vendor/spb-design/tokens-core.css" />
    <link rel="stylesheet" href="${P}vendor/spb-design/fonts/fonts.css" />
    <link rel="stylesheet" href="${P}vendor/spb-design/ambient-grid.css" />
    <link rel="stylesheet" href="${P}vendor/spb-design/scroll-motion.css" />
    <link rel="stylesheet" href="${P}vendor/spb-design/spb-lockup.css" />
    <link rel="stylesheet" href="${P}style.css" />
    <style>
      /* 手册专用排版：左侧目录常驻，正文长文；骨架（nav / wrap / footer）继承 style.css */
      .mn-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 48px; align-items: start; padding-bottom: 80px; }
      .mn-toc { position: sticky; top: 88px; max-height: calc(100vh - 110px); overflow: auto; font-size: 14px; }
      .mn-toc p { margin: 0 0 10px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; opacity: .5; }
      .mn-toc ol { list-style: none; margin: 0; padding: 0; }
      .mn-toc li { margin: 0; }
      .mn-toc a { display: block; padding: 5px 10px; border-radius: 7px; color: var(--fg-dim, #9aa0b4); text-decoration: none; }
      .mn-toc a:hover, .mn-toc a.on { color: var(--fg, #e8eaf2); background: rgba(255,255,255,.06); }
      /* 半透明底：背景点阵动效会透到正文后面，长文阅读时干扰视线 */
      .mn-body { max-width: 860px; min-width: 0; padding: 28px 36px 40px; border-radius: 18px; border: 1px solid rgba(255,255,255,.06); background: rgba(10,11,14,.84); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
      .mn-toc { padding: 16px 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,.06); background: rgba(10,11,14,.78); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
      .mn-toc-part { margin: 0 0 10px; }
      .mn-toc-part > a { color: var(--fg, #e8eaf2); font-weight: 600; }
      .mn-toc-part > a span { display: block; font-size: 11px; font-weight: 500; letter-spacing: .08em; opacity: .5; }
      .mn-toc-part > ol { margin: 2px 0 0 10px; padding-left: 8px; border-left: 1px solid rgba(255,255,255,.08); }
      .mn-toc-part > ol a { padding: 4px 10px; font-size: 13.5px; }
      .mn-part { padding-top: 8px; scroll-margin-top: 80px; }
      .mn-part + .mn-part { margin-top: 56px; }
      .mn-part-head { padding: 22px 24px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(162,185,224,.05); scroll-margin-top: 80px; }
      .mn-part-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #a2b9e0; }
      .mn-part-title { margin: 4px 0 8px; font-size: 28px; letter-spacing: -0.01em; }
      .mn-part-head p { margin: 6px 0; line-height: 1.75; color: var(--fg-dim, #9aa0b4); }
      .mn-part-list { display: flex; flex-wrap: wrap; gap: 6px 8px; margin: 12px 0 0; padding: 0; list-style: none; }
      .mn-part-list a { display: inline-block; padding: 3px 10px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; font-size: 13px; text-decoration: none; }
      .mn-part .mn-sec:first-of-type h2 { margin-top: 30px; }
      .mn-sec { padding-top: 12px; scroll-margin-top: 80px; }
      .mn-sec h2 { margin: 44px 0 14px; font-size: 24px; letter-spacing: -0.01em; }
      .mn-sec h3 { margin: 28px 0 10px; font-size: 17px; color: var(--fg, #e8eaf2); }
      .mn-sec p, .mn-sec li { line-height: 1.8; }
      .mn-sec ul { margin: 10px 0 10px 20px; }
      .mn-sec li { margin: 5px 0; }
      .mn-sec code { padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,.07); font-size: .9em; white-space: normal; word-break: break-all; }
      kbd { display: inline-block; padding: 0 6px; border: 1px solid rgba(255,255,255,.18); border-bottom-width: 2px; border-radius: 5px; background: rgba(255,255,255,.05); font: inherit; font-size: .88em; line-height: 1.6; white-space: nowrap; }
      .mn-fig { margin: 20px 0 26px; }
      .mn-shot { position: relative; display: block; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,.1); background: #0d0d0d; }
      .mn-shot img { display: block; width: 100%; height: auto; }
      .mn-pin { position: absolute; transform: translate(-50%, -50%); width: 22px; height: 22px; border-radius: 50%; background: #a2b9e0; color: #0b0d12; font-size: 12px; font-weight: 700; line-height: 22px; text-align: center; box-shadow: 0 0 0 3px rgba(11,13,18,.75); pointer-events: none; }
      .mn-fig figcaption { margin-top: 8px; font-size: 13px; color: var(--fg-dim, #9aa0b4); }
      .mn-legend { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 10px 0 0; padding: 0; list-style: none; counter-reset: none; font-size: 13.5px; }
      .mn-legend li { margin: 0; color: var(--fg-dim, #9aa0b4); }
      .mn-legend li::before { content: attr(value); display: inline-block; width: 18px; height: 18px; margin-right: 6px; border-radius: 50%; background: #a2b9e0; color: #0b0d12; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; }
      .mn-tip, .mn-note { margin: 16px 0; padding: 12px 16px; border-radius: 0 8px 8px 0; line-height: 1.75; }
      .mn-tip { border-left: 3px solid #a2b9e0; background: rgba(162,185,224,.07); }
      .mn-note { border-left: 3px solid #d9b478; background: rgba(217,180,120,.07); }
      .mn-table, .mn-sec table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 14px 0; }
      .mn-sec th, .mn-sec td { padding: 9px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.09); vertical-align: top; }
      .mn-sec th { font-weight: 600; border-bottom-color: rgba(255,255,255,.18); }
      .pv-table-wrap { overflow-x: auto; }
      @media (max-width: 900px) {
        .mn-layout { grid-template-columns: 1fr; gap: 12px; }
        .mn-toc { position: static; max-height: none; }
        .mn-body { padding: 18px 16px 28px; border-radius: 14px; }
        .mn-toc > ol { display: block; }
        .mn-toc-part > ol { display: flex; flex-wrap: wrap; gap: 2px; border-left: 0; margin-left: 0; padding-left: 0; }
        .mn-pin { width: 16px; height: 16px; font-size: 10px; line-height: 16px; box-shadow: 0 0 0 2px rgba(11,13,18,.75); }
      }
    </style>
  </head>
  <body>
    <!-- spb-design:ambient --><div class="spb-ambient" aria-hidden="true"></div>
    <a class="skip-link" href="#main">${N.skip}</a>
    <header class="nav">
      <div class="nav-inner">
        <span class="spb-lockup"><a class="spb-mark" href="https://spb.biily.top/" title="${N.spb}">SPB<em>.</em></a><span class="spb-sep" aria-hidden="true">|</span><a class="nav-brand" href="index.html">
          <img src="${P}assets/icon.png" alt="" width="26" height="26" />
          <span>Eas-Term</span>
        </a></span>
        <nav class="nav-links" aria-label="${N.mainNav}">
          <a href="index.html#scenes">${N.scenes}</a>
          <a href="index.html#features">${N.features}</a>
          <a href="manual.html" aria-current="page">${N.manual}</a>
          <a href="${N.other}" lang="${N.otherLang}" hreflang="${N.otherLang}">${N.otherLabel}</a>
          <a class="nav-cta" href="download.html">${N.download}</a>
        </nav>
      </div>
    </header>
    <main id="main">
      <section class="page-head">
        <div class="wrap">
          <p class="eyebrow">${esc(c.meta.eyebrow)}</p>
          <h1 class="section-title">${esc(c.meta.heading)}</h1>
          <p class="lede">${esc(c.meta.lede)}</p>
        </div>
      </section>
      <div class="wrap mn-layout">
        <nav class="mn-toc" aria-label="${esc(c.meta.toc)}"><p>${esc(c.meta.toc)}</p><ol>${toc}</ol></nav>
        <div class="mn-body">
${body}
        </div>
      </div>
    </main>
    <footer class="footer">
      <div class="wrap footer-inner">
        <div class="footer-brand">
          <img src="${P}assets/icon.png" alt="" width="22" height="22" />
          <span>Eas-Term</span>
        </div>
        <nav class="footer-links" aria-label="${N.footNav}">
          <a href="index.html#features">${N.features}</a>
          <a href="manual.html">${N.manual}</a>
          <a href="download.html">${N.download}</a>
          <a href="changelog.html">${N.changelog}</a>
          <a href="privacy.html">${N.privacy}</a>
        </nav>
        <p class="footer-copy">© 2026 Eas-Term</p>
      </div>
    </footer>
    <script>
      // 目录高亮当前章节
      (() => {
        const links = new Map([...document.querySelectorAll('.mn-toc a')].map((a) => [a.getAttribute('href').slice(1), a]))
        const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { links.forEach((a) => a.classList.remove('on')); links.get(e.target.id)?.classList.add('on') } }, { rootMargin: '-20% 0px -70% 0px' })
        document.querySelectorAll('.mn-sec, .mn-part').forEach((s) => io.observe(s))
      })()
    </script>
    <script src="/analytics.js" defer></script>
    <!-- spb-design:script --><script src="${P}vendor/spb-design/ambient-grid.js" defer></script>
  </body>
</html>
`
}

fs.writeFileSync(path.join(root, 'site/manual.html'), page('zh', zh))
fs.mkdirSync(path.join(root, 'site/en'), { recursive: true })
fs.writeFileSync(path.join(root, 'site/en/manual.html'), page('en', en))
console.log(`✓ 已生成 site/manual.html 与 site/en/manual.html（${zh.parts.length} 个部分，${zh.sections.length} 章，${figIds(zh).length} 张图）`)
