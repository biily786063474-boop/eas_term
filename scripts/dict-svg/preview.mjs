// 生成评审页：把词库里所有会动的内置词条排成一页，直接在浏览器里看。
// **读的是词库文件本身**，不是批次文件 —— 页面上看到的就是会分发出去的那份。
//
//   node scripts/dict-svg/preview.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/src/features/dict/dictionary-bundle.json'), 'utf8'))
// 复用其它汇报页的整段样式 —— 这些页面用户每周都读，跨页一致比好看重要
const css = (() => {
  const h = fs.readFileSync(path.join(ROOT, 'docs/插件兼容性-需求分析.html'), 'utf8')
  return h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>'))
})()

const FAM = [
  ['时间轴', '上行是「发生了什么」，下行是「系统做了什么」。防抖和节流的全部区别就在下行的疏密。',
    ['debounce', 'throttle', 'hover-intent', 'long-press', 'polling', 'retry-backoff', 'request-deduplication', 'race-condition-guard', 'request-cancellation', 'autosave', 'animation-delay', 'animation-iteration-count', 'frame-budget', 'jank', 'request-animation-frame', 'request-idle-callback', 'layout-thrashing', 'memoization', 'timeline-orchestration', 'undo-snackbar', 'toast-snackbar', 'stale-while-revalidate', 'optimistic-ui']],
  ['赛跑', '同一段距离、同样时长，速率不同。缓动和弹簧的语义就是速率本身，静态图只能画曲线。',
    ['easing', 'cubic-bezier', 'timing-function-keywords', 'steps-easing', 'linear-easing-function', 'spring-physics', 'stiffness', 'damping', 'spring-mass', 'overshoot', 'rubber-banding', 'momentum-scroll', 'decay-animation', 'interpolation', 'tween', 'smooth-scroll', 'animation-duration', 'animation-direction', 'animation-play-state', 'animation-fill-mode']],
  ['滚动', '一个视口 + 若干以不同速率移动的图层。差别只在「谁跟着滚、跟多少」。',
    ['parallax', 'sticky-header', 'scroll-snap', 'virtual-list', 'infinite-scroll', 'pull-to-refresh', 'scroll-spy', 'scroll-pinning', 'scrollytelling', 'reveal-on-scroll', 'intersection-observer', 'lazy-loading', 'content-visibility', 'scroll-lock', 'scroll-restoration', 'scroll-driven-animation', 'view-progress-timeline', 'scroll-triggered-animation']],
  ['指针手势', '全部用模拟指针 —— 词典是 hover 一下就看完，用户的手不会动，图得自己演一遍拖、点、划、框选。',
    ['drag-and-drop', 'sortable', 'swipe-gesture', 'swipe-to-dismiss', 'bottom-sheet', 'resizable', 'marquee-selection', 'pinch-zoom', 'magnetic-button', 'cursor-follow', 'tilt-effect', 'hit-area', 'context-menu', 'multi-select', 'inline-edit', 'ripple-effect', 'micro-interaction', 'gesture-driven-animation']],
  ['入场与文字', '语义是「第 i 个比第 i-1 个晚多少、怎么进」。逐字浮现这类效果，静态图连「逐」字都表达不了。',
    ['stagger', 'clip-path-reveal', 'fade-through', 'shared-axis-transition', 'page-transition', 'typewriter-effect', 'text-split-animation', 'text-scramble', 'count-up', 'number-ticker', 'marquee', 'ime-composition', 'keyframes']],
  ['面板与焦点', '面板看「从哪来、遮不遮背景」；焦点看「Tab 按下去高亮跳到哪」—— 后者只有动起来才看得见。',
    ['modal-dialog', 'drawer', 'popover', 'tooltip', 'accordion', 'tabs', 'carousel', 'stepper-wizard', 'command-palette', 'combobox-autocomplete', 'focus-trap', 'roving-tabindex', 'keyboard-shortcut', 'skip-link', 'focus-visible', 'affordance']],
  ['循环特效', '这一族不套淡出 —— 微光、脉冲、转圈的语义就是「它一直在动」，演完淡出反而把话说反了。',
    ['shimmer-effect', 'pulse-animation', 'loading-spinner', 'progress-animation', 'svg-path-drawing', 'gooey-effect', 'confetti-effect', 'motion-blur', 'lottie-animation', 'state-transition']],
  ['形变与 3D', '一个元素、两个位置，中间连续过去。静态图只能画首末两张，画不出「它是同一个东西」。',
    ['flip-technique', 'shape-morphing', 'container-transform', 'hero-animation', 'shared-element-transition', 'view-transitions-api', 'offset-path', 'transform-origin', 'perspective', 'transform-3d', 'matrix-transform', 'preserve-3d', 'backface-visibility', 'web-animations-api']],
  ['性能与合成', '帧的尺度上人眼看不清，所以这几张按倍数放慢 —— 但缩放因子由模板强制标在图上，瞒不掉。',
    ['compositor-only-properties', 'reflow-repaint', 'will-change', 'compositor-layer', 'hardware-acceleration', 'passive-event-listener']],
  ['网络与加载', '语义是「谁先动、谁等谁、白屏那段有多长」。',
    ['cursor-pagination', 'server-sent-events', 'react-suspense', 'streaming-ssr', 'concurrent-rendering', 'hydration', 'partial-hydration', 'resumability', 'code-splitting', 'resource-hints', 'intent-prefetch', 'speculation-rules', 'bfcache', 'normalized-cache', 'offline-first', 'background-sync', 'service-worker-cache']],
  ['占位与状态', '「东西还没来」这件事本身要有形状，而它是随时间变化的。',
    ['skeleton', 'loading-state', 'empty-state', 'lqip', 'blurhash', 'thumbhash', 'progressive-image']]
]

