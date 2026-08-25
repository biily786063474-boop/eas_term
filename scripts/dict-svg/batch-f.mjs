// 批次 F · 循环特效。
// **这一族不套 stage() 的淡出** —— 微光、脉冲、转圈的语义就是「它一直在动」，
// 演完淡出反而把话说反了。
import { C } from './templates.mjs'
import { anim, appear, between, clipped, frame, line, loopfx, r, scene, slab, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint, SL = C.slab

/** 斜向高光渐变 —— 微光和骨架屏共用。id 必须每张图唯一，否则同页多张会互相串。 */
const sheen = (id, color = '#ffffff', op = .16) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0" stop-color="${color}" stop-opacity="0"/>` +
  `<stop offset="0.5" stop-color="${color}" stop-opacity="${op}"/>` +
  `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
  `<animateTransform attributeName="gradientTransform" type="translate" values="-1;1" dur="1800ms" repeatCount="indefinite"/>` +
  '</linearGradient></defs>'

export const FX = {

'shimmer-effect': loopfx({
  body: sheen('shm') +
    [0, 1, 2].map((i) => slab(24, 24 + i * 24, 192 - i * 40, 16, { fill: SL })).join('') +
    [0, 1, 2].map((i) => slab(24, 24 + i * 24, 192 - i * 40, 16, { fill: 'url(#shm)' })).join(''),
  caption: '一条斜高光循环扫过 · 靠 background-position 或 transform 推'
}),

'pulse-animation': loopfx({
  body: [0, 1, 2].map((i) => {
    const cx = 62 + i * 58, d = i * 260
    return `<circle cx="${cx}" cy="48" r="14" fill="${OUT}">` +
      anim('r', [[d, 14], [d + 700, 19], [d + 1400, 14], [d + 2100, 19], [d + 2800, 14], [d + 3500, 19], [4000, 16]], { splines: '.42 0 .58 1' }) +
      anim('opacity', [[d, .9], [d + 700, .45], [d + 1400, .9], [d + 2100, .45], [d + 2800, .9], [d + 3500, .45], [4000, .7]]) +
      '</circle>'
  }).join('') +
    txt(8, 92, 'scale 与 opacity 往复 · alternate 就不用写反向帧', { size: 7.5, fill: F }),
  caption: '一呼一吸地缩放淡出 · infinite + alternate'
}),

'loading-spinner': loopfx({
  body: `<circle cx="44" cy="46" r="15" fill="none" stroke="${SL}" stroke-width="3.5"/>` +
    `<circle cx="44" cy="46" r="15" fill="none" stroke="${OUT}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="26 68" transform-origin="44 46">` +
    anim('transform', [[0, '0'], [4000, '1440']], { transform: 'rotate' }) + '</circle>' +
    txt(44, 76, '留一段透明再转', { size: 7, anchor: 'middle', fill: F }) +
    [0, 1, 2].map((i) => `<circle cx="${112 + i * 14}" cy="46" r="4" fill="${OUT}">` +
      anim('cy', [[i * 160, 46], [i * 160 + 400, 38], [i * 160 + 800, 46], [i * 160 + 1200, 46], [4000, 46]], { splines: '.42 0 .58 1' }) + '</circle>').join('') +
    txt(126, 76, '三点跳', { size: 7, anchor: 'middle', fill: F }) +
    `<rect x="176" y="42" width="48" height="8" rx="4" fill="${SL}"/>` +
    clipped('sp', 176, 42, 48, 8, `<rect y="42" width="18" height="8" rx="4" fill="${OUT}">` +
      anim('x', [[0, 158], [2000, 224], [4000, 158]], { splines: '.42 0 .58 1' }) + '</rect>') +
    txt(200, 76, '不定量进度条', { size: 7, anchor: 'middle', fill: F }),
  caption: '不知道要多久就用不定量的 · 别拿假进度骗人'
}),

