// 批次 D · 入场序列 / 文字 / 动画参数。
// 前两族的语义是「第 i 个比第 i-1 个晚多少、怎么进」；
// 动画参数那几条（时长/方向/播放状态/填充模式）本质还是赛跑 —— 差别只在速度曲线的形状。
import { C, EASE, race, timeline } from './templates.mjs'
import { anim, appear, between, clipped, cursor, frame, line, loopfx, morph, panel, r, scene, sequence, slab, textfx, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint, SL = C.slab

export const D = {

'stagger': sequence({
  n: 5, x: 24, y: 22, w: 150, h: 12, gapY: 15, start: 400, step: 130, dur: 460, mode: 'slide', note: true,
  caption: '每一项比上一项晚一点点 · 排出波浪式的节奏'
}),

'clip-path-reveal': sequence({
  n: 4, x: 24, y: 26, w: 180, h: 14, gapY: 18, start: 400, step: 160, dur: 620, mode: 'clip',
  extras: txt(8, 100, 'inset / circle / polygon 从不可见裁到全显', { size: 7, fill: F }),
  caption: '元素一直都在 · 只是遮罩把它一点点让出来'
}),

'fade-through': scene(
  `<g>${anim('opacity', [[0, 1], [700, 1], [1300, 0]])}` +
  `<g transform="translate(120,48)"><g>${anim('transform', [[0, '1'], [700, '1'], [1300, '.92']], { transform: 'scale', splines: '.4 0 1 1' })}` +
  slab(-90, -32, 180, 64, { fill: SL, stroke: F, rx: 5 }) + txt(0, 4, '旧内容', { size: 9, anchor: 'middle', fill: F }) + '</g></g></g>' +
  `<g>${anim('opacity', [[0, 0], [1500, 0], [2200, 1]])}` +
  `<g transform="translate(120,48)"><g>${anim('transform', [[0, '.92'], [1500, '.92'], [2200, '1']], { transform: 'scale', splines: '.16 1 .3 1' })}` +
  slab(-90, -32, 180, 64, { fill: '#2c3a55', stroke: OUT, rx: 5 }) + txt(0, 4, '新内容', { size: 9, anchor: 'middle', fill: OUT }) + '</g></g></g>' +
  line(120, 88, 120, 96, { stroke: F, dash: '2 2' }) + txt(120, 106, '中间有一段谁都不在', { size: 7, anchor: 'middle', fill: F }),
  ''),

'shared-axis-transition': scene(
  frame(20, 16, 200, 60) +
  clipped('sa', 21, 17, 198, 58,
    `<g>${anim('opacity', [[0, 1], [900, 1], [1500, 0]])}` +
    `<g>${anim('transform', [[0, '0,0'], [900, '0,0'], [1600, '-46,0']], { transform: 'translate', splines: '.4 0 .2 1' })}` +
    slab(30, 26, 180, 40, { fill: SL, stroke: F, rx: 4 }) + txt(120, 50, '第 1 步', { size: 9, anchor: 'middle', fill: F }) + '</g></g>' +
    `<g>${anim('opacity', [[0, 0], [1100, 0], [1800, 1]])}` +
    `<g>${anim('transform', [[0, '46,0'], [1100, '46,0'], [1800, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
    slab(30, 26, 180, 40, { fill: '#2c3a55', stroke: OUT, rx: 4 }) + txt(120, 50, '第 2 步', { size: 9, anchor: 'middle', fill: OUT }) + '</g></g>') +
  txt(8, 92, '进的和出的沿同一条轴、同一个方向小幅平移', { size: 7.5, fill: F }) +
  txt(8, 104, '所以你知道自己是在「往前走」还是「往回退」', { size: 7.5, fill: OUT }),
  ''),

'page-transition': scene(
  frame(14, 14, 100, 62) + frame(126, 14, 100, 62) +
  clipped('pt1', 15, 15, 98, 60,
    `<g>${anim('opacity', [[0, 1], [800, 1], [1500, 0]])}<g>${anim('transform', [[0, '0,0'], [800, '0,0'], [1500, '-24,0']], { transform: 'translate', splines: '.4 0 1 1' })}` +
    [0, 1, 2].map((i) => slab(24, 24 + i * 16, 80 - i * 14, 8, { fill: SL })).join('') + '</g></g>') +
  clipped('pt2', 127, 15, 98, 60,
    `<g>${anim('opacity', [[0, 0], [1300, 0], [2100, 1]])}<g>${anim('transform', [[0, '24,0'], [1300, '24,0'], [2100, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
    [0, 1, 2].map((i) => slab(136, 24 + i * 16, 80 - i * 14, 8, { fill: '#2c3a55' })).join('') + '</g></g>') +
  txt(64, 90, '旧页 exit', { size: 7.5, anchor: 'middle', fill: F }) +
  txt(176, 90, '新页 enter', { size: 7.5, anchor: 'middle', fill: OUT }) +
  txt(8, 106, '两段动画有意重叠一点 · 中间不留白屏', { size: 7, fill: F }),
  ''),

'typewriter-effect': textfx({
  chars: '一个字一个字吐出来', x: 22, y: 50, size: 13, start: 400, step: 220, mode: 'type',
  sub: '尾随一个闪烁的光标',
  caption: '定时器逐字符递增 substring · 光标一直在闪'
}),

'text-split-animation': textfx({
  chars: '逐字浮现上移', x: 30, y: 50, size: 16, start: 400, step: 150, mode: 'rise',
  sub: 'SplitText 把标题拆成一个个 span',
  caption: '拆成独立元素后 · 每个字各自带 delay 进场'
}),

'text-scramble': scene(
  '逐字锁定'.split('').map((ch, i) => {
    const lock = 900 + i * 420
    const junk = ['#', '%', '&', '@', 'X', '$', '?', '§']
    let g = ''
    for (let k = 0; k < 5; k++) {
      const t = 300 + i * 60 + k * 120
      g += `<g>${between(t, t + 120, 10)}${txt(34 + i * 26, 54, junk[(i * 3 + k) % junk.length], { size: 18, fill: F })}</g>`
    }
    return g + `<g>${appear(lock, 60)}${txt(34 + i * 26, 54, ch, { size: 18, fill: OUT })}</g>`
  }).join('') +
  txt(8, 84, '每个字符先高频刷随机符号', { size: 7.5, fill: F }) +
  txt(8, 96, '再按预设的解锁帧逐位定住', { size: 7.5, fill: OUT }),
  '像解码一样一位一位归位'),

'count-up': scene(
  txt(120, 60, '0', { size: 30, anchor: 'middle', fill: OUT, weight: 600 }).replace('>0<', '>0<') +
  [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
    const v = [0, 380, 1120, 2050, 3010, 3720, 4180, 4400, 4482][i]
    const t = 500 + i * 260
    return `<g>${between(t, t + 260, 8)}${txt(120, 60, String(v), { size: 30, anchor: 'middle', fill: OUT, weight: 600 })}</g>`
  }).join('') +
  `<g>${appear(2900)}${txt(120, 60, '4,482', { size: 30, anchor: 'middle', fill: OUT, weight: 600 })}</g>` +
  txt(8, 88, 'rAF 在设定时长内按 easing 从起始值走到目标值', { size: 7, fill: F }),
  '数字自己涨上去 · 收尾会慢下来（不是匀速）'),

'number-ticker': scene(
  frame(78, 24, 84, 44) +
  clipped('nt', 79, 25, 82, 42,
    [0, 1, 2].map((col) => {
      const x = 90 + col * 26
      const to = [-30, -90, -60][col]
      return `<g>${anim('transform', [[0, '0,0'], [600, '0,0'], [1800 + col * 200, `0,${to}`]], { transform: 'translate', splines: '.16 1 .3 1' })}` +
        Array.from({ length: 6 }, (_, d) => txt(x, 54 + d * 30, String((d + col) % 10), { size: 22, anchor: 'middle', fill: OUT })).join('') + '</g>'
    }).join('')) +
  txt(8, 88, '每一位是一条 0-9 的纵向长条 · 只是 translateY', { size: 7, fill: F }),
  '像里程表一样一位一位滚过去'),

'marquee': loopfx({
  body: frame(14, 34, 212, 34) +
    clipped('mq', 15, 35, 210, 32,
      [0, 1].map((k) => `<g>${anim('transform', [[0, `${k * 210},0`], [4000, `${k * 210 - 210},0`]], { transform: 'translate' })}` +
        txt(24, 56, '内容复制两份 · 首尾相接 · 匀速无限', { size: 10, fill: OUT }) + '</g>').join('')),
  caption: '两份内容首尾相接 · linear 无限循环，接缝看不出来'
}),

'ime-composition': scene(
  slab(24, 26, 192, 30, { fill: '#161b26', stroke: OUT, rx: 3 }) +
  `<g>${anim('opacity', [[0, 0], [400, 0], [500, 1], [2100, 1], [2200, 0]])}` +
  txt(32, 46, 'pinyin', { size: 13, fill: F }) +
  `<line x1="32" y1="50" x2="72" y2="50" stroke="${F}" stroke-dasharray="2 2"/></g>` +
  `<g>${appear(2300)}${txt(32, 46, '拼音', { size: 13, fill: '#e8ecf4' })}</g>` +
  `<g>${between(500, 2200)}${txt(24, 76, 'compositionstart → 拼字中，取值会拿到拼音串', { size: 7.5, fill: BAD })}</g>` +
  `<g>${appear(2300)}${txt(24, 76, 'compositionend → 这时候读才是真的上屏内容', { size: 7.5, fill: OK })}</g>`,
  '拼字过程中一直在触发 input · 别在这时候取值'),

'keyframes': scene(
  ['0%', '50%', '100%'].map((s, i) => {
    const x = 40 + i * 76
    return line(x, 24, x, 40, { stroke: F, dash: '2 2' }) + txt(x, 20, s, { size: 7, anchor: 'middle', fill: F }) +
      slab(x - 9, 44, 18, 18, { fill: 'none', stroke: F, rx: 3 })
  }).join('') +
  `<g>${anim('transform', [[400, '0,0'], [1600, '76,0'], [2800, '152,0']], { transform: 'translate' })}` +
  `<g transform="translate(40,53)"><g>${anim('transform', [[400, '1'], [1600, '1.5'], [2800, '1']], { transform: 'scale' })}` +
  slab(-9, -9, 18, 18, { fill: OUT, rx: 3 }) + '</g></g></g>' +
  line(40, 74, 192, 74, { stroke: C.axis }) +
  `<circle cy="74" r="3" fill="${OUT}">${anim('cx', [[400, 40], [2800, 192]])}</circle>` +
  txt(8, 96, '只定义几个时间点的样式快照 · 中间由浏览器插值', { size: 7.5, fill: F }),
  '给 0% / 50% / 100% 定样子 · 其余的它自己补'),

'animation-duration': race({
  tracks: [{ label: '150ms', color: OUT, dur: 150, start: 600, note: '微交互' },
           { label: '1200ms', color: F, dur: 1200, start: 600, note: '同样距离 · 拖沓' }],
  caption: 'UI 微交互通常 150~300ms · 长了显拖沓，短了显生硬'
}),

'animation-direction': race({
  tracks: [{ label: 'normal', color: F, pts: [[0, 0], [.5, 1], [.5, 0], [1, 1]], dur: 2600, note: '每遍都跳回起点' },
           { label: 'alternate', color: OUT, pts: [[0, 0], [.5, 1], [1, 0]], dur: 2600, note: '来回摆 · 不用写反向帧' }],
  start: 500,
  caption: 'alternate 让偶数遍倒放 · 钟摆、呼吸灯都靠它'
}),

'animation-play-state': race({
  tracks: [{ label: 'running', color: F, dur: 2600, start: 500, note: '一路到底' },
           { label: 'hover 时 paused', color: OUT, pts: [[0, 0], [.35, .35], [.65, .35], [1, 1]], dur: 2600, start: 500, note: '原地冻住 · 松开接着走' }],
  caption: '暂停是在当前帧冻住 · 不是重置进度'
}),

'animation-fill-mode': race({
  tracks: [{ label: 'none', color: F, pts: [[0, 0], [.55, 1], [.56, 0], [1, 0]], dur: 2600, start: 500, note: '播完瞬间弹回' },
           { label: 'forwards', color: OUT, pts: [[0, 0], [.55, 1], [1, 1]], dur: 2600, start: 500, note: '停在最后一帧' }],
  caption: '想让状态定格在终点 · 必须显式写 forwards'
})

}