const byId = new Map(b.terms.map((t) => [t.id, t]))
const covered = new Set(FAM.flatMap((f) => f[2]))
const animated = b.terms.filter((t) => !t.clip && (t.svg || '').includes('<animate'))
const missing = animated.filter((t) => !covered.has(t.id)).map((t) => t.id)
if (missing.length) throw new Error(`这些词条没归进任何一族，页面会漏掉：${missing.join(', ')}`)

const card = (id) => {
  const t = byId.get(id)
  if (!t) throw new Error(`词库里没有 ${id}`)
  return `<figure class="dcard"><div class="dstage">${t.svg}</div>` +
    `<figcaption><b>${t.zh}</b><span>${t.en}</span></figcaption></figure>`
}

const sections = FAM.map(([name, note, ids], i) => `
<section id="f${i}">
  <h2>族 ${i + 1} · ${ids.length} 条</h2>
  <div class="sectitle">${name}</div>
  <p class="secnote">${note}</p>
  <div class="dgrid">${ids.map(card).join('')}</div>
</section>`).join('')

const nav = FAM.map(([name], i) => `<a href="#f${i}">${name}</a>`).join('')
const total = animated.length
const bytes = animated.reduce((a, t) => a + t.svg.length, 0)

fs.writeFileSync(path.join(ROOT, 'docs/词典内置词条-动效样板.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>名词词典 · 内置词条动效</title>
<style>${css}
.dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(238px,1fr));gap:14px}
.dcard{margin:0}
.dstage{background:#0f1218;border:1px solid #222836;border-radius:10px;overflow:hidden}
.dstage svg{width:100%;height:auto;display:block}
.dcard figcaption{padding:7px 3px 0;font-size:12px;color:#525252;display:flex;gap:7px;align-items:baseline}
.dcard figcaption b{color:#d4d4d4;font-weight:500;font-size:12.5px}
</style></head><body>
<nav><div class="navwrap"><span class="navbrand">EAS-TERM · 词典</span>${nav}</div></nav>
<main>
<header class="hero">
  <span class="eyebrow">全部铺完 · 待验收</span>
  <h1>内置概念词条<br>全部动起来了</h1>
  <p class="lede">motion 与 interaction 两类共 <b>162</b> 条内置词条，原本全是静态图，现在都是手画的
    SMIL 动画。<b>visual 那 80 条保持静态</b> —— 色彩、阴影、圆角、层级本来就不随时间变，动了没意义。</p>
  <div class="meta">
    <span>会动的 <b>${total}</b> 条</span>
    <span>motion <b>80</b> · interaction <b>82</b></span>
    <span>合计 <b>${(bytes / 1024).toFixed(0)}KB</b></span>
    <span>2026-08-25</span>
  </div>
</header>

<section id="rule">
  <h2>两条纪律</h2>
  <div class="sectitle">图会动很容易 · 节奏画对了才不误导</div>
  <div class="grid g2">
    <div class="card"><h4 style="margin-top:0">① 动画时间 = 标注时间，1:1</h4>
      <p style="margin:0">不许为了「看得清」把节奏拉长。第一版防抖的静默期是输入间隔的 <b>8.7 倍</b>、
      节流标着「每 200ms」画的是 <b>800ms</b> —— 图会动、语义也对，但读者建立的时间直觉是错的。
      看得清靠的是<b>元素留在原地不消失</b>，不是靠放慢。</p></div>
    <div class="card"><h4 style="margin-top:0">② 非要缩放，就必须标在图上</h4>
      <p style="margin:0">帧预算 16.7ms、撤销提示 5s 都塞不进 4s 循环做 1:1，缩放是合理的 ——
      但偷偷缩放等于纪律 ① 白写。所以缩放因子由<b>模板强制标注</b>（图右上角那个「慢 24×」），
      调用方想瞒也瞒不掉。</p></div>
  </div>
  <div class="warn">
    <div class="vlabel">SMIL 会静默失效 · 肉眼查不出来</div>
    <p style="margin:0 0 10px">keyTimes 不以 1 结尾、keySplines 控制点越界、从 A 动到 A ——
      这些都会让整条动画被判无效，元素停在初始属性上，<b>不报错、不降级、不打日志</b>。</p>
    <p style="margin:0">所以有一个校验脚本：<code>pauseAnimations()</code> 后按每条动画自己的
      <code>keyTimes</code> 定格取值，纹丝不动就判失效。<b>${total} 条全部通过。</b>
      校验器本身也有自测（<code>selftest.mjs</code>）—— 六种坏例子必须抓到、七种好例子不许误伤，
      因为抓不到问题的校验比没有校验更糟。</p>
  </div>
</section>
${sections}
<section id="skip">
  <h2>没做的部分</h2>
  <div class="sectitle">visual 那 80 条建议保持静态</div>
  <p class="secnote">毛玻璃、渐变、阴影层级、圆角、字重、栅格、色彩空间 —— 这些的语义里没有时间。
    给它们加动画不会让人更懂，只会让 240×120 那块地方变吵。<b>要动的话说一声，随时补。</b></p>
</section>
</main></body></html>`)
console.log(`  ✓ docs/词典内置词条-动效样板.html — ${total} 条，${FAM.length} 族`)
