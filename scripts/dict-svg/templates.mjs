// 词条示意图的「形」。130 条不可能一条条手画 —— 归成几个族，
// 每族一个模板函数，词条只提供参数（manifest.mjs）。
//
// 加新词条前先问：**它属于哪个族？** 都不属于才写新模板。
// 族多了等于没归类，改一处修不了一片。
import { C, LOOP, anim, appear, between, click, cubicPts, cursor, kt, line, r, rect, ripple, stage, svg, textW, tick, txt } from './kit.mjs'

// 左栏 8~40 归行名，时间轴从 44 起 —— 行名原本在轴线上方，跟事件标签抢同一条带，
// 首个事件的标签必然压住行名（「界面先移除」盖住「点删除」）。行名挪到轴线上之后，
// 上方整条带都归事件标签，这类碰撞就结构性地没有了。
const XL0 = 44, XR = 232

/** 标签贴边时自动改锚点。居中锚点在最左会压住行名、在最右会跑出画布 ——
 *  逐条挪坐标治不了本，每加一批都要再挪一次。 */
function anchorAt(x, anchor = 'middle', XL = XL0) {
  if (anchor !== 'middle') return { x: Math.min(x, XR - 2), anchor }
  if (x < XL + 26) return { x: XL - 4, anchor: 'start' }
  if (x > XR - 26) return { x: XR, anchor: 'end' }
  return { x, anchor }
}
const ROW = [{ line: 34, top: 24 }, { line: 94, top: 84 }]   // 两行的几何

// ─────────────────────────────────────────────────────────────────────────
// 族 A · 时间轴：上行是「发生了什么」，下行是「系统做了什么」。
// 防抖 vs 节流的全部区别就在下行的疏密 —— 这个族存在的理由。
//
// span 是这张图**横轴代表多少毫秒**，由词条自己定；
// 定了之后几何位置和播放时刻共用同一把尺子（纪律 ②）。
// ─────────────────────────────────────────────────────────────────────────
export function timeline({ rows, span, t0 = 0, playStart = 160, brace, caption, hold, marks, scale = 1 }) {
  // 左栏按最长的行名算，不写死 —— 写死 36px 的那一版，
  // `transform` 和 `left / width` 这类长行名直接被第一根条压在下面。
  const XL = Math.max(XL0, 8 + Math.max(...rows.map((rw) => textW(rw.label))) + 7)
  const pxms = (XR - XL) / span
  const X = (ms) => XL + (ms - t0) * pxms      // 真实时刻 → 横坐标
  const T = (ms) => playStart + (ms - t0) * scale   // 真实时刻 → 播放时刻
  // 横轴与播放时刻共用 t0 这一个原点 —— 分开写过一次，
  // 结果几何位置和播放时刻各走各的，图上条的位置对不上它出现的时机。
  let b = ''
  rows.forEach((row, i) => {
    const g = ROW[i]
    b += txt(8, g.line + 3, row.label, { size: 8.5 })
    b += line(XL - 6, g.line, XR, g.line)
    for (const s2 of row.bars ?? []) {
      const col = s2.color ?? row.color
      b += `<rect x="${r(X(s2.from))}" y="${g.top + (s2.y ?? 5)}" height="${s2.h ?? 10}" rx="2" fill="${s2.hollow ? 'none' : col}"${s2.hollow ? ` stroke="${col}" stroke-dasharray="2 2"` : ''} width="0">` +
        anim('width', [[0, 0], [T(s2.from), 0], [T(s2.to), r(X(s2.to) - X(s2.from))]]) + '</rect>'
      if (s2.label) {
        const a = anchorAt((X(s2.from) + X(s2.to)) / 2, 'middle', XL)
        b += `<g>${appear(T(s2.to))}${txt(a.x, g.top - 2 + (s2.labelY ?? 0), s2.label, { size: 7, anchor: a.anchor, fill: col })}</g>`
      }
    }
    for (const e of row.at ?? []) {
      const ms = typeof e === 'number' ? e : e.t
      const col = (typeof e === 'object' && e.color) || row.color
      b += tick(X(ms), g.top, T(ms), col, e.h ?? 20)
      if (row.ripple !== false && i === 1) b += ripple(X(ms) + 1.5, g.line, T(ms), col, row.r ?? 11)
      if (typeof e === 'object' && e.label) {
        const a = anchorAt(X(ms) + 1.5, 'middle', XL)
        b += `<g>${appear(T(ms))}${txt(a.x, g.top - 3, e.label, { size: 7, anchor: a.anchor, fill: col })}</g>`
      }
      if (typeof e === 'object' && e.x) b += `<g>${appear(T(ms))}${txt(X(ms) + 1.5, g.line + 4, '✕', { size: 8, anchor: 'middle', fill: col })}</g>`
    }
  })
  // 间隔标注：一条带端点的量取线，**位置就是真实间隔**，不是示意
  if (brace) {
    const x1 = X(brace.from) + 3.5, x2 = X(brace.to)
    b += `<g>${appear(T(brace.from) + 60, 100)}` +
      `<path d="M${r(x1)} 44 L${r(x1)} 52 M${r(x1)} 48 L${r(x2)} 48 M${r(x2)} 44 L${r(x2)} 52" stroke="${C.faint}" stroke-width="1" fill="none" stroke-dasharray="2 2"/>` +
      // 量取线的说明贴右时会冲出画布（「这段最容易被骂」被切掉半句），所以要么右移要么翻到左边
      (x2 + 6 + textW(brace.label, 8) > XR
        ? txt(x1 - 4, 51, brace.label, { anchor: 'end' })
        : txt(x2 + 4, 51, brace.label)) + '</g>'
  }
  for (const m of marks ?? []) {
    const a = anchorAt(X(m.t), m.anchor, XL)
    b += `<g>${appear(T(m.t))}${txt(a.x, m.y ?? 66, m.label, { size: 7, fill: m.color ?? C.faint, anchor: a.anchor })}</g>`
  }
  return svg(stage(b, hold) + (caption ? txt(8, 114, caption) : '') + scaleBadge(scale))
}

