// 批次 B · 滚动族。
// 共同点：**语义都藏在「滚动时谁跟着动、动多少」**。静态图只能画一个视口，
// 画不出「背景比前景慢」「到边界就钉住」「吸附回整数位」这些区别。
import { C, anim, appear, between, clipped, cursor, frame, line, r, ripple, scene, scroller, sequence, slab, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint, SL = C.slab
const V = { x: 14, y: 12, w: 118, h: 80 }
const note = (y, s, c = F) => txt(150, y, s, { size: 7.5, fill: c })
const rows = (n, x, y0, w, h, gap, o = {}) => Array.from({ length: n }, (_, i) => slab(x, y0 + i * gap, w, h, o)).join('')

export const B = {

'parallax': scroller({
  view: V, wheel: false,
  layers: [
    { rate: 0.35, body: [22, 58, 94].map((x) => slab(x, 30, 26, 60, { fill: '#1a2030' })).join('') },
    { rate: 1, body: [18, 62, 100].map((x, i) => slab(x, 62 + i % 2 * 10, 30, 44, { fill: '#2c3a55' })).join('') }
  ],
  scroll: [[300, 0], [2800, 70]],
  extras: note(34, '背景 0.35×') + note(50, '前景 1×') + note(70, '近快远慢 → 纵深', OUT),
  caption: '同一次滚动 · 图层各按各的速率走'
}),

'sticky-header': scroller({
  view: V, wheel: false,
  layers: [{ body: slab(20, 20, 106, 14, { fill: '#2c3a55' }) + rows(6, 20, 40, 106, 12, 18) }],
  scroll: [[300, 0], [2800, 78]],
  extras: `<g>${anim('opacity', [[0, 0], [900, 0], [1100, 1]])}${slab(15, 13, 116, 14, { fill: '#2c3a55', stroke: OUT })}${txt(73, 22, '钉住', { size: 7, anchor: 'middle', fill: OUT })}</g>` +
    note(40, 'position:sticky') + note(56, '滚到 top:0 就不再走', OUT),
  caption: '跟着滚到边界为止 · 之后钉在那儿不动'
}),

'scroll-snap': scroller({
  view: V, wheel: false,
  layers: [{ splines: '.2 0 0 1', body: rows(5, 20, 18, 106, 26, 32, { fill: '#26314a' }) }],
  scroll: [[300, 0], [900, 26], [1200, 32], [1800, 58], [2100, 64], [2700, 90], [3000, 96]],
  extras: line(14, 26, 132, 26, { stroke: OUT, dash: '2 2' }) + note(34, '松手后自动') + note(48, '吸到整项边界', OUT),
  caption: '不停在半张卡上 · 每次都对齐到子项边界'
}),

'virtual-list': scene(
  frame(V.x, V.y, V.w, V.h) +
  clipped('vl', V.x + 1, V.y + 1, V.w - 2, V.h - 2,
    `<g>${anim('transform', [[300, '0,0'], [3000, '0,-96']], { transform: 'translate' })}` +
    Array.from({ length: 14 }, (_, i) => slab(20, 16 + i * 16, 106, 12, { fill: i >= 1 && i <= 6 ? '#2c3a55' : 'none', stroke: i >= 1 && i <= 6 ? '' : F, op: i >= 1 && i <= 6 ? 1 : .35 })).join('') + '</g>') +
  note(30, '10000 项') + note(46, '真的渲染 ≈ 7 个', OUT) + note(62, '其余只占高度', F),
  '长列表只渲染视口内那几项 · 其余用占位撑高'),

'infinite-scroll': scroller({
  view: V, wheel: false,
  layers: [{ body: rows(6, 20, 16, 106, 14, 20) + `<g>${anim('opacity', [[0, 0], [2400, 0], [2700, 1]])}${rows(3, 20, 136, 106, 14, 20, { fill: '#2c3a55' })}</g>` }],
  scroll: [[300, 0], [2400, 74], [3400, 110]],
  extras: `<g>${between(2200, 2700)}${txt(150, 60, '触底 → 拉下一页', { size: 7.5, fill: OK })}</g>` +
    note(30, '哨兵进视口') + note(44, '就自动请求', F),
  caption: '快到底时用哨兵元素触发 · 自动接上下一页'
}),

'pull-to-refresh': scene(
  frame(V.x, V.y, V.w, V.h) +
  clipped('pr', V.x + 1, V.y + 1, V.w - 2, V.h - 2,
    `<g>${anim('transform', [[300, '0,0'], [1300, '0,26'], [1700, '0,26'], [2100, '0,0']], { transform: 'translate', splines: '.3 0 .2 1' })}` +
    rows(5, 20, 16, 106, 14, 18) + '</g>' +
    `<g>${anim('opacity', [[0, 0], [700, 0], [1300, 1], [2100, 0]])}<circle cx="73" cy="24" r="6" fill="none" stroke="${OUT}" stroke-width="1.6" stroke-dasharray="26 12">` +
    anim('transform', [[1300, '0'], [2100, '360']], { transform: 'rotate' }) + '</circle></g>') +
  note(30, '按手指位移') + note(44, '阻尼递减跟随', F) + note(64, '过阈值松手 → 刷新', OUT),
  '下拉时位移按阻尼递减 · 过阈值松手才真刷新'),

'scroll-spy': scroller({
  view: { x: 14, y: 12, w: 92, h: 80 }, wheel: false,
  layers: [{ body: [0, 1, 2].map((i) => slab(20, 18 + i * 46, 80, 40, { fill: '#222b3f' }) + txt(24, 34 + i * 46, `第 ${i + 1} 节`, { size: 8, fill: F })).join('') }],
  scroll: [[300, 0], [3000, 92]],
  extras: [0, 1, 2].map((i) => {
    const y = 26 + i * 22, on = [[400, 1350], [1350, 2350], [2350, 3400]][i]
    return slab(120, y - 8, 60, 12, { fill: SL }) + txt(126, y, `第 ${i + 1} 节`, { size: 7, fill: F }) +
      `<g>${between(on[0], on[1], 160)}${slab(120, y - 8, 60, 12, { fill: OUT, op: .28 })}${slab(118, y - 8, 2, 12, { fill: OUT })}${txt(126, y, `第 ${i + 1} 节`, { size: 7, fill: OUT })}</g>`
  }).join(''),
  caption: '滚到哪一节 · 导航就高亮哪一项'
}),

'scroll-pinning': scroller({
  view: V, wheel: false,
  layers: [{ body: rows(3, 20, 16, 106, 14, 18) + slab(20, 76, 106, 40, { fill: '#2c3a55' }) + rows(3, 20, 128, 106, 14, 18) }],
  scroll: [[300, 0], [1100, 64], [2200, 64], [3000, 128]],
  extras: `<g>${between(1100, 2200)}${txt(150, 46, '钉住不动', { size: 7.5, fill: OUT })}${txt(150, 60, '内部继续演', { size: 7.5, fill: F })}</g>`,
  caption: '滚到位就钉住 · 页面继续滚但它留在原地'
}),

'scrollytelling': scroller({
  view: { x: 14, y: 12, w: 74, h: 80 }, wheel: false,
  layers: [{ body: [0, 1, 2, 3].map((i) => txt(22, 30 + i * 60, `step ${i + 1}`, { size: 8, fill: F }) + rows(2, 22, 38 + i * 60, 60, 8, 12)).join('') }],
  scroll: [[300, 0], [3200, 180]],
  extras: frame(100, 12, 132, 80, { fill: '#12161f' }) +
    [0, 1, 2, 3].map((i) => {
      const on = [[400, 1150], [1150, 1900], [1900, 2650], [2650, 3400]][i]
      return `<g>${between(on[0], on[1], 200)}<circle cx="166" cy="48" r="${16 + i * 6}" fill="none" stroke="${OUT}" stroke-width="1.4" opacity=".8"/>` +
        txt(166, 82, `第 ${i + 1} 幕`, { size: 7.5, anchor: 'middle', fill: OUT }) + '</g>'
    }).join(''),
  caption: '左边滚到第几步 · 右边就切到第几幕'
}),

'reveal-on-scroll': scroller({
  view: V, wheel: false,
  layers: [{ body: rows(3, 20, 16, 106, 14, 18) }],
  scroll: [[300, 0], [2600, 56]],
  extras: `<g>${anim('opacity', [[0, 0], [1500, 0], [2100, 1]], { splines: '.16 1 .3 1' })}` +
    `<g>${anim('transform', [[0, '0,12'], [1500, '0,12'], [2100, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
    rows(2, 20, 62, 106, 14, 20, { fill: '#2c3a55' }) + '</g></g>' +
    note(40, '初始 opacity:0') + note(54, '+ translateY(12)', F) + note(74, '进视口才放行', OUT),
  caption: '元素进视口那一刻才淡入上移 · 没进就不动'
}),

'intersection-observer': scroller({
  view: V, wheel: false,
  layers: [{ body: [0, 1, 2, 3].map((i) => slab(20, 16 + i * 34, 106, 26, { fill: '#222b3f' })).join('') }],
  scroll: [[300, 0], [3000, 78]],
  extras: line(14, 52, 132, 52, { stroke: OK, dash: '3 2' }) + txt(150, 40, '相交比例', { size: 7.5, fill: F }) +
    txt(150, 56, '0 → 0.5 → 1', { size: 7.5, fill: OK }) + txt(150, 76, '异步回调 · 不占主线程', { size: 7, fill: F }),
  caption: '异步告诉你元素露出了多少 · 不用监听 scroll'
}),

'lazy-loading': scroller({
  view: V, wheel: false,
  layers: [{ body: [0, 1, 2, 3].map((i) => {
    const y = 16 + i * 34
    const on = [400, 900, 1700, 2500][i]
    return slab(20, y, 106, 26, { fill: 'none', stroke: F, op: .4 }) +
      `<g>${anim('opacity', [[0, 0], [on, 0], [on + 400, 1]])}${slab(20, y, 106, 26, { fill: '#2c3a55' })}</g>`
  }).join('') }],
  scroll: [[300, 0], [3000, 78]],
  extras: note(38, '没进视口') + note(52, '就不发请求', F) + note(72, '快到了才开始拉', OUT),
  caption: '图片和 iframe 拖到快进视口时才真的去下载'
}),

'content-visibility': scene(
  frame(V.x, V.y, V.w, V.h) +
  clipped('cv', V.x + 1, V.y + 1, V.w - 2, V.h - 2,
    `<g>${anim('transform', [[300, '0,0'], [3000, '0,-70']], { transform: 'translate' })}` +
    Array.from({ length: 7 }, (_, i) => {
      const y = 16 + i * 26
      return slab(20, y, 106, 20, { fill: i < 3 ? '#2c3a55' : 'none', stroke: i < 3 ? '' : F, op: i < 3 ? 1 : .3 }) +
        (i >= 3 ? txt(73, y + 13, '跳过布局与绘制', { size: 6.5, anchor: 'middle', fill: F }) : '')
    }).join('') + '</g>'),
  '屏幕外的区块整块跳过布局和绘制 · 滚进来才算'),

'scroll-lock': scene(
  frame(V.x, V.y, V.w, V.h) +
  clipped('sl', V.x + 1, V.y + 1, V.w - 2, V.h - 2,
    `<g>${anim('transform', [[300, '0,0'], [1100, '0,-40'], [1400, '0,-40'], [3200, '0,-40']], { transform: 'translate' })}` +
    rows(8, 20, 16, 106, 14, 20) + '</g>' +
    `<g>${anim('opacity', [[0, 0], [1400, 0], [1700, 1]])}<rect x="15" y="13" width="116" height="78" fill="#000" opacity=".55"/>` +
    slab(28, 34, 80, 36, { fill: '#1b2230', stroke: OUT, rx: 4 }) + txt(68, 56, '弹层', { size: 8, anchor: 'middle', fill: OUT }) + '</g>') +
  note(40, '弹层一开') + note(54, '背景就不许滚', OUT) + note(74, '关掉再解锁', F),
  '弹层打开时锁住背景滚动 · 不然背后跟着一起动'),

'scroll-restoration': scene(
  frame(14, 12, 96, 80) + frame(126, 12, 96, 80) +
  clipped('sr1', 15, 13, 94, 78,
    `<g>${anim('transform', [[300, '0,0'], [1300, '0,-46'], [2000, '0,-46']], { transform: 'translate' })}${rows(7, 20, 16, 84, 14, 20)}</g>`) +
  `<g>${anim('opacity', [[0, 0], [2000, 0], [2300, 1]])}${clipped('sr2', 127, 13, 94, 78, `<g transform="translate(0,-46)">${rows(7, 132, 16, 84, 14, 20, { fill: '#2c3a55' })}</g>`)}</g>` +
  txt(62, 102, '列表页 · 滚到这', { size: 7, anchor: 'middle', fill: F }) +
  txt(174, 102, '返回后回到原处', { size: 7, anchor: 'middle', fill: OUT }),
  '前进后退回到上次的滚动位置 · 不是回到顶部'),

'scroll-driven-animation': scroller({
  view: V, wheel: false,
  layers: [{ body: rows(8, 20, 16, 106, 14, 20) }],
  scroll: [[300, 0], [3000, 90]],
  extras: txt(150, 30, '时间轴换成', { size: 7.5, fill: F }) + txt(150, 44, '滚动进度', { size: 7.5, fill: OUT }) +
    slab(150, 54, 70, 6, { fill: SL }) +
    `<rect x="150" y="54" height="6" rx="3" fill="${OUT}" width="0">${anim('width', [[300, 0], [3000, 70]])}</rect>` +
    txt(150, 78, '不滚就不走', { size: 7, fill: F }),
  caption: 'animation-timeline:scroll() · 进度由滚动决定'
}),

'view-progress-timeline': scroller({
  view: V, wheel: false,
  layers: [{ body: rows(2, 20, 16, 106, 14, 20) + slab(20, 60, 106, 34, { fill: '#2c3a55' }) + rows(3, 20, 104, 106, 14, 20) }],
  scroll: [[300, 0], [3000, 100]],
  extras: txt(150, 30, '这个元素', { size: 7.5, fill: F }) + txt(150, 44, '在视口里露了多少', { size: 7.5, fill: OUT }) +
    slab(150, 54, 70, 6, { fill: SL }) +
    `<rect x="150" y="54" height="6" rx="3" fill="${OUT}" width="0">${anim('width', [[900, 0], [1700, 70], [2400, 70], [3000, 0]])}</rect>` +
    txt(150, 78, '进 → 满 → 出', { size: 7, fill: F }),
  caption: 'animation-timeline:view() · 进度绑元素的可见度'
}),

'scroll-triggered-animation': scroller({
  view: V, wheel: false,
  layers: [{ body: rows(3, 20, 16, 106, 14, 20) }],
  scroll: [[300, 0], [2400, 54]],
  extras: `<g>${anim('opacity', [[0, 0], [1400, 0], [1800, 1]])}${slab(20, 60, 106, 30, { fill: '#2c3a55', stroke: OK })}${txt(73, 79, '.in-view', { size: 7.5, anchor: 'middle', fill: OK })}</g>` +
    note(34, 'IO 回调里') + note(48, '加一个 class', F) + note(68, '加完就不再管', OK),
  caption: '进视口时加个 class 触发一次 · 不跟滚动同步'
})

}
