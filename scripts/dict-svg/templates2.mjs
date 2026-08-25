// 第二组模板：滚动 / 入场序列 / 面板 / 文字 / 循环特效 / 形变。
// 族的划分见 templates.mjs 开头 —— 加词条前先找族，都不属于才写新模板。
import { C, LOOP, anim, appear, between, click, cubicPts, cursor, line, r, rect, ripple, stage, svg, txt } from './kit.mjs'

/** 自由构图的外壳：统一加淡出、说明文字、svg 外框。
 *
 *  **caption 只能是纯文本。** 把 SVG 标记当 caption 传进来会生成嵌套 <text> ——
 *  浏览器凑合渲染，图上看着还行，但那是非法标记，而且真正的 caption 被挤到了
 *  第三个参数（opt）里当 hold 用。scroll-lock 就这么错了一版，联络表上看不出来。
 *  宁可当场炸。 */
export const scene = (body, caption, opt = {}) => {
  if (caption && caption.includes('<')) throw new Error('caption 只收纯文本，SVG 标记请并进 body')
  return svg(stage(body, opt.hold) + (caption ? txt(8, 114, caption) : ''))
}

/** 有边框的舞台/视口。 */
export const frame = (x, y, w, h, o = {}) =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${o.rx ?? 4}" fill="${o.fill ?? '#0f1218'}" stroke="${o.stroke ?? C.axis}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`

/** 内容块（卡片、文本行、图片位）。 */
export const slab = (x, y, w, h, o = {}) =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${o.rx ?? 2}" fill="${o.fill ?? C.slab}"${o.stroke ? ` stroke="${o.stroke}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}>${o.inner ?? ''}</rect>`

/** 把一段内容裁在视口里。**滚动类必须裁** —— 不裁的话内容飘在视口外还看得见，
 *  「只渲染视口内」这种语义就整个垮掉了。 */
export function clipped(id, x, y, w, h, inner) {
  return `<defs><clipPath id="${id}"><rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="3"/></clipPath></defs>` +
    `<g clip-path="url(#${id})">${inner}</g>`
}

// ─────────────────────────────────────────────────────────────────────────
// 族 C · 滚动：一个视口 + 若干以不同速率移动的图层。
// 视差、粘性头部、滚动吸附、无限滚动…… 差别只在「谁跟着滚、跟多少」。
// ─────────────────────────────────────────────────────────────────────────
export function scroller({ view = { x: 14, y: 14, w: 104, h: 84 }, layers, scroll, caption, extras = '', wheel = true, id = 'v' }) {
  const inner = layers.map((L, i) => {
    const pts = scroll.map(([t, off]) => [t, `0,${r(-off * (L.rate ?? 1))}`])
    return `<g>${anim('transform', pts, { transform: 'translate', splines: L.splines ?? '.3 0 .2 1' })}${L.body}</g>`
  }).join('')
  return scene(
    frame(view.x, view.y, view.w, view.h) +
    clipped(id, view.x + 1, view.y + 1, view.w - 2, view.h - 2, inner) +
    (wheel ? wheelHint(view.x + view.w + 8, view.y + 8, scroll) : '') + extras,
    caption)
}

/** 滚轮指示：一个小滚轮 + 往下走的圆点，告诉读者「这是滚动，不是自己动的」。 */
function wheelHint(x, y, scroll) {
  const t0 = scroll[0][0], t1 = scroll.at(-1)[0]
  return `<g opacity=".75"><rect x="${r(x)}" y="${r(y)}" width="9" height="14" rx="4.5" fill="none" stroke="${C.faint}"/>` +
    `<circle cx="${r(x + 4.5)}" cy="${r(y + 4)}" r="1.4" fill="${C.faint}">` +
    anim('cy', [[t0, r(y + 4)], [t1, r(y + 10)]]) + '</circle></g>'
}