/** 时标缩放**必须写在图上**。帧预算 16.7ms、撤销提示 5s 都塞不进 4s 循环做 1:1，
 *  缩放是合理的 —— 但偷偷缩放就等于纪律 ② 白写了。所以缩放因子由模板强制标注，
 *  调用方想瞒也瞒不掉。 */
function scaleBadge(scale) {
  if (scale === 1) return ''
  // scale>1 = 播放比真实**长** = 放慢。写反过一次，帧预算那张标成「快 20×」。
  const f = scale > 1 ? `慢 ${r(scale)}×` : `快 ${r(1 / scale)}×`
  return `<g><rect x="196" y="4" width="38" height="13" rx="6.5" fill="none" stroke="${C.faint}"/>` +
    txt(215, 13, f, { size: 7, anchor: 'middle', fill: C.faint }) + '</g>'
}

// ─────────────────────────────────────────────────────────────────────────
// 族 B · 赛跑：同一段距离、同样时长，速率不同。
// 缓动、弹簧、惯性这类词条的语义**就是速率本身**，静态图只能画曲线，
// 画不出「感觉」—— 两个点并排跑才看得出差别。
// ─────────────────────────────────────────────────────────────────────────
export function race({ tracks, dur = 1600, start = 200, caption, hold, labelW = 62 }) {
  // 三栏：标签 | 轨道 | 注释。第一版把标签和轨道叠在一起、注释顶着画布右缘，
  // 结果长标签压进虚线、注释被切成半句（「过冲再收」其实是「过冲再收敛」）。
  const x1 = 8 + labelW, x2 = 228
  const n = tracks.length
  const y0 = n >= 3 ? 34 : 42, gap = n >= 3 ? 26 : 32
  let b = ''
  tracks.forEach((tk, i) => {
    const y = y0 + i * gap
    b += line(x1, y, x2, y, { dash: '2 3' })
    b += txt(8, y + 3, tk.label, { size: 7.5, fill: tk.color ?? C.faint })
    if (tk.note) b += txt(x2, y - 7, tk.note, { size: 7, anchor: 'end', fill: tk.color ?? C.faint })
    // pts 是 [进度0~1] 序列时按 dur 均分；给了 splines 就是单段缓动
    const d = tk.dur ?? dur, s0 = tk.start ?? start
    const pts = tk.pts
      ? tk.pts.map(([p, v]) => [s0 + p * d, r(x1 + v * (x2 - x1))])
      : [[s0, r(x1)], [s0 + d, r(x2)]]
    b += `<circle cy="${y}" r="${tk.r ?? 4.5}" fill="${tk.color ?? C.out}">` +
      anim('cx', pts, tk.splines ? { splines: tk.splines } : {}) + '</circle>'
  })
  return svg(stage(b, hold) + (caption ? txt(8, 114, caption) : ''))
}

// 常用缓动的采样点。**照 CSS 定义采的，不是手感调的** —— 曲线画错了词条就是错的。
export const EASE = {
  linear: null,
  ease: '.25 .1 .25 1',
  easeIn: '.42 0 1 1',
  easeOut: '0 0 .58 1',
  easeInOut: '.42 0 .58 1',
  expoOut: '.16 1 .3 1'
  // backOut(.34 1.56 .64 1) **不能放这里** —— y=1.56 越界，SMIL 的 keySplines 会拒收
  // 而且是静默失效。要过冲用 cubicPts(.34, 1.56, .64, 1) 采样成点列。
}

/** 弹簧：按阻尼正弦采样，过冲再收敛。damp 越大衰减越快。 */
export function springPts(n = 26, damp = 3.2, freq = 2.4) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return [t, +(1 - Math.exp(-damp * t) * Math.cos(freq * Math.PI * t)).toFixed(3)]
  })
}
/** 指数衰减：给个初速度一路减速滑到停，**没有目标终点**（decay 的定义）。 */
export function decayPts(n = 22, k = 3.4) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return [t, +((1 - Math.exp(-k * t)) / (1 - Math.exp(-k))).toFixed(3)]
  })
}
/** 步进：n 级台阶，不做中间插值。 */
export function stepPts(n = 5) {
  const out = []
  for (let i = 0; i <= n; i++) { out.push([i / n, i / n]); if (i < n) out.push([(i + 1) / n - 0.001, i / n]) }
  return out
}

export { C, LOOP, anim, appear, between, click, cubicPts, cursor, kt, line, r, rect, ripple, stage, svg, textW, tick, txt }
