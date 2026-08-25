// 批次 G · 形变与 3D。
// 形变类的共同点是**「一个元素，两个位置/形状，中间连续过去」** ——
// 静态图只能画首末两张，画不出「它是同一个东西」这件事，而那正是这类转场的全部意义。
import { C } from './templates.mjs'
import { anim, appear, between, clipped, cursor, click, frame, line, morph, r, scene, slab, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint, SL = C.slab

export const G = {

'flip-technique': scene(
  txt(8, 20, 'First', { size: 7.5, fill: F }) + txt(66, 20, 'Last', { size: 7.5, fill: F }) +
  txt(124, 20, 'Invert', { size: 7.5, fill: IN }) + txt(184, 20, 'Play', { size: 7.5, fill: OUT }) +
  slab(14, 28, 34, 26, { fill: 'none', stroke: F, dash: '2 2' }) +
  slab(66, 28, 46, 36, { fill: 'none', stroke: F, dash: '2 2' }) +
  `<g>${anim('opacity', [[0, 0], [700, 0], [900, 1], [1600, 1], [1900, 0]])}${txt(146, 46, '−52,0', { size: 7, anchor: 'middle', fill: IN })}</g>` +
  `<rect fill="${SL}" stroke="${OUT}" rx="3">` +
  anim('x', [[0, 14], [500, 14], [600, 66], [900, 14], [1900, 66], [3000, 66]], { splines: '.16 1 .3 1' }) +
  anim('y', [[0, 28], [500, 28], [600, 28], [900, 28], [1900, 28], [3000, 28]]) +
  anim('width', [[0, 34], [500, 34], [600, 46], [900, 34], [1900, 46], [3000, 46]], { splines: '.16 1 .3 1' }) +
  anim('height', [[0, 26], [500, 26], [600, 36], [900, 26], [1900, 36], [3000, 36]], { splines: '.16 1 .3 1' }) + '</rect>' +
  txt(8, 82, '① 量变化前 ② 量变化后 ③ 用 transform 把它假装拉回原处', { size: 7, fill: F }) +
  txt(8, 94, '④ 再放开 —— 全程只动 transform，一次布局都不重排', { size: 7, fill: OUT }),
  ''),

'shape-morphing': scene(
  `<path fill="${OUT}" fill-opacity=".85" stroke="${OUT}">` +
  anim('d', [
    [400, 'M120 22 L168 50 L150 96 L90 96 L72 50 Z'],
    [1600, 'M120 26 L164 44 L164 84 L120 100 L76 84 L76 44 Z'],
    [2800, 'M120 20 L152 44 L166 82 L120 96 L74 82 L88 44 Z'],
    [3800, 'M120 22 L168 50 L150 96 L90 96 L72 50 Z']
  ], { splines: '.4 0 .2 1' }) + '</path>' +
  txt(8, 20, '两段 path 的顶点数必须一样多 · 否则插不出中间态', { size: 7, fill: F }),
  '在两条路径的顶点坐标之间插值 · 形状就连续变过去'),

'container-transform': scene(
  `<rect fill="${SL}" stroke="${OUT}" rx="4">` +
  ['x', 'y'].map((k) => anim(k, k === 'x'
    ? [[0, 26], [800, 26], [1700, 16], [2700, 16], [3500, 26]]
    : [[0, 54], [800, 54], [1700, 14], [2700, 14], [3500, 54]], { splines: '.16 1 .3 1' })).join('') +
  anim('width', [[0, 54], [800, 54], [1700, 208], [2700, 208], [3500, 54]], { splines: '.16 1 .3 1' }) +
  anim('height', [[0, 30], [800, 30], [1700, 74], [2700, 74], [3500, 30]], { splines: '.16 1 .3 1' }) + '</rect>' +
  `<g>${anim('opacity', [[0, 1], [800, 1], [1200, 0], [3100, 0], [3500, 1]])}${txt(53, 73, '卡片', { size: 8, anchor: 'middle', fill: OUT })}</g>` +
  `<g>${anim('opacity', [[0, 0], [1500, 0], [1900, 1], [2700, 1], [2900, 0]])}` +
  [0, 1, 2].map((i) => slab(28, 24 + i * 16, 180 - i * 50, 8, { fill: '#2c3a55' })).join('') + '</g>' +
  cursor([[500, 53, 66], [800, 53, 66]], { linger: 200 }) + click(53, 66, 800, OUT) +
  txt(8, 104, '容器自己长成下一层界面 · 中间不闪、不换主体', { size: 7, fill: F }),
  ''),

'hero-animation': scene(
  frame(12, 12, 100, 76) +
  [0, 1, 2, 3].map((i) => slab(20 + (i % 2) * 44, 20 + ((i / 2) | 0) * 34, 38, 28, { fill: i === 0 ? 'none' : SL, rx: 3 })).join('') +
  frame(128, 12, 100, 76) +
  `<g>${anim('opacity', [[0, 0], [1600, 0], [2000, 1], [3000, 1], [3300, 0]])}` +
  [0, 1].map((i) => slab(136, 62 + i * 12, 84 - i * 26, 6, { fill: '#2c3a55' })).join('') + '</g>' +
  `<rect fill="#31415e" stroke="${OUT}" rx="3">` +
  anim('x', [[0, 20], [700, 20], [1700, 136], [3000, 136], [3600, 20]], { splines: '.16 1 .3 1' }) +
  anim('y', [[0, 20], [700, 20], [1700, 18], [3000, 18], [3600, 20]], { splines: '.16 1 .3 1' }) +
  anim('width', [[0, 38], [700, 38], [1700, 84], [3000, 84], [3600, 38]], { splines: '.16 1 .3 1' }) +
  anim('height', [[0, 28], [700, 28], [1700, 38], [3000, 38], [3600, 28]], { splines: '.16 1 .3 1' }) + '</rect>' +
  txt(62, 100, '列表', { size: 7.5, anchor: 'middle', fill: F }) + txt(178, 100, '详情', { size: 7.5, anchor: 'middle', fill: OUT }) +
  cursor([[400, 39, 34], [700, 39, 34]], { linger: 200 }) + click(39, 34, 700, OUT),
  '同一张图连续放大成详情页的大图 · 视线不用重新找'),

'shared-element-transition': scene(
  frame(12, 14, 96, 62) + frame(132, 14, 96, 62) +
  slab(20, 22, 34, 24, { fill: SL, rx: 3 }) + slab(62, 22, 34, 24, { fill: SL, rx: 3 }) +
  slab(20, 52, 34, 16, { fill: SL, rx: 3 }) +
  `<rect fill="#31415e" stroke="${OUT}" rx="3">` +
  anim('x', [[0, 62], [800, 62], [1900, 140], [3000, 140], [3600, 62]], { splines: '.16 1 .3 1' }) +
  anim('y', [[0, 52], [800, 52], [1900, 22], [3000, 22], [3600, 52]], { splines: '.16 1 .3 1' }) +
  anim('width', [[0, 34], [800, 34], [1900, 80], [3000, 80], [3600, 34]], { splines: '.16 1 .3 1' }) +
  anim('height', [[0, 16], [800, 16], [1900, 46], [3000, 46], [3600, 16]], { splines: '.16 1 .3 1' }) + '</rect>' +
  txt(8, 90, '起点和终点两个视图里 · 给同一个元素同一个', { size: 7.5, fill: F }) +
  txt(8, 104, 'view-transition-name —— 浏览器就知道它俩是一个东西', { size: 7.5, fill: OUT }),
  ''),

'view-transitions-api': scene(
  txt(8, 18, 'startViewTransition(callback)', { size: 7.5, fill: OUT }) +
  ['① 截旧', '② 跑回调', '③ 截新', '④ 交叉淡'].map((s, i) => {
    const x = 14 + i * 56, on = [[500, 1300], [1300, 2100], [2100, 2900], [2900, 3700]][i]
    return slab(x, 30, 48, 34, { fill: SL, stroke: F, rx: 3 }) +
      `<g>${between(on[0], on[1], 130)}${slab(x, 30, 48, 34, { fill: OUT, op: .2, stroke: OUT, rx: 3 })}</g>` +
      txt(x + 24, 51, s, { size: 7, anchor: 'middle', fill: F }) +
      `<g>${between(on[0], on[1], 130)}${txt(x + 24, 51, s, { size: 7, anchor: 'middle', fill: OUT })}</g>` +
      (i < 3 ? txt(x + 52, 51, '›', { size: 9, fill: F }) : '')
  }).join('') +
  txt(8, 82, '回调里随便改 DOM —— 旧的那张已经截下来了', { size: 7.5, fill: F }) +
  txt(8, 96, '所以「改数据」和「做动画」这两件事彻底分开写', { size: 7.5, fill: OUT }),
  ''),

'offset-path': scene(
  `<path id="opp" d="M24 78 C58 14 100 96 132 44 C156 8 196 40 216 26" fill="none" stroke="${SL}" stroke-width="2.5" stroke-dasharray="3 3"/>` +
  `<g><rect x="-7" y="-5" width="14" height="10" rx="2" fill="${OUT}"/>` +
  `<animateMotion dur="4000ms" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#opp"/></animateMotion></g>` +
  txt(8, 100, 'offset-path 定轨道 · offset-distance 从 0% 走到 100%', { size: 7, fill: F }),
  '给一条曲线轨道 · 元素沿着它走，还会跟着转朝向'),

'transform-origin': scene(
  [['50% 50%', 62, '中心'], ['0 0', 178, '左上角']].map(([s, cx, zh], i) => {
    const ox = i ? 148 : 40, oy = i ? 30 : 34
    return `<g transform="translate(${i ? 148 : 40},${i ? 30 : 34})">` +
      slab(i ? 0 : -22, i ? 0 : -18, 44, 36, { fill: 'none', stroke: F, dash: '2 2', rx: 3 }) +
      `<g>${anim('transform', [[400, '0'], [2200, '300'], [3600, '360']], { transform: 'rotate', splines: '.4 0 .2 1' })}` +
      slab(i ? 0 : -22, i ? 0 : -18, 44, 36, { fill: '#2c3a55', stroke: OUT, rx: 3 }) + '</g>' +
      `<circle cx="${i ? 0 : 0}" cy="0" r="2.6" fill="${IN}"/></g>` +
      txt(i ? 170 : 40, 92, `${zh} ${s}`, { size: 7, anchor: 'middle', fill: i ? OUT : F })
  }).join('') +
  txt(8, 108, '旋转绕它转、缩放朝它缩 · 默认在元素中心', { size: 7, fill: F }),
  ''),

'perspective': scene(
  [['800px', 62, F], ['200px', 176, OUT]].map(([s, cx, col], i) =>
    `<g transform="translate(${cx},46)">` +
    `<g>${anim('transform', [[400, '1,1'], [1600, i ? '.42,1' : '.76,1'], [2800, '1,1'], [3600, '1,1']], { transform: 'scale', splines: '.42 0 .58 1' })}` +
    slab(-30, -26, 60, 52, { fill: '#2c3a55', stroke: col, rx: 3 }) + '</g>' +
    `<g>${anim('opacity', [[400, 0], [1600, i ? .9 : .5], [2800, 0], [3600, 0]])}` +
    `<path d="M${i ? 12 : 22} -26 L34 -34 L34 34 L${i ? 12 : 22} 26 Z" fill="${col}" fill-opacity=".3" stroke="${col}"/></g></g>` +
    txt(cx, 86, `perspective: ${s}`, { size: 7.5, anchor: 'middle', fill: col })).join('') +
  txt(8, 104, '值越小 = 观察者越近 = 近大远小越夸张', { size: 7, fill: F }),
  ''),

'transform-3d': scene(
  `<g transform="translate(72,48)"><g>` +
  anim('transform', [[400, '1,1'], [1400, '.25,1'], [2400, '1,1'], [3400, '.25,1'], [4000, '1,1']], { transform: 'scale', splines: '.42 0 .58 1' }) +
  slab(-26, -26, 52, 52, { fill: '#2c3a55', stroke: OUT, rx: 3 }) + '</g></g>' +
  txt(72, 88, 'rotateY', { size: 7.5, anchor: 'middle', fill: OUT }) +
  `<g transform="translate(176,48)"><g>` +
  anim('transform', [[400, '1'], [2000, '1.5'], [3600, '1']], { transform: 'scale', splines: '.42 0 .58 1' }) +
  slab(-26, -26, 52, 52, { fill: '#2c3a55', stroke: IN, rx: 3 }) + '</g></g>' +
  txt(176, 88, 'translateZ · 靠近观察者', { size: 7.5, anchor: 'middle', fill: IN }) +
  txt(8, 104, 'X/Y/Z 三轴上的位移与旋转 · 要配 perspective 才有纵深', { size: 7, fill: F }),
  ''),

'matrix-transform': scene(
  txt(8, 20, 'matrix(a, b, c, d, e, f)', { size: 8, fill: OUT }) +
  ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => {
    const x = 14 + i * 37
    return slab(x, 28, 32, 16, { fill: SL, stroke: F, rx: 2 }) + txt(x + 16, 39, k, { size: 7.5, anchor: 'middle', fill: F })
  }).join('') +
  `<g transform="translate(120,74)"><g>` +
  anim('transform', [[400, '1,1'], [1300, '1.4,.8'], [2200, '.8,1.3'], [3100, '1.15,1.15'], [3900, '1,1']], { transform: 'scale', splines: '.42 0 .58 1' }) +
  `<g>${anim('transform', [[400, '0'], [1300, '14'], [2200, '-12'], [3100, '6'], [3900, '0']], { transform: 'rotate', splines: '.42 0 .58 1' })}` +
  slab(-30, -20, 60, 40, { fill: '#2c3a55', stroke: OUT, rx: 3 }) + '</g></g></g>' +
  txt(8, 106, '平移旋转缩放斜切最后都归结成这六个数', { size: 7, fill: F }),
  ''),

'preserve-3d': scene(
  [['flat（默认）', 58, F], ['preserve-3d', 176, OUT]].map(([s, cx, col], i) =>
    `<g transform="translate(${cx},46)">` +
    `<g>${anim('transform', [[400, '1,1'], [1800, '.5,1'], [3200, '1,1']], { transform: 'scale', splines: '.42 0 .58 1' })}` +
    slab(-32, -28, 64, 56, { fill: 'none', stroke: col, rx: 3 }) +
    (i
      ? `<g>${anim('transform', [[400, '1,1'], [1800, '.5,1'], [3200, '1,1']], { transform: 'scale', splines: '.42 0 .58 1' })}${slab(-18, -16, 36, 32, { fill: '#2c3a55', stroke: col, rx: 2 })}</g>`
      : slab(-18, -16, 36, 32, { fill: SL, stroke: col, rx: 2 })) + '</g></g>' +
    txt(cx, 84, String(s), { size: 7.5, anchor: 'middle', fill: col })).join('') +
  txt(8, 102, '默认子元素被压平进父级平面 · preserve-3d 才各自留在 3D 里', { size: 7, fill: F }),
  ''),

'backface-visibility': scene(
  `<g transform="translate(120,46)"><g>` +
  anim('transform', [[500, '1,1'], [1600, '.02,1'], [2700, '-1,1'], [3400, '-1,1'], [3900, '1,1']], { transform: 'scale', splines: '.42 0 .58 1' }) +
  `<g>${anim('opacity', [[0, 1], [1500, 1], [1600, 0]])}${slab(-42, -28, 84, 56, { fill: '#2c3a55', stroke: OUT, rx: 4 })}${txt(0, 4, '正面', { size: 9, anchor: 'middle', fill: OUT })}</g>` +
  `<g>${anim('opacity', [[0, 0], [1600, 0], [1700, 1], [3400, 1], [3600, 0]])}${slab(-42, -28, 84, 56, { fill: SL, stroke: F, dash: '3 2', rx: 4 })}${txt(0, 4, '背面', { size: 9, anchor: 'middle', fill: F })}</g>` +
  '</g></g>' +
  txt(8, 92, 'hidden：转过 90° 后整个不可见（翻牌只想让人看正面）', { size: 7, fill: F }) +
  txt(8, 105, 'visible：会看到镜像的背面', { size: 7, fill: F }),
  ''),

'web-animations-api': scene(
  txt(8, 20, 'el.animate(keyframes, options)', { size: 8, fill: OUT }) +
  slab(20, 32, 200, 8, { fill: SL, rx: 4 }) +
  `<rect x="20" y="32" height="8" rx="4" fill="${OUT}" width="0">${anim('width', [[400, 0], [1800, 128], [2400, 128], [3400, 200]], { splines: '.4 0 .2 1' })}</rect>` +
  `<circle cy="36" r="5.5" fill="#e8ecf4" stroke="#11141a">${anim('cx', [[400, 20], [1800, 148], [2400, 148], [3400, 220]], { splines: '.4 0 .2 1' })}</circle>` +
  `<g>${between(1800, 2400, 120)}${txt(120, 58, 'anim.pause() · currentTime 可读可写', { size: 7.5, anchor: 'middle', fill: IN })}</g>` +
  ['play()', 'pause()', 'reverse()', 'playbackRate'].map((s, i) =>
    slab(14 + i * 55, 68, 50, 15, { fill: SL, stroke: F, rx: 3 }) + txt(39 + i * 55, 79, s, { size: 6.5, anchor: 'middle', fill: F })).join('') +
  txt(8, 104, '在 JS 里直接拿到动画对象 · 不用改 class 也不用碰 CSS', { size: 7, fill: F }),
  '')

}