'progress-animation': loopfx({
  body: txt(24, 26, '确定进度', { size: 7.5, fill: F }) +
    `<rect x="24" y="32" width="120" height="8" rx="4" fill="${SL}"/>` +
    `<rect x="24" y="32" height="8" rx="4" fill="${OUT}" width="0">` +
    anim('width', [[200, 0], [900, 34], [1500, 52], [2400, 96], [3200, 120], [4000, 120]], { splines: '.4 0 .2 1' }) + '</rect>' +
    ['12%', '43%', '80%', '100%'].map((s, i) =>
      `<g>${between([300, 1000, 2000, 3200][i], [1000, 2000, 3200, 4000][i], 60)}${txt(152, 39, s, { size: 8, fill: OUT })}</g>`).join('') +
    txt(24, 62, '不确定进度', { size: 7.5, fill: F }) +
    `<rect x="24" y="68" width="120" height="8" rx="4" fill="${SL}"/>` +
    clipped('pg', 24, 68, 120, 8, `<rect y="68" width="40" height="8" rx="4" fill="${F}">` +
      anim('x', [[0, -16], [2000, 144], [4000, -16]], { splines: '.42 0 .58 1' }) + '</rect>') +
    txt(152, 75, '不报数', { size: 8, fill: F }) +
    txt(8, 100, '确定进度用 scaleX 或 width 平滑过渡到百分比', { size: 7, fill: F }),
  caption: '知道百分比就报数 · 不知道就别装作知道'
}),

'svg-path-drawing': loopfx({
  body: `<path d="M28 74 C58 20 92 92 122 46 C146 12 178 66 212 32" fill="none" stroke="${SL}" stroke-width="3"/>` +
    `<path d="M28 74 C58 20 92 92 122 46 C146 12 178 66 212 32" fill="none" stroke="${OUT}" stroke-width="3" stroke-linecap="round" stroke-dasharray="300">` +
    anim('stroke-dashoffset', [[200, 300], [2400, 0], [3200, 0], [3900, 300]], { splines: '.4 0 .2 1' }) + '</path>' +
    txt(8, 100, 'dasharray = 路径总长 · 再把 dashoffset 从总长动到 0', { size: 7, fill: F }),
  caption: '虚线的「空」正好盖住整条路径 · 推开就成了描边'
}),

'gooey-effect': loopfx({
  // filter 里的 feGaussianBlur / feColorMatrix 能过 sanitizeSvg（它只剥
  // script/foreignObject/iframe/object/embed/link/style/image/use）—— 已实测。
  body: `<defs><filter id="goo"><feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/>` +
    `<feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="g"/>` +
    `<feBlend in="SourceGraphic" in2="g"/></filter></defs>` +
    `<g filter="url(#goo)"><circle cy="48" r="15" fill="${OUT}" cx="70"/>` +
    `<circle cy="48" r="13" fill="${OUT}">${anim('cx', [[0, 70], [1400, 150], [2000, 150], [3400, 70], [4000, 70]], { splines: '.42 0 .58 1' })}</circle>` +
    `<circle cy="48" r="10" fill="${OUT}">${anim('cx', [[0, 70], [1700, 186], [2300, 186], [3700, 70], [4000, 70]], { splines: '.42 0 .58 1' })}</circle></g>` +
    txt(8, 92, '先大幅模糊 · 再用 feColorMatrix 把 alpha 拉出硬边', { size: 7, fill: F }),
  caption: '两个球靠近时会「粘」在一起再拉断'
}),

'confetti-effect': loopfx({
  // 粒子数受 8000 字符上限管着：第一版 22 片就 13905B，被 sanitizeSvg 静默截断。
  // 真实实现是 canvas 上几百个粒子，SVG 里只能取「看得出是撒花」的最小数量。
  body: Array.from({ length: 13 }, (_, i) => {
    const a = (i * 137.5) % 360, rad = a * Math.PI / 180
    const vx = Math.cos(rad) * (48 + (i % 4) * 18), vy = -Math.abs(Math.sin(rad)) * (36 + (i % 3) * 14)
    const col = ['#e0a45e', '#6ea8fe', '#5ec27f', '#e0685e', '#c4a9f0'][i % 5]
    const t0 = 200 + (i % 3) * 100
    const at = [[t0, '120,62'], [t0 + 900, `${r(120 + vx * .7)},${r(62 + vy)}`], [t0 + 2500, `${r(120 + vx)},${r(118 - vy * .4)}`]]
    return `<g>${anim('opacity', [[0, 0], [t0, 1], [t0 + 1800, 1], [t0 + 2500, 0]])}` +
      anim('transform', at, { transform: 'translate', splines: '.2 .6 .5 1' }) +
      `<rect x="-2" y="-3.5" width="4" height="7" rx="1" fill="${col}"/></g>`
  }).join('') +
    txt(8, 100, 'canvas 上几百个粒子 · 每帧按重力和空气阻力更新', { size: 7, fill: F }),
  caption: '给每片随机的颜色角度初速 · 之后交给物理'
}),