// ─────────────────────────────────────────────────────────────────────────
// 族 D · 入场序列：一组元素按某种节奏出现。
// 交错、逐字、遮罩揭示…… 差别在「第 i 个比第 i-1 个晚多少」和「怎么进」。
// ─────────────────────────────────────────────────────────────────────────
export function sequence({ n = 4, x = 20, y = 26, w = 200, h = 12, gapY = 16, start = 300, step = 140, dur = 420, mode = 'slide', caption, extras = '', color = C.out, note }) {
  let b = ''
  for (let i = 0; i < n; i++) {
    const ty = y + i * gapY, t = start + i * step
    const fadeIn = anim('opacity', [[0, 0], [t, 0], [t + dur, 1]], { splines: '.16 1 .3 1' })
    if (mode === 'slide') {
      b += `<g>${fadeIn}<g>${anim('transform', [[0, '0,10'], [t, '0,10'], [t + dur, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
        slab(x, ty, w, h, { fill: color, op: .85 }) + '</g></g>'
    } else if (mode === 'clip') {
      b += `<rect x="${r(x)}" y="${r(ty)}" height="${r(h)}" rx="2" fill="${color}" opacity=".85" width="0">` +
        anim('width', [[0, 0], [t, 0], [t + dur, r(w)]], { splines: '.16 1 .3 1' }) + '</rect>'
    } else if (mode === 'scale') {
      b += `<g>${fadeIn}<g transform="translate(${r(x + w / 2)},${r(ty + h / 2)})">` +
        `<g>${anim('transform', [[0, '.86'], [t, '.86'], [t + dur, '1']], { transform: 'scale', splines: '.16 1 .3 1' })}` +
        slab(-w / 2, -h / 2, w, h, { fill: color, op: .85 }) + '</g></g></g>'
    } else {
      b += `<g>${fadeIn}${slab(x, ty, w, h, { fill: color, op: .85 })}</g>`
    }
    if (note) b += `<g>${appear(t)}${txt(x + w + 4, ty + h - 2, `+${i * step}ms`, { size: 6.5, fill: C.faint })}</g>`
  }
  return scene(b + extras, caption)
}

// ─────────────────────────────────────────────────────────────────────────
// 族 E · 面板：从某条边进出的浮层。
// 模态、抽屉、气泡、手风琴…… 差别在从哪来、遮不遮背景、要不要焦点。
// ─────────────────────────────────────────────────────────────────────────
export function panel({ from = 'bottom', box, t0 = 500, t1 = 900, scrim = false, base, caption, extras = '', label, color = C.out }) {
  const off = { bottom: [0, 40], top: [0, -40], left: [-60, 0], right: [60, 0], center: [0, 0] }[from]
  let b = base ?? defaultBase()
  if (scrim) b += `<rect x="8" y="10" width="224" height="76" rx="4" fill="#000" opacity="0">` +
    anim('opacity', [[0, 0], [t0, 0], [t1, .55]]) + '</rect>'
  const scaleIn = from === 'center'
    ? `<g transform="translate(${r(box.x + box.w / 2)},${r(box.y + box.h / 2)})"><g>${anim('transform', [[0, '.9'], [t0, '.9'], [t1, '1']], { transform: 'scale', splines: '.16 1 .3 1' })}` +
      slab(-box.w / 2, -box.h / 2, box.w, box.h, { fill: '#1b2230', stroke: color, rx: 4 }) +
      (label ? txt(0, 3, label, { size: 8, anchor: 'middle', fill: color }) : '') + '</g></g>'
    : `<g>${anim('transform', [[0, `${off[0]},${off[1]}`], [t0, `${off[0]},${off[1]}`], [t1, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
      slab(box.x, box.y, box.w, box.h, { fill: '#1b2230', stroke: color, rx: 4 }) +
      (label ? txt(box.x + box.w / 2, box.y + box.h / 2 + 3, label, { size: 8, anchor: 'middle', fill: color }) : '') + '</g>'
  b += `<g>${anim('opacity', [[0, 0], [t0, 0], [t0 + 80, 1]])}${scaleIn}</g>`
  return scene(b + extras, caption)
}

const defaultBase = () => frame(8, 10, 224, 76) +
  [0, 1, 2].map((i) => slab(20, 22 + i * 18, 120 - i * 24, 8)).join('')

// ─────────────────────────────────────────────────────────────────────────
// 族 F · 文字：逐字/逐词出现、乱码归位、数字滚动。
// SVG 里没有「打字机」，靠的是**逐个字符 <text> 各自的出现时刻**。
// ─────────────────────────────────────────────────────────────────────────
export function textfx({ chars, x = 20, y = 52, size = 15, step = 130, start = 300, mode = 'type', caption, extras = '', color = '#e8ecf4', sub }) {
  const cw = size * 0.62
  let b = ''
  chars.split('').forEach((ch, i) => {
    const t = start + i * step, cx = x + i * cw
    if (mode === 'rise') {
      b += `<g>${anim('opacity', [[0, 0], [t, 0], [t + 320, 1]], { splines: '.16 1 .3 1' })}` +
        `<g>${anim('transform', [[0, '0,8'], [t, '0,8'], [t + 320, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
        txt(cx, y, ch, { size, fill: color }) + '</g></g>'
    } else {
      b += `<g>${appear(t, 30)}${txt(cx, y, ch, { size, fill: color })}</g>`
    }
  })
  if (mode === 'type') {
    const end = start + chars.length * step
    b += `<rect y="${r(y - size + 2)}" width="1.6" height="${r(size)}" fill="${C.out}">` +
      anim('x', chars.split('').map((_, i) => [start + i * step, r(x + i * cw + cw - 1)]).concat([[end, r(x + chars.length * cw - 1)]])) +
      anim('opacity', [[0, 1], [LOOP, 1]]) + '</rect>'
  }
  if (sub) b += txt(x, y + 18, sub, { size: 8, fill: C.faint })
  return scene(b + extras, caption)
}

// ─────────────────────────────────────────────────────────────────────────
// 族 G · 循环特效：自己一直在动，没有「触发」这回事。
// 微光、脉冲、跑马灯、转圈…… 用户看的就是那个循环本身。
// ─────────────────────────────────────────────────────────────────────────
export function loopfx({ body, caption, extras = '' }) {
  // **不套 stage()** —— 这一族的语义就是「一直在动」，演完淡出反而是错的。
  return svg(body + extras + (caption ? txt(8, 114, caption) : ''))
}

// ─────────────────────────────────────────────────────────────────────────
// 族 H · 形变：同一个元素从 A 的位置尺寸连续变到 B。
// FLIP、容器变换、英雄动画、共享元素…… 都是「一个东西，两个位置」。
// ─────────────────────────────────────────────────────────────────────────
export function morph({ a, b: bx, t0 = 600, t1 = 1500, back = true, label, caption, base = '', color = C.out, splines = '.16 1 .3 1' }) {
  const kf = (k) => back
    ? [[0, a[k]], [t0, a[k]], [t1, bx[k]], [t1 + 900, bx[k]], [t1 + 1600, a[k]]]
    : [[0, a[k]], [t0, a[k]], [t1, bx[k]]]
  const body = `<rect fill="${C.slab}" stroke="${color}" rx="3">` +
    ['x', 'y', 'w', 'h'].map((k) => anim({ w: 'width', h: 'height' }[k] ?? k, kf(k), { splines })).join('') + '</rect>'
  const lab = label ? `<g>${anim('opacity', [[0, 0], [t1, 0], [t1 + 300, 1], [t1 + 900, 1], [t1 + 1200, 0]])}` +
    txt(bx.x + bx.w / 2, bx.y + bx.h / 2 + 3, label, { size: 8, anchor: 'middle', fill: color }) + '</g>' : ''
  return scene(base + body + lab, caption)
}

export { C, LOOP, anim, appear, between, click, cubicPts, cursor, line, r, rect, ripple, stage, svg, txt }
