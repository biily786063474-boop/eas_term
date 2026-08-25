// 批次 C · 指针手势族。
// 共同点：**语义在「指针怎么动、元素怎么跟」**。
// 这一族全部用**模拟指针** —— 词典是 hover 一下就看完，用户的手不会动，
// 所以图里必须自己演一遍拖、点、划、框选。
import { C, anim, appear, between, click, clipped, cursor, frame, line, r, ripple, scene, slab, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint, SL = C.slab
const note = (y, s, c = F) => txt(150, y, s, { size: 7.5, fill: c })
/** 跟着指针走的元素：和 cursor() 用同一串关键帧，才不会「手到了东西没到」。 */
const follows = (kf, inner, splines = '.4 0 .2 1') =>
  `<g>${anim('transform', kf, { transform: 'translate', splines })}${inner}</g>`

export const C_ = {

'drag-and-drop': scene(
  frame(12, 16, 92, 62, { dash: '3 3' }) + txt(58, 30, '拖出', { size: 7, anchor: 'middle', fill: F }) +
  frame(136, 16, 92, 62, { dash: '3 3' }) + txt(182, 30, '放入', { size: 7, anchor: 'middle', fill: F }) +
  follows([[0, '0,0'], [700, '0,0'], [1900, '124,0'], [3200, '124,0']],
    slab(30, 40, 56, 26, { fill: '#2c3a55', stroke: OUT })) +
  `<g>${between(700, 1900)}${slab(30, 40, 56, 26, { fill: 'none', stroke: F, dash: '2 2' })}</g>` +
  `<g>${anim('opacity', [[0, 0], [1500, 0], [1750, 1], [1900, 0]])}${slab(154, 40, 56, 26, { fill: OK, op: .18 })}</g>` +
  cursor([[700, 58, 53], [1900, 182, 53]]) + click(58, 53, 700) + click(182, 53, 1900),
  '按住拖到目标区 · 释放时落在放置位'),

'sortable': scene(
  [0, 1, 2].map((i) => slab(60, 20 + i * 24, 120, 18, { fill: i === 0 ? '#2c3a55' : SL })).join('') +
  follows([[0, '0,0'], [700, '0,0'], [1900, '0,48'], [3200, '0,48']], slab(60, 20, 120, 18, { fill: '#2c3a55', stroke: OUT })) +
  follows([[0, '0,0'], [700, '0,0'], [1900, '0,-24'], [3200, '0,-24']], slab(60, 44, 120, 18, { fill: SL })) +
  follows([[0, '0,0'], [700, '0,0'], [1900, '0,-24'], [3200, '0,-24']], slab(60, 68, 120, 18, { fill: SL })) +
  cursor([[700, 120, 29], [1900, 120, 77]]) +
  txt(8, 100, '其它项用 transform 平移让出空位', { size: 7, fill: F }),
  '拖动时其它项让位 · 按指针位置实时算插入点'),

'swipe-gesture': scene(
  frame(60, 22, 120, 52) +
  clipped('sw', 61, 23, 118, 50,
    follows([[0, '0,0'], [800, '0,0'], [1700, '-118,0'], [3200, '-118,0']], slab(64, 26, 112, 44, { fill: '#2c3a55' })) +
    follows([[0, '0,0'], [800, '0,0'], [1700, '-118,0'], [3200, '-118,0']], slab(182, 26, 112, 44, { fill: '#3a4a68' }))) +
  cursor([[800, 160, 48], [1700, 80, 48]]) +
  txt(8, 90, '记起点 → 算 dx/dy → 过阈值且方向明确才算一次划', { size: 7, fill: F }),
  '位移超阈值、方向够明确 · 才判定成一次滑动'),

'swipe-to-dismiss': scene(
  // 卡片是「划出容器」而不是「划出画布」—— 不给容器框的话，
  // 它就贴着 SVG 边缘半截挂在那儿，看着像渲染坏了。
  frame(20, 12, 200, 78) +
  clipped('sd', 21, 13, 198, 76,
    slab(26, 18, 188, 20, { fill: SL }) +
    `<g>${anim('opacity', [[0, 1], [2000, 1], [2500, 0]])}` +
    follows([[0, '0,0'], [800, '0,0'], [1900, '110,0'], [2500, '210,0']], slab(26, 44, 188, 20, { fill: '#2c3a55', stroke: OUT })) + '</g>' +
    line(120, 42, 120, 66, { stroke: BAD, dash: '2 2' }) +
    `<g>${anim('transform', [[0, '0,0'], [2500, '0,0'], [3100, '0,-26']], { transform: 'translate', splines: '.16 1 .3 1' })}${slab(26, 70, 188, 20, { fill: SL })}</g>`) +
  `<g>${anim('opacity', [[0, 0], [1500, 0], [1800, 1], [2500, 1], [2800, 0]])}${txt(28, 102, '越过一半 → 松手即删', { size: 7.5, fill: BAD })}</g>` +
  `<g>${anim('opacity', [[0, 1], [1500, 1], [1800, 0]])}${txt(28, 102, '不到一半 → 松手弹回', { size: 7.5, fill: F })}</g>` +
  cursor([[800, 100, 54], [1900, 210, 54]], { linger: 200 }),
  '跟手平移 · 松手时按位移或速度决定删还是弹回'),

'bottom-sheet': scene(
  frame(70, 10, 100, 84) +
  clipped('bs', 71, 11, 98, 82,
    slab(78, 18, 84, 8, { fill: SL }) +
    `<g>${anim('transform', [[0, '0,64'], [700, '0,64'], [1500, '0,26'], [2200, '0,26'], [3000, '0,-2']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
    slab(72, 30, 96, 66, { fill: '#1b2230', stroke: OUT, rx: 5 }) +
    slab(108, 35, 24, 3, { fill: F, rx: 1.5 }) + '</g>') +
  [['收起', 88], ['半展', 62], ['全展', 30]].map(([s, y], i) =>
    line(174, y, 182, y, { stroke: F, dash: '2 2' }) + txt(185, y + 3, s, { size: 7, fill: i === 0 ? F : OUT })).join('') +
  cursor([[700, 120, 78], [1500, 120, 42], [3000, 120, 14]], { linger: 200 }),
  '拖动把手跟手改高度 · 松手吸到最近的档位'),

'resizable': scene(
  `<g>${anim('opacity', [[0, 1], [4000, 1]])}<rect fill="${SL}" stroke="${OUT}" rx="3" x="30" y="24">` +
  anim('width', [[0, 70], [700, 70], [1900, 150]], { splines: '.4 0 .2 1' }) +
  anim('height', [[0, 40], [700, 40], [1900, 58]], { splines: '.4 0 .2 1' }) + '</rect></g>' +
  `<rect width="7" height="7" rx="1" fill="${OUT}" y="57">${anim('x', [[0, 97], [700, 97], [1900, 177]], { splines: '.4 0 .2 1' })}${anim('y', [[0, 57], [700, 57], [1900, 75]], { splines: '.4 0 .2 1' })}</rect>` +
  cursor([[700, 104, 64], [1900, 184, 82]]) +
  txt(8, 100, '边角 handle 上 mousedown → 跟着 mousemove 改宽高', { size: 7, fill: F }),
  '拖边角的手柄改尺寸 · 松手前一直跟手'),

'marquee-selection': scene(
  [0, 1, 2, 3, 4, 5].map((i) => {
    const x = 24 + (i % 3) * 62, y = 20 + ((i / 3) | 0) * 40
    const inSel = i === 0 || i === 1 || i === 3 || i === 4
    return slab(x, y, 48, 28, { fill: SL }) +
      (inSel ? `<g>${anim('opacity', [[0, 0], [900 + i * 90, 0], [1100 + i * 90, 1]])}${slab(x, y, 48, 28, { fill: OUT, op: .22, stroke: OUT })}</g>` : '')
  }).join('') +
  `<rect fill="${OUT}" fill-opacity=".1" stroke="${OUT}" stroke-dasharray="3 2" x="20" y="16">` +
  anim('width', [[0, 0], [600, 0], [1900, 116]], { splines: '.4 0 .2 1' }) +
  anim('height', [[0, 0], [600, 0], [1900, 74]], { splines: '.4 0 .2 1' }) +
  anim('opacity', [[0, 0], [600, 0], [700, 1], [2200, 1], [2500, 0]]) + '</rect>' +
  cursor([[600, 20, 16], [1900, 136, 90]], { linger: 300 }),
  '空白处按下拖出选框 · 与框相交的都选中'),

'pinch-zoom': scene(
  frame(74, 14, 92, 74) +
  clipped('pz', 75, 15, 90, 72,
    `<g transform="translate(120,51)"><g>${anim('transform', [[0, '1'], [800, '1'], [2000, '1.9'], [3200, '1.9']], { transform: 'scale', splines: '.3 0 .2 1' })}` +
    slab(-36, -30, 72, 60, { fill: '#2c3a55' }) + slab(-24, -18, 24, 16, { fill: '#3f5279' }) + '</g></g>') +
  [[-1, 0], [1, 0]].map(([d, _], i) =>
    `<circle r="7" fill="none" stroke="${IN}" stroke-width="1.6" cy="51">` +
    anim('cx', [[0, 120 + d * 16], [800, 120 + d * 16], [2000, 120 + d * 40]], { splines: '.3 0 .2 1' }) +
    anim('opacity', [[0, 0], [700, 0], [800, .9], [2400, .9], [2700, 0]]) + '</circle>').join('') +
  txt(8, 104, '当前两指距离 ÷ 初始距离 = 缩放倍数', { size: 7, fill: F }),
  '两指拉开的比例就是缩放倍数 · 以两指中点为原点'),

'magnetic-button': scene(
  slab(88, 40, 64, 26, { fill: SL, stroke: F }) +
  `<g>${anim('transform', [[0, '0,0'], [900, '0,0'], [1500, '5,3'], [2100, '9,5'], [2700, '3,2'], [3200, '0,0']], { transform: 'translate', splines: '.3 0 .2 1' })}` +
  slab(88, 40, 64, 26, { fill: '#2c3a55', stroke: OUT }) + txt(120, 57, '按钮', { size: 8, anchor: 'middle', fill: OUT }) + '</g>' +
  cursor([[900, 150, 62], [1500, 162, 70], [2100, 172, 76], [2700, 152, 66], [3200, 132, 56]]) +
  txt(8, 92, '指针到中心的偏移 × 一个小于 1 的系数', { size: 7, fill: F }),
  '按钮朝指针方向偏一点 · 像被磁铁轻轻吸住'),

'cursor-follow': scene(
  cursor([[400, 40, 26], [1500, 170, 70], [2600, 70, 78]], { linger: 400 }) +
  `<circle r="9" fill="none" stroke="${OUT}" stroke-width="1.4">` +
  anim('cx', [[400, 40], [1700, 170], [2900, 70]], { splines: '.55 0 .3 1' }) +
  anim('cy', [[400, 26], [1700, 70], [2900, 78]], { splines: '.55 0 .3 1' }) +
  anim('opacity', [[0, 0], [400, 0], [600, 1], [3200, 1], [3400, 0]]) + '</circle>' +
  txt(8, 100, '每帧 lerp 向目标追一点 · 所以总慢半拍', { size: 7, fill: F }),
  '自定义光标用 lerp 追指针 · 追不上的那点差就是手感'),

'tilt-effect': scene(
  `<g transform="translate(120,50)"><g>` +
  anim('transform', [[0, '0'], [800, '0'], [1600, '-9'], [2400, '9'], [3200, '0']], { transform: 'rotate', splines: '.3 0 .2 1' }) +
  `<g>${anim('transform', [[0, '1,1'], [800, '1,1'], [1600, '.96,1.04'], [2400, '1.04,.96'], [3200, '1,1']], { transform: 'scale', splines: '.3 0 .2 1' })}` +
  slab(-52, -34, 104, 68, { fill: '#2c3a55', stroke: OUT, rx: 5 }) + '</g></g></g>' +
  cursor([[800, 120, 50], [1600, 66, 26], [2400, 176, 76], [3200, 120, 50]]) +
  txt(8, 100, '指针在卡片上的相对位置 → rotateX / rotateY', { size: 7, fill: F }),
  '指针位置映射成两轴旋转 · 卡片跟着侧过来'),

'hit-area': scene(
  frame(30, 30, 44, 44, { dash: '3 3', stroke: F }) + txt(52, 88, '44×44 热区', { size: 7, anchor: 'middle', fill: F }) +
  slab(42, 42, 20, 20, { fill: '#2c3a55', stroke: OUT, rx: 3 }) + txt(52, 22, '视觉 20×20', { size: 7, anchor: 'middle', fill: OUT }) +
  frame(150, 42, 20, 20, { dash: '3 3', stroke: BAD }) + slab(150, 42, 20, 20, { fill: SL, stroke: BAD, rx: 3 }) +
  txt(160, 78, '热区=视觉', { size: 7, anchor: 'middle', fill: BAD }) + txt(160, 88, '点不中', { size: 7, anchor: 'middle', fill: BAD }) +
  cursor([[600, 36, 36], [1600, 156, 66], [2600, 36, 36]]) +
  click(36, 36, 900, OK) + click(156, 66, 1900, BAD),
  '视觉可以小 · 但可点区域要撑到 44×44'),

'context-menu': scene(
  frame(12, 12, 210, 74, { fill: '#12161f' }) +
  `<g>${anim('opacity', [[0, 0], [1000, 0], [1150, 1]])}` +
  `<g transform="translate(92,34)"><g>${anim('transform', [[0, '.92'], [1000, '.92'], [1200, '1']], { transform: 'scale', splines: '.16 1 .3 1' })}` +
  slab(0, 0, 78, 46, { fill: '#1b2230', stroke: OUT, rx: 4 }) +
  [0, 1, 2].map((i) => slab(6, 8 + i * 13, 60 - i * 12, 6, { fill: F, op: .6 })).join('') + '</g></g></g>' +
  cursor([[500, 92, 34], [1000, 92, 34]], { linger: 900 }) + click(92, 34, 950, OUT) +
  txt(8, 100, 'contextmenu 事件 + preventDefault · 用鼠标坐标定位', { size: 7, fill: F }),
  '右键在指针处开菜单 · 拦掉系统自带那个'),

'multi-select': scene(
  [0, 1, 2, 3, 4].map((i) => {
    const y = 16 + i * 16
    const on = [[700, 3400], [2500, 3400], [2500, 3400], [2500, 3400], [null]][i]
    return slab(40, y, 130, 12, { fill: SL }) +
      (on[0] ? `<g>${between(on[0], on[1], 120)}${slab(40, y, 130, 12, { fill: OUT, op: .3, stroke: OUT })}</g>` : '')
  }).join('') +
  `<g>${anim('opacity', [[0, 0], [1900, 0], [2100, 1], [3200, 1], [3400, 0]])}${txt(178, 34, 'Shift+点', { size: 7.5, fill: OUT })}${txt(178, 46, '选中一整段', { size: 7.5, fill: F })}</g>` +
  cursor([[700, 60, 22], [2200, 60, 70]]) + click(60, 22, 750, OUT) + click(60, 70, 2250, OUT),
  '普通点单选 · Cmd 点加减 · Shift 点选一整段'),

'inline-edit': scene(
  `<g>${anim('opacity', [[0, 1], [900, 1], [1000, 0]])}${txt(44, 46, '项目名称', { size: 12, fill: '#e8ecf4' })}</g>` +
  `<g>${anim('opacity', [[0, 0], [1000, 0], [1100, 1]])}` +
  slab(38, 30, 130, 24, { fill: '#161b26', stroke: OUT, rx: 3 }) +
  slab(42, 38, 56, 9, { fill: OUT, op: .3 }) + txt(44, 46, '项目名称', { size: 12, fill: '#e8ecf4' }) +
  `<rect x="100" y="35" width="1.4" height="14" fill="${OUT}">${anim('opacity', [[1100, 1], [1400, 0], [1700, 1], [2000, 0], [2300, 1]])}</rect></g>` +
  txt(8, 76, '失焦或回车提交 · Esc 取消回滚', { size: 7.5, fill: F }) +
  txt(8, 90, '常配合乐观更新：先改界面，失败再退回来', { size: 7, fill: F }) +
  cursor([[500, 60, 46], [900, 60, 46]], { linger: 300 }) + click(60, 46, 900, OUT),
  '点一下就地变输入框并选中原值 · 不跳页'),

'ripple-effect': scene(
  slab(70, 32, 100, 40, { fill: '#2c3a55', stroke: OUT, rx: 5 }) +
  clipped('rp', 70, 32, 100, 40,
    [800, 2100].map((t) => `<circle cx="102" cy="56" r="0" fill="#dce6ff">` +
      anim('r', [[0, 0], [t, 0], [t + 700, 62]], { splines: '0 0 .58 1' }) +
      anim('opacity', [[0, 0], [t, .34], [t + 700, 0]]) + '</circle>').join('')) +
  slab(70, 32, 100, 40, { fill: 'none', stroke: OUT, rx: 5 }) +
  cursor([[600, 102, 56], [2100, 102, 56]], { linger: 800 }) +
  txt(8, 92, '以点击坐标为圆心 · scale(0)→scale(1) 同时淡出', { size: 7, fill: F }),
  '从手指落点长出一个圆 · 边扩边淡'),

'micro-interaction': scene(
  ['默认', 'hover', '按下'].map((s, i) => {
    const x = 18 + i * 74, on = [[1, 900], [900, 1900], [1900, 2700]][i]
    const box = (fill, stroke) => slab(-31, -14, 62, 28, { fill, stroke, rx: 4 })
    return slab(x, 34, 62, 28, { fill: SL, stroke: F, rx: 4 }) + txt(x + 31, 52, s, { size: 8, anchor: 'middle', fill: F }) +
      `<g>${between(on[0], on[1], 140)}<g transform="translate(${x + 31},48)">` +
      // 「按下」这一态要真的缩一下 —— 写成 scale 1→1 的话图上没有任何变化，
      // 只是多了一条永远不动的动画。
      (i === 2
        ? `<g>${anim('transform', [[0, '1'], [on[0], '1'], [on[0] + 140, '.93'], [on[1] - 240, '.93'], [on[1], '1']], { transform: 'scale', splines: '.3 0 .2 1' })}` + box('#2c3a55', OUT) + '</g>'
        : box(i ? '#2c3a55' : SL, OUT)) +
      txt(0, 4, s, { size: 8, anchor: 'middle', fill: OUT }) + '</g></g>'
  }).join('') +
  cursor([[900, 100, 60], [1900, 100, 60], [2700, 174, 60]], { linger: 300 }) +
  txt(8, 86, '150~250ms · transform + opacity，只走合成线程', { size: 7, fill: F }),
  '单个控件的即时反馈 · 变色、缩一下、图标形变'),

'gesture-driven-animation': scene(
  frame(12, 14, 210, 58) +
  follows([[0, '0,0'], [600, '0,0'], [1700, '104,0'], [2000, '124,0'], [2600, '138,0'], [3200, '138,0']],
    slab(24, 26, 60, 34, { fill: '#2c3a55', stroke: OUT, rx: 4 }), '.25 0 .1 1') +
  `<g>${anim('opacity', [[0, 0], [1700, 0], [1900, 1], [2900, 1], [3200, 0]])}${txt(150, 84, '松手后接惯性', { size: 7.5, fill: OUT })}</g>` +
  txt(8, 84, '跟手段：指针位置直接映射', { size: 7.5, fill: F }) +
  cursor([[600, 54, 43], [1700, 158, 43]], { linger: 100 }),
  '按住时位置直接跟手 · 松手后交给速度和惯性')

}