'motion-blur': loopfx({
  body: `<defs><filter id="mb" x="-50%" width="200%"><feGaussianBlur stdDeviation="0 0" result="r">` +
    anim('stdDeviation', [[0, '0 0'], [700, '7 0'], [1500, '0 0'], [2200, '7 0'], [3000, '0 0'], [4000, '0 0']]) +
    '</feGaussianBlur></filter></defs>' +
    `<circle cy="36" r="11" fill="${F}">${anim('cx', [[300, 34], [1500, 206], [2000, 206], [3200, 34], [4000, 34]], { splines: '.5 0 .5 1' })}</circle>` +
    txt(8, 22, '没有拖影 · 眼睛觉得在跳', { size: 7, fill: F }) +
    `<g filter="url(#mb)"><circle cy="76" r="11" fill="${OUT}">` +
    anim('cx', [[300, 34], [1500, 206], [2000, 206], [3200, 34], [4000, 34]], { splines: '.5 0 .5 1' }) + '</circle></g>' +
    txt(8, 100, '按速度方向糊开 · 也可以叠半透明残影', { size: 7, fill: OUT }),
  caption: '高速移动本该留下拖影 · Web 上靠模糊或残影近似'
}),

'lottie-animation': loopfx({
  body: slab(16, 24, 66, 48, { fill: '#12161f', stroke: F, rx: 4 }) +
    txt(49, 44, '{ }', { size: 13, anchor: 'middle', fill: OK }) +
    txt(49, 60, 'JSON', { size: 7, anchor: 'middle', fill: F }) +
    txt(49, 84, 'AE 导出', { size: 7, anchor: 'middle', fill: F }) +
    `<path d="M90 48 L112 48" stroke="${F}" stroke-width="1.4" marker-end=""/>` +
    `<path d="M108 44 L114 48 L108 52 Z" fill="${F}"/>` +
    frame(124, 24, 100, 48) +
    `<g transform="translate(174,48)">` +
    `<path d="M-16 8 L-6 -6 L4 4 L16 -10" fill="none" stroke="${OUT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="60">` +
    anim('stroke-dashoffset', [[300, 60], [1900, 0], [2900, 0], [3700, 60]], { splines: '.4 0 .2 1' }) + '</path></g>' +
    txt(174, 84, '前端矢量重放 · 任意缩放不糊', { size: 7, anchor: 'middle', fill: OUT }),
  caption: '设计师在 AE 里做 · 导成 JSON 交给前端按矢量重放'
}),

'state-transition': scene(
  ['default', 'hover', 'focus', 'active', 'disabled'].map((s, i) => {
    const x = 12 + i * 45, on = [[0, 700], [700, 1400], [1400, 2100], [2100, 2800], [2800, 3500]][i]
    const col = ['#8a8f99', OUT, OK, IN, '#4a5060'][i]
    return slab(x, 34, 41, 26, { fill: SL, stroke: F, rx: 4 }) +
      `<g>${between(on[0], on[1], 120)}${slab(x, 34, 41, 26, { fill: col, op: .2, stroke: col, rx: 4 })}</g>` +
      txt(x + 20.5, 51, ['默认', '悬停', '聚焦', '按下', '禁用'][i], { size: 7, anchor: 'middle', fill: F }) +
      `<g>${between(on[0], on[1], 120)}${txt(x + 20.5, 51, ['默认', '悬停', '聚焦', '按下', '禁用'][i], { size: 7, anchor: 'middle', fill: col })}</g>` +
      txt(x + 20.5, 72, s, { size: 6, anchor: 'middle', fill: F })
  }).join('') +
  `<rect y="26" height="2.5" rx="1.25" fill="${OUT}" width="41">` +
  anim('x', [[0, 12], [700, 12], [900, 57], [1400, 57], [1600, 102], [2100, 102], [2300, 147], [2800, 147], [3000, 192]], { splines: '.16 1 .3 1' }) + '</rect>' +
  txt(8, 96, '每对状态之间都要有过渡 · 硬跳会显得界面在闪', { size: 7, fill: F }),
  '同一个组件在几个状态间切 · 用 transition 抹平')

}
