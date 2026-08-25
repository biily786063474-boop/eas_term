// 批次 E · 面板与焦点。
// 面板类的语义是**「从哪来、遮不遮背景、怎么关」**；
// 焦点类的语义是**「Tab 键按下去，高亮跳到哪」** —— 这个只有动起来才看得见。
import { C } from './templates.mjs'
import { anim, appear, between, click, clipped, cursor, frame, line, panel, r, scene, slab, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint, SL = C.slab
/** 一个键帽。焦点族要画 Tab / Esc / Cmd+K。 */
const key = (x, y, w, s, o = {}) =>
  slab(x, y, w, 15, { fill: o.fill ?? '#1b2230', stroke: o.stroke ?? F, rx: 3 }) +
  txt(x + w / 2, y + 10.5, s, { size: 7.5, anchor: 'middle', fill: o.color ?? F })
/** 焦点环：跳到哪一项就框住哪一项。 */
const ring = (x, y, w, h, t0, t1) =>
  `<g>${between(t0, t1, 90)}<rect x="${r(x - 2)}" y="${r(y - 2)}" width="${r(w + 4)}" height="${r(h + 4)}" rx="4" fill="none" stroke="${OUT}" stroke-width="1.6"/></g>`

export const E = {

'modal-dialog': panel({
  from: 'center', box: { x: 62, y: 30, w: 116, h: 44 }, scrim: true, label: '模态框',
  t0: 700, t1: 1200,
  extras: txt(8, 100, '<dialog> 的 showModal() 自带焦点陷阱、Esc 关闭、::backdrop', { size: 7, fill: F }),
  caption: '压住背景 · 焦点关在里面 · Esc 就能退'
}),

'drawer': panel({
  from: 'left', box: { x: 8, y: 10, w: 76, h: 76 }, scrim: true, label: '抽屉', t0: 700, t1: 1300,
  extras: txt(8, 100, '平时 translateX(-100%) 移出视口 · 不是 display:none', { size: 7, fill: F }),
  caption: '从侧边滑进来 · 关掉时原路滑回去'
}),

'popover': scene(
  slab(96, 74, 48, 18, { fill: SL, stroke: F, rx: 3 }) + txt(120, 86, '触发元素', { size: 7, anchor: 'middle', fill: F }) +
  `<g>${anim('opacity', [[0, 0], [800, 0], [1000, 1]])}` +
  `<g transform="translate(120,44)"><g>${anim('transform', [[0, '.94'], [800, '.94'], [1050, '1']], { transform: 'scale', splines: '.16 1 .3 1' })}` +
  slab(-52, -28, 104, 46, { fill: '#1b2230', stroke: OUT, rx: 4 }) +
  `<path d="M-5 18 L0 24 L5 18 Z" fill="#1b2230" stroke="${OUT}"/>` +
  [0, 1].map((i) => slab(-42, -18 + i * 14, 84 - i * 24, 6, { fill: F, op: .55 })).join('') + '</g></g></g>' +
  txt(8, 106, '定位靠 Floating UI 算 · 放不下会自动翻边、贴边', { size: 7, fill: F }),
  ''),

'tooltip': scene(
  slab(98, 62, 44, 20, { fill: SL, stroke: F, rx: 3 }) + txt(120, 76, '?', { size: 10, anchor: 'middle', fill: F }) +
  `<g>${anim('opacity', [[0, 0], [1100, 0], [1300, 1], [3200, 1], [3400, 0]])}` +
  slab(70, 34, 100, 20, { fill: '#1b2230', stroke: OUT, rx: 3 }) +
  txt(120, 48, '一句话说明', { size: 8, anchor: 'middle', fill: OUT }) +
  `<path d="M115 54 L120 60 L125 54 Z" fill="#1b2230" stroke="${OUT}"/></g>` +
  cursor([[900, 120, 72], [1100, 120, 72]], { linger: 1900 }) +
  txt(8, 100, 'aria-describedby 关联 role="tooltip" · 键盘聚焦也要出', { size: 7, fill: F }),
  '悬停或聚焦后延迟一小会儿才出 · 免得划过就闪'),

'accordion': scene(
  [0, 1, 2].map((i) => {
    const y0 = [16, 38, 60][i]
    return slab(30, y0, 180, 18, { fill: SL, stroke: F, rx: 3 }) +
      txt(38, y0 + 12, `第 ${i + 1} 节`, { size: 8, fill: i === 1 ? OUT : F }) +
      txt(200, y0 + 12, i === 1 ? '−' : '+', { size: 10, anchor: 'middle', fill: i === 1 ? OUT : F })
  }).join('') +
  `<g>${anim('transform', [[0, '0,0'], [900, '0,0'], [1500, '0,30']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
  slab(30, 60, 180, 18, { fill: SL, stroke: F, rx: 3 }) + txt(38, 72, '第 3 节', { size: 8, fill: F }) + '</g>' +
  `<rect x="30" y="58" width="180" rx="3" fill="#141a26" stroke="${OUT}" height="0">` +
  anim('height', [[0, 0], [900, 0], [1500, 30]], { splines: '.16 1 .3 1' }) + '</rect>' +
  `<g>${anim('opacity', [[0, 0], [1200, 0], [1600, 1]])}${[0, 1].map((i) => slab(38, 64 + i * 10, 150 - i * 40, 5, { fill: F, op: .5 })).join('')}</g>` +
  txt(8, 106, '高度动画常用 grid-template-rows:0fr→1fr 或量出实际高度', { size: 7, fill: F }),
  ''),

'tabs': scene(
  ['概览', '详情', '设置'].map((s, i) => {
    const x = 24 + i * 62
    return slab(x, 16, 58, 20, { fill: SL, rx: 3 }) + txt(x + 29, 30, s, { size: 8, anchor: 'middle', fill: F })
  }).join('') +
  `<rect y="34" height="2.5" rx="1.25" fill="${OUT}" width="58">${anim('x', [[0, 24], [900, 24], [1500, 86], [2400, 86], [3000, 148]], { splines: '.16 1 .3 1' })}</rect>` +
  ['概览', '详情', '设置'].map((s, i) => {
    const x = 24 + i * 62, on = [[0, 1200], [1200, 2700], [2700, 3600]][i]
    return `<g>${between(on[0], on[1], 120)}${txt(x + 29, 30, s, { size: 8, anchor: 'middle', fill: OUT })}</g>`
  }).join('') +
  frame(24, 44, 182, 44) +
  ['概览', '详情', '设置'].map((s, i) => {
    const on = [[0, 1200], [1200, 2700], [2700, 3600]][i]
    return `<g>${between(on[0], on[1], 160)}${[0, 1, 2].map((k) => slab(34, 54 + k * 11, 150 - k * 30 - i * 16, 6, { fill: '#2c3a55' })).join('')}</g>`
  }).join(''),
  '当前项 aria-selected=true · 只显对应的那个 tabpanel'),

'carousel': scene(
  frame(30, 20, 180, 56) +
  clipped('cr', 31, 21, 178, 54,
    `<g>${anim('transform', [[0, '0,0'], [900, '0,0'], [1500, '-178,0'], [2400, '-178,0'], [3000, '-356,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
    [0, 1, 2].map((i) => slab(36 + i * 178, 26, 168, 44, { fill: ['#2c3a55', '#31415e', '#3a4a68'][i], rx: 4 }) +
      txt(120 + i * 178, 52, `第 ${i + 1} 张`, { size: 10, anchor: 'middle', fill: '#c8d4ea' })).join('') + '</g>') +
  [0, 1, 2].map((i) => {
    const on = [[0, 1200], [1200, 2700], [2700, 3600]][i]
    return `<circle cx="${104 + i * 16}" cy="86" r="3" fill="${F}" opacity=".5"/>` +
      `<g>${between(on[0], on[1], 140)}<circle cx="${104 + i * 16}" cy="86" r="3.4" fill="${OUT}"/></g>`
  }).join(''),
  '横向排的幻灯 · translateX 位移或直接交给 scroll-snap'),

'stepper-wizard': scene(
  [0, 1, 2, 3].map((i) => {
    const x = 34 + i * 58
    const done = [[600, 4000], [1400, 4000], [2200, 4000], [3000, 4000]][i]
    return (i < 3 ? line(x + 11, 30, x + 47, 30, { stroke: C.axis, w: 2 }) : '') +
      (i < 3 ? `<g>${appear(done[0] + 700)}${line(x + 11, 30, x + 47, 30, { stroke: OUT, w: 2 })}</g>` : '') +
      `<circle cx="${x}" cy="30" r="9" fill="${SL}" stroke="${F}"/>` +
      `<g>${appear(done[0])}<circle cx="${x}" cy="30" r="9" fill="${OUT}"/>${txt(x, 33, String(i + 1), { size: 8, anchor: 'middle', fill: '#0d1017' })}</g>` +
      txt(x, 33, String(i + 1), { size: 8, anchor: 'middle', fill: F }) +
      txt(x, 50, ['填写', '确认', '支付', '完成'][i], { size: 7, anchor: 'middle', fill: F })
  }).join('') +
  txt(8, 76, '维护一个 currentStep · 控制显示哪一段', { size: 7.5, fill: F }) +
  txt(8, 90, '每步可回退 · 已填的要留着，别让人重打一遍', { size: 7.5, fill: OUT }),
  '把长流程切成几步 · 一次只让人面对一件事'),

'command-palette': scene(
  key(88, 14, 26, '⌘') + key(118, 14, 26, 'K') +
  `<g>${anim('opacity', [[0, 0], [900, 0], [1100, 1]])}` +
  `<g transform="translate(120,62)"><g>${anim('transform', [[0, '.94'], [900, '.94'], [1150, '1']], { transform: 'scale', splines: '.16 1 .3 1' })}` +
  slab(-92, -24, 184, 52, { fill: '#1b2230', stroke: OUT, rx: 5 }) +
  slab(-84, -18, 168, 13, { fill: '#12161f', rx: 2 }) + txt(-80, -8, 'set', { size: 7.5, fill: '#e8ecf4' }) + '</g></g></g>' +
  [0, 1, 2].map((i) => {
    const y = 54 + i * 12
    return `<g>${anim('opacity', [[0, 0], [1300 + i * 90, 0], [1500 + i * 90, 1]])}` +
      txt(40, y + 8, ['设置', '重置窗口', '偏好设置'][i], { size: 7.5, fill: i === 0 ? OUT : F }) +
      (i === 0 ? slab(36, y, 168, 11, { fill: OUT, op: .16, rx: 2 }) : '') + '</g>'
  }).join('') +
  txt(8, 106, '模糊匹配 + 高亮命中片段 · 方向键移动，回车执行', { size: 7, fill: F }),
  ''),

'combobox-autocomplete': scene(
  slab(36, 16, 168, 20, { fill: '#161b26', stroke: OUT, rx: 3 }) +
  txt(44, 30, '北', { size: 10, fill: '#e8ecf4' }) +
  `<rect x="52" y="21" width="1.4" height="11" fill="${OUT}">${anim('opacity', [[400, 1], [700, 0], [1000, 1], [1300, 0], [1600, 1]])}</rect>` +
  ['北京', '北海', '北angle'].map((s, i) => {
    const y = 42 + i * 16
    return `<g>${anim('opacity', [[0, 0], [900 + i * 110, 0], [1100 + i * 110, 1]])}` +
      slab(36, y, 168, 14, { fill: SL, rx: 2 }) + txt(44, y + 10, s.replace('angle', '角'), { size: 8, fill: F }) +
      txt(44, y + 10, '北', { size: 8, fill: OUT }) + '</g>'
  }).join('') +
  [0, 1, 2].map((i) => `<g>${between(1900 + i * 500, 2400 + i * 500, 90)}${slab(36, 42 + i * 16, 168, 14, { fill: OUT, op: .18, stroke: OUT, rx: 2 })}</g>`).join('') +
  txt(8, 108, 'role="listbox" + aria-activedescendant · 方向键移高亮', { size: 7, fill: F }),
  ''),

'focus-trap': scene(
  frame(52, 14, 136, 62, { stroke: OUT }) + txt(120, 26, '模态框', { size: 7.5, anchor: 'middle', fill: OUT }) +
  slab(20, 84, 40, 14, { fill: SL, stroke: F, rx: 3 }) + txt(40, 94, '外面', { size: 7, anchor: 'middle', fill: F }) +
  [0, 1, 2].map((i) => slab(66 + i * 42, 44, 34, 16, { fill: SL, stroke: F, rx: 3 })).join('') +
  [0, 1, 2].map((i) => ring(66 + i * 42, 44, 34, 16, 600 + i * 700, 1300 + i * 700)).join('') +
  ring(66, 44, 34, 16, 2700, 3400) +
  `<g>${anim('opacity', [[0, 0], [2500, 0], [2700, 1], [3400, 1], [3600, 0]])}` +
  `<path d="M186 52 C206 52 206 78 176 78 L74 78" fill="none" stroke="${OUT}" stroke-dasharray="3 2"/>` +
  txt(78, 90, 'Tab 到最后一个 → 绕回第一个', { size: 7, fill: OUT }) + '</g>' +
  key(196, 44, 26, 'Tab'),
  '打开模态时把 Tab 关在容器里 · 出不去'),

'roving-tabindex': scene(
  [0, 1, 2, 3].map((i) => slab(30 + i * 46, 30, 38, 22, { fill: SL, stroke: F, rx: 3 }) +
    txt(49 + i * 46, 45, `${i + 1}`, { size: 8, anchor: 'middle', fill: F })).join('') +
  [0, 1, 2, 3].map((i) => {
    const on = [[500, 1200], [1200, 1900], [1900, 2600], [2600, 3400]][i]
    return ring(30 + i * 46, 30, 38, 22, on[0], on[1]) +
      `<g>${between(on[0], on[1], 90)}${txt(49 + i * 46, 66, 'tabindex="0"', { size: 6.5, anchor: 'middle', fill: OUT })}</g>` +
      `<g>${anim('opacity', [[0, 1], [on[0], 1], [on[0] + 90, 0], [on[1], 0], [on[1] + 90, 1]])}${txt(49 + i * 46, 66, '−1', { size: 6.5, anchor: 'middle', fill: F })}</g>`
  }).join('') +
  key(30, 82, 44, '← →', { color: OUT, stroke: OUT }) +
  txt(82, 93, '方向键在组内移动 · Tab 一下就整组跳过去', { size: 7, fill: F }),
  '一组控件只留一个能 Tab 到 · 组内用方向键走'),

'keyboard-shortcut': scene(
  key(30, 22, 32, '⌘', { color: OUT, stroke: OUT }) + txt(66, 33, '+', { size: 9, fill: F }) +
  key(74, 22, 32, '⇧', { color: OUT, stroke: OUT }) + txt(110, 33, '+', { size: 9, fill: F }) +
  key(118, 22, 32, 'K', { color: OUT, stroke: OUT }) +
  [0, 1, 2].map((i) => `<g>${between(500 + i * 160, 2600, 60)}<rect x="${30 + i * 44}" y="22" width="32" height="15" rx="3" fill="${OUT}" opacity=".22"/></g>`).join('') +
  `<g>${anim('opacity', [[0, 0], [1000, 0], [1250, 1]])}` +
  `<g transform="translate(120,66)"><g>${anim('transform', [[0, '.92'], [1000, '.92'], [1300, '1']], { transform: 'scale', splines: '.16 1 .3 1' })}` +
  slab(-70, -14, 140, 28, { fill: '#1b2230', stroke: OUT, rx: 4 }) + txt(0, 4, '命令面板', { size: 8.5, anchor: 'middle', fill: OUT }) + '</g></g></g>' +
  txt(8, 106, '监听 keydown 判 metaKey/ctrlKey/shiftKey + e.key', { size: 7, fill: F }),
  '组合键要判修饰键 · 还得避开输入框里的按键'),

'skip-link': scene(
  `<g>${anim('opacity', [[0, 0], [700, 0], [850, 1], [2600, 1], [2750, 0]])}` +
  slab(20, 12, 92, 18, { fill: '#1b2230', stroke: OUT, rx: 3 }) +
  txt(66, 24, '跳到主内容', { size: 7.5, anchor: 'middle', fill: OUT }) + '</g>' +
  `<g>${anim('opacity', [[0, 1], [700, 1], [850, 0], [2750, 0], [2900, 1]])}` +
  txt(20, 24, '（平时 sr-only 视觉隐藏）', { size: 7, fill: F }) + '</g>' +
  [0, 1, 2, 3, 4].map((i) => slab(20 + i * 40, 38, 34, 10, { fill: SL })).join('') +
  txt(20, 62, '一大堆导航链接', { size: 7, fill: F }) +
  frame(20, 70, 192, 26) + txt(116, 86, '主内容', { size: 8.5, anchor: 'middle', fill: F }) +
  `<g>${between(2750, 3500, 120)}${frame(20, 70, 192, 26, { stroke: OUT })}${txt(116, 86, '主内容', { size: 8.5, anchor: 'middle', fill: OUT })}</g>` +
  key(186, 12, 26, 'Tab'),
  '页面第一个可聚焦元素 · Tab 一下就现身，让人跳过导航'),

'focus-visible': scene(
  slab(28, 34, 72, 26, { fill: SL, stroke: F, rx: 4 }) + txt(64, 51, '鼠标点', { size: 8, anchor: 'middle', fill: F }) +
  slab(140, 34, 72, 26, { fill: SL, stroke: F, rx: 4 }) + txt(176, 51, '键盘 Tab', { size: 8, anchor: 'middle', fill: F }) +
  cursor([[500, 64, 47], [900, 64, 47]], { linger: 500 }) + click(64, 47, 900, F) +
  `<g>${between(900, 1900, 100)}${txt(64, 76, '不显焦点环', { size: 7, anchor: 'middle', fill: F })}</g>` +
  key(140, 74, 30, 'Tab', { color: OUT, stroke: OUT }) +
  ring(140, 34, 72, 26, 2100, 3400) +
  `<g>${between(2100, 3400, 100)}${txt(176, 92, '显焦点环', { size: 7, anchor: 'middle', fill: OUT })}</g>` +
  txt(8, 108, ':focus-visible 让浏览器替你判「是不是键盘来的」', { size: 7, fill: F }),
  ''),

'affordance': scene(
  slab(26, 30, 62, 30, { fill: SL, rx: 4 }) + txt(57, 49, '平的', { size: 8, anchor: 'middle', fill: F }) +
  txt(57, 74, '看不出能点', { size: 7, anchor: 'middle', fill: F }) +
  `<g><rect x="98" y="30" width="62" height="30" rx="4" fill="#2c3a55" stroke="${OUT}"/>` +
  `<rect x="98" y="30" width="62" height="30" rx="4" fill="${OUT}" opacity="0">${anim('opacity', [[0, 0], [900, 0], [1300, .18], [2200, .18], [2600, 0]])}</rect>` +
  txt(129, 49, '凸起', { size: 8, anchor: 'middle', fill: OUT }) + '</g>' +
  txt(129, 74, '阴影 + 指针变手', { size: 7, anchor: 'middle', fill: OUT }) +
  `<g>${anim('transform', [[0, '0,0'], [900, '0,0'], [1300, '0,-2'], [2200, '0,-2'], [2600, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
  `<rect x="98" y="62" width="62" height="3" rx="1.5" fill="#000" opacity=".45"/></g>` +
  slab(178, 34, 40, 22, { fill: SL, stroke: F, dash: '3 2', rx: 3 }) +
  txt(198, 48, '⠿', { size: 10, anchor: 'middle', fill: F }) + txt(198, 74, '看得出能拖', { size: 7, anchor: 'middle', fill: F }) +
  cursor([[900, 129, 46], [2200, 129, 46]], { linger: 300 }),
  '用视觉线索暗示「这能点、这能拖」· 不用教')

}
