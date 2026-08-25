// 批次 H · 性能与合成 / 网络与加载 / 占位与状态。
//
// 网络那一族全部走时间轴：上行「客户端」、下行「服务器」，
// 语义就是**「谁先动、谁等谁、白屏那段有多长」** —— 这些只有时间轴画得出来。
import { C, timeline } from './templates.mjs'
import { anim, appear, between, clipped, frame, line, r, scene, slab, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint, SL = C.slab
const rows = (n, x, y0, w, h, gap, o = {}) => Array.from({ length: n }, (_, i) => slab(x, y0 + i * gap, w, h, o)).join('')
/** 循环扫过的斜高光。id 每张图必须唯一，否则同页多张互相串。 */
const sheen = (id, op = .14) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0" stop-color="#ffffff" stop-opacity="0"/>` +
  `<stop offset="0.5" stop-color="#ffffff" stop-opacity="${op}"/>` +
  `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
  `<animateTransform attributeName="gradientTransform" type="translate" values="-1;1" dur="1600ms" repeatCount="indefinite"/>` +
  '</linearGradient></defs>'

export const H = {

// ── 性能与合成 ───────────────────────────────────────────────────────────

'compositor-only-properties': timeline({
  span: 130, t0: 0, scale: 24, playStart: 200,
  rows: [{ label: 'transform', color: OK, bars: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ from: i * 16.7, to: i * 16.7 + 3, h: 8 })) },
         { label: 'left / width', color: BAD, bars: [0, 1, 2, 3].map((i) => ({ from: i * 30, to: i * 30 + 22, h: 8, label: i === 0 ? '布局+绘制+合成' : '' })) }],
  caption: '只有 transform 和 opacity 能跳过布局和绘制'
}),

'reflow-repaint': timeline({
  span: 130, t0: 0, scale: 24, playStart: 200,
  rows: [{ label: '改宽高', color: BAD, bars: [{ from: 0, to: 26, label: '重排' }, { from: 26, to: 46, color: IN, label: '重绘' }, { from: 46, to: 58, color: OK, label: '合成' }] },
         { label: '只改颜色', color: IN, bars: [{ from: 0, to: 20, label: '重绘' }, { from: 20, to: 32, color: OK, label: '合成' }] }],
  caption: '几何一变就要重排（连带一片元素）· 颜色变只重绘'
}),

'will-change': timeline({
  span: 130, t0: 0, scale: 24, playStart: 200,
  rows: [{ label: '临时提层', color: BAD, bars: [{ from: 0, to: 18, label: '第一帧才建纹理' }, { from: 18, to: 24, color: OK }, { from: 30, to: 36, color: OK }, { from: 46, to: 52, color: OK }] },
         { label: 'will-change', color: OK, bars: [{ from: 0, to: 6, color: F, label: '提前建好' }, { from: 16, to: 22 }, { from: 32, to: 38 }, { from: 48, to: 54 }] }],
  caption: '提前告诉浏览器 · 别在第一帧现建纹理（也别到处乱加）'
}),

'compositor-layer': scene(
  frame(14, 16, 96, 70) + rows(3, 22, 24, 80, 14, 20) +
  txt(62, 100, '同一层里一起画', { size: 7.5, anchor: 'middle', fill: F }) +
  `<g>${anim('transform', [[0, '0,0'], [900, '0,0'], [1800, '10,-8'], [3000, '10,-8'], [3600, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
  frame(130, 16, 96, 70) + rows(2, 138, 24, 80, 14, 20) + '</g>' +
  `<g>${anim('opacity', [[0, 0], [1400, 0], [1900, 1], [3000, 1], [3300, 0]])}` +
  slab(138, 64, 80, 14, { fill: '#2c3a55', stroke: OUT, rx: 2 }) +
  txt(178, 100, '单独一张 GPU 纹理', { size: 7.5, anchor: 'middle', fill: OUT }) + '</g>' +
  txt(8, 112, '之后动它只是在合成线程平移这张位图 · 不重画内容', { size: 7, fill: F }),
  ''),

'hardware-acceleration': scene(
  txt(8, 22, 'transform: translateZ(0)', { size: 8, fill: OUT }) +
  txt(8, 36, '历史上用来「骗」浏览器提一个合成层', { size: 7.5, fill: F }) +
  slab(14, 46, 100, 40, { fill: SL, stroke: F, rx: 4 }) + txt(64, 70, '普通元素', { size: 8, anchor: 'middle', fill: F }) +
  `<g>${anim('transform', [[0, '0,0'], [1000, '0,0'], [1800, '6,-6'], [3000, '6,-6'], [3600, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
  slab(130, 46, 100, 40, { fill: '#2c3a55', stroke: OUT, rx: 4 }) + txt(180, 70, '被提成一层', { size: 8, anchor: 'middle', fill: OUT }) + '</g>' +
  `<g>${anim('opacity', [[0, 0], [2000, 0], [2400, 1]])}${txt(180, 100, '今天该写 will-change · 而且别滥用', { size: 7, anchor: 'middle', fill: IN })}</g>` +
  txt(8, 112, '层不是越多越好 —— 每层都吃显存，多了反而更卡', { size: 7, fill: F }),
  ''),

'passive-event-listener': timeline({
  span: 200, t0: 0, scale: 16, playStart: 200,
  rows: [{ label: '默认', color: BAD, bars: [{ from: 0, to: 46, hollow: true, color: F, label: '等 JS 表态拦不拦' }, { from: 52, to: 76, label: '才滚' }] },
         { label: 'passive', color: OK, bars: [{ from: 0, to: 26, label: '立刻就滚' }, { from: 34, to: 68, color: F, hollow: true, label: 'JS 另跑，不挡路' }] }],
  caption: '说好了不拦截 · 浏览器就不必等你，滚动立刻跟手'
}),

// ── 网络与加载 ───────────────────────────────────────────────────────────

'cursor-pagination': scene(
  frame(14, 14, 96, 74) + rows(4, 22, 22, 80, 13, 17, { fill: '#2c3a55' }) +
  `<g>${appear(1600)}${slab(22, 76, 80, 6, { fill: OUT, op: .35, rx: 2 })}${txt(62, 100, '记住最后一条的游标', { size: 7, anchor: 'middle', fill: OUT })}</g>` +
  `<g>${anim('opacity', [[0, 0], [2000, 0], [2400, 1]])}${frame(130, 14, 96, 74)}${rows(4, 138, 22, 80, 13, 17, { fill: '#2c3a55' })}` +
  txt(178, 100, 'after=<游标> 取下一页', { size: 7, anchor: 'middle', fill: OUT }) + '</g>' +
  txt(8, 112, 'offset 深翻页又慢又会漏会重 · 游标不受中途增删影响', { size: 7, fill: F }),
  ''),

'server-sent-events': timeline({
  span: 3400, t0: 0,
  rows: [{ label: '连接', color: F, bars: [{ from: 100, to: 3300, hollow: true, label: '一条长连接不断开' }] },
         { label: '推送', color: OUT, at: [700, 1300, 1500, 2200, 2900] }],
  caption: '服务器想推就推 · 断了 EventSource 自己会重连'
}),

'polling-vs-sse': undefined,

'react-suspense': timeline({
  span: 2200, t0: 0,
  rows: [{ label: '界面', color: OUT, bars: [{ from: 100, to: 1300, color: F, hollow: true, label: 'fallback 占位' }, { from: 1300, to: 2100, label: '真内容' }] },
         { label: '数据', color: IN, bars: [{ from: 100, to: 1300, label: '组件 throw 了个 Promise' }] }],
  caption: '数据没好就往上抛 · 最近的 Suspense 接住并显占位'
}),

'streaming-ssr': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '整页等完', color: BAD, bars: [{ from: 100, to: 1900, hollow: true, color: F, label: '白屏' }, { from: 1900, to: 2400, label: '一次全给' }] },
         { label: '分块流式', color: OK, bars: [{ from: 100, to: 500, label: '头' }, { from: 500, to: 1100, label: '主体' }, { from: 1100, to: 1700, label: '侧栏' }, { from: 1700, to: 2300, label: '页脚' }] }],
  caption: '不等整页渲完 · 渲好一块就先发一块出去'
}),

'concurrent-rendering': timeline({
  span: 220, t0: 0, scale: 15, playStart: 200,
  rows: [{ label: '不可中断', color: BAD, bars: [{ from: 0, to: 96, label: '一口气渲完 · 输入卡在这' }] },
         { label: '切成小片', color: OK, bars: [0, 1, 2, 3, 4, 5].map((i) => ({ from: i * 18, to: i * 18 + 11 })).concat([{ from: 54, to: 65, color: IN, label: '插进来的输入' }]) }],
  caption: '渲染切成可中断的小块 · 高优先级的输入插得进来'
}),

'hydration': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '看得见', color: OUT, at: [{ t: 300, label: 'HTML 到了' }] },
         { label: '点得动', color: IN, bars: [{ from: 300, to: 1900, hollow: true, color: BAD, label: '能看不能点' }], at: [1900] }],
  brace: { from: 300, to: 1900, label: '这段最容易被骂' },
  caption: '静态 HTML 先到 · 注水完成前点了没反应'
}),

'partial-hydration': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '整页注水', color: BAD, bars: [{ from: 200, to: 1900, label: '全部 JS 都要下载并执行' }] },
         { label: '岛屿架构', color: OK, bars: [{ from: 200, to: 600, label: '搜索框' }, { from: 700, to: 1050, label: '轮播' }, { from: 1150, to: 1450, label: '购物车' }] }],
  caption: '只给交互组件注水 · 静态部分一行 JS 都不发'
}),

'resumability': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '注水', color: BAD, bars: [{ from: 200, to: 1700, label: '客户端把组件树整个重跑一遍' }] },
         { label: '可恢复', color: OK, bars: [{ from: 200, to: 420, label: '接着 HTML 里的状态往下走' }] }],
  caption: '状态和监听位置序列化进 HTML · 启动时不用重跑一遍'
}),

'code-splitting': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '一个大包', color: BAD, bars: [{ from: 200, to: 1800, label: '首屏也要等整个 bundle' }] },
         { label: '按路由切', color: OK, bars: [{ from: 200, to: 700, label: '首屏 chunk' }, { from: 1400, to: 1800, color: F, label: '进那页才拉' }] }],
  caption: 'dynamic import() 切成多个 chunk · 首屏只下必要的'
}),

'resource-hints': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '不提示', color: BAD, bars: [{ from: 100, to: 640, color: F, label: 'DNS+TLS' }, { from: 760, to: 1560, label: '才开始下' }] },
         { label: 'preconnect', color: OK, bars: [{ from: 100, to: 640, color: F, label: '握手提前做' }, { from: 760, to: 1560, label: '要用时直接下' }] }],
  caption: 'preconnect / dns-prefetch / preload · 把等待挪到前面'
}),

'intent-prefetch': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '指针', color: IN, at: [{ t: 400, label: 'hover' }, { t: 1500, label: '真的点了' }] },
         { label: '数据', color: OUT, bars: [{ from: 400, to: 1400, color: F, label: '悄悄先拉' }], at: [1500] }],
  marks: [{ t: 1500, label: '点下去就已经有了 · 秒开', color: OK, y: 68, anchor: 'middle' }],
  caption: 'hover 或 mousedown 就当成信号 · 提前把下一步拉好'
}),

'speculation-rules': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '声明规则', color: F, bars: [{ from: 200, to: 500, label: '<script type="speculationrules">' }] },
         { label: '浏览器', color: OUT, bars: [{ from: 600, to: 1600, color: F, label: '自己挑时机预渲染' }], at: [{ t: 1900, label: '导航 · 几乎瞬间' }] }],
  caption: '声明式告诉浏览器该预取谁 · 什么时候做由它决定'
}),

'bfcache': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '普通后退', color: BAD, bars: [{ from: 200, to: 1600, label: '重新请求 · 重新执行 · 重新渲染' }] },
         { label: 'bfcache', color: OK, bars: [{ from: 200, to: 380, label: '整页连 JS 堆栈一起解冻' }] }],
  caption: '要保住它：别写 unload，别开没关的连接'
}),

'normalized-cache': scene(
  slab(14, 18, 92, 22, { fill: SL, stroke: F, rx: 3 }) + txt(60, 32, '查询 A', { size: 7.5, anchor: 'middle', fill: F }) +
  slab(14, 46, 92, 22, { fill: SL, stroke: F, rx: 3 }) + txt(60, 60, '查询 B', { size: 7.5, anchor: 'middle', fill: F }) +
  `<path d="M108 29 L140 40" stroke="${F}" stroke-dasharray="2 2" fill="none"/>` +
  `<path d="M108 57 L140 46" stroke="${F}" stroke-dasharray="2 2" fill="none"/>` +
  slab(142, 30, 84, 26, { fill: '#2c3a55', stroke: OUT, rx: 3 }) +
  txt(184, 47, 'User:7', { size: 8, anchor: 'middle', fill: OUT }) +
  `<g>${anim('opacity', [[0, 0], [1200, 0], [1500, 1], [2600, 1], [2900, 0]])}` +
  slab(142, 30, 84, 26, { fill: OK, op: .25, rx: 3 }) +
  slab(14, 18, 92, 22, { fill: OK, op: .18, rx: 3 }) + slab(14, 46, 92, 22, { fill: OK, op: .18, rx: 3 }) + '</g>' +
  txt(8, 84, '按 __typename + id 拆成扁平实体表', { size: 7.5, fill: F }) +
  txt(8, 98, '改一处 · 引用它的所有查询同时更新，不用手动失效', { size: 7.5, fill: OK }),
  ''),

'offline-first': timeline({
  span: 3000, t0: 0,
  rows: [{ label: '本地库', color: OK, at: [{ t: 200, label: '写' }, { t: 700, label: '读' }, { t: 1200, label: '写' }] },
         { label: '网络', color: F, bars: [{ from: 200, to: 1700, hollow: true, color: BAD, label: '断网 · 照用不误' }], at: [{ t: 2100, label: '回来了 · 一起同步' }] }],
  caption: '先读写本地 · 网络只是把变更异步捎出去'
}),

'background-sync': timeline({
  span: 3000, t0: 0,
  rows: [{ label: '用户操作', color: IN, at: [200, 500, 900] },
         { label: 'SW 队列', color: OUT, bars: [{ from: 200, to: 1900, hollow: true, color: F, label: '存 IndexedDB 排队' }], at: [{ t: 2100, label: '网络一恢复就重放' }] }],
  caption: '离线时先入队 · 就算用户已经关掉页面也照发'
}),

'service-worker-cache': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '请求', color: IN, at: [{ t: 300, label: '被 SW 拦下' }, { t: 1500, label: '再来一次' }] },
         { label: '来源', color: OUT, bars: [{ from: 300, to: 1100, color: F, label: '缓存没有 → 走网络并存下' }, { from: 1500, to: 1700, color: OK, label: '缓存命中' }] }],
  caption: 'SW 在 fetch 事件里接管 · 缓存优先还是网络优先自己定'
}),

// ── 占位与状态 ───────────────────────────────────────────────────────────

'skeleton': scene(
  sheen('skl') +
  `<g>${anim('opacity', [[0, 1], [2200, 1], [2500, 0]])}` +
  slab(20, 18, 34, 34, { fill: SL, rx: 17 }) + rows(2, 62, 22, 120, 10, 18, { fill: SL }) +
  rows(3, 20, 62, 200, 9, 15, { fill: SL }) +
  slab(20, 18, 34, 34, { fill: 'url(#skl)', rx: 17 }) + rows(2, 62, 22, 120, 10, 18, { fill: 'url(#skl)' }) +
  rows(3, 20, 62, 200, 9, 15, { fill: 'url(#skl)' }) + '</g>' +
  `<g>${anim('opacity', [[0, 0], [2400, 0], [2800, 1]])}` +
  slab(20, 18, 34, 34, { fill: '#2c3a55', rx: 17 }) + rows(2, 62, 22, 120, 10, 18, { fill: '#2c3a55' }) +
  rows(3, 20, 62, 200, 9, 15, { fill: '#2c3a55' }) + '</g>',
  '占位块的布局跟真内容一致 · 换上去时不跳版'),

'loading-state': scene(
  ['spinner', '骨架屏', '进度条'].map((s, i) => {
    const x = 14 + i * 74
    return frame(x, 18, 64, 44) + txt(x + 32, 76, s, { size: 7.5, anchor: 'middle', fill: F })
  }).join('') +
  `<circle cx="46" cy="40" r="9" fill="none" stroke="${SL}" stroke-width="2.6"/>` +
  `<circle cx="46" cy="40" r="9" fill="none" stroke="${OUT}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="16 42" transform-origin="46 40">` +
  anim('transform', [[0, '0'], [4000, '1440']], { transform: 'rotate' }) + '</circle>' +
  sheen('ls2') + rows(3, 96, 26, 48, 8, 12, { fill: SL }) + rows(3, 96, 26, 48, 8, 12, { fill: 'url(#ls2)' }) +
  slab(170, 36, 48, 7, { fill: SL, rx: 3.5 }) +
  `<rect x="170" y="36" height="7" rx="3.5" fill="${OUT}" width="0">${anim('width', [[300, 0], [1500, 22], [2600, 38], [3600, 48]], { splines: '.4 0 .2 1' })}</rect>` +
  txt(8, 96, '轻量用 spinner · 有布局用骨架屏 · 知道百分比才用进度条', { size: 7, fill: F }) +
  txt(8, 108, '别一上来就闪 —— 200ms 内回来的请求不该显加载态', { size: 7, fill: IN }),
  ''),

'empty-state': scene(
  frame(30, 12, 180, 74, { dash: '4 3' }) +
  `<g>${anim('opacity', [[0, 0], [400, 0], [900, 1]])}` +
  `<g>${anim('transform', [[0, '0,8'], [400, '0,8'], [900, '0,0']], { transform: 'translate', splines: '.16 1 .3 1' })}` +
  `<circle cx="120" cy="34" r="11" fill="none" stroke="${F}" stroke-width="1.6"/>` +
  `<path d="M128 42 L136 50" stroke="${F}" stroke-width="1.6" stroke-linecap="round"/></g></g>` +
  `<g>${anim('opacity', [[0, 0], [700, 0], [1200, 1]])}${txt(120, 60, '还没有内容', { size: 8.5, anchor: 'middle', fill: F })}</g>` +
  `<g>${anim('opacity', [[0, 0], [1000, 0], [1500, 1]])}${slab(88, 66, 64, 15, { fill: OUT, op: .22, stroke: OUT, rx: 4 })}${txt(120, 77, '新建一个', { size: 7.5, anchor: 'middle', fill: OUT })}</g>` +
  txt(8, 100, '要分清「第一次来」「搜不到」「出错了」', { size: 7.5, fill: F }) +
  txt(8, 112, '三种空是三件事 · 文案和引导都不一样', { size: 7.5, fill: IN }),
  ''),

'lqip': scene(
  frame(14, 14, 96, 62) +
  `<g>${anim('opacity', [[0, 1], [1400, 1], [2000, 0]])}` +
  slab(18, 18, 88, 54, { fill: '#3a4a68', rx: 2 }) + slab(18, 18, 44, 30, { fill: '#4c6390', rx: 2 }) +
  slab(52, 44, 54, 28, { fill: '#2b3a56', rx: 2 }) + '</g>' +
  `<g>${anim('opacity', [[0, 0], [1600, 0], [2200, 1]])}` +
  slab(18, 18, 88, 54, { fill: '#5477b5', rx: 2 }) + slab(26, 26, 30, 20, { fill: '#7fa3dd', rx: 2 }) +
  slab(60, 46, 40, 22, { fill: '#33456a', rx: 2 }) + '</g>' +
  txt(62, 90, '几百字节的模糊图先撑住', { size: 7, anchor: 'middle', fill: F }) +
  txt(130, 32, '① 占位先到 · 布局不跳', { size: 7.5, fill: F }) +
  txt(130, 48, '② 原图到了再换上', { size: 7.5, fill: OUT }) +
  txt(130, 68, '色彩轮廓对了 · 换的时候不突兀', { size: 7, fill: F }),
  ''),

'blurhash': scene(
  slab(12, 22, 108, 18, { fill: '#12161f', stroke: F, rx: 3 }) +
  txt(18, 35, 'LEHV6nWB2yk8pyo', { size: 7.5, fill: OK }) +
  txt(12, 52, '20~30 个字符 · 直接塞进接口 JSON', { size: 7, fill: F }) +
  `<path d="M124 40 L146 40 M142 36 L148 40 L142 44 Z" stroke="${F}" fill="${F}" stroke-width="1.2"/>` +
  frame(154, 16, 72, 52) +
  `<g>${anim('opacity', [[0, 0], [600, 0], [1100, 1]])}` +
  slab(158, 20, 64, 44, { fill: '#42588a', rx: 2 }) + slab(158, 20, 32, 24, { fill: '#6685c4', rx: 2 }) +
  slab(186, 40, 36, 24, { fill: '#2a3a5c', rx: 2 }) + '</g>' +
  txt(190, 82, '客户端解码成模糊渐变', { size: 7, anchor: 'middle', fill: OUT }) +
  txt(8, 104, '不用额外发一次请求 —— 占位就藏在接口数据里', { size: 7, fill: F }),
  ''),

'thumbhash': scene(
  [['BlurHash', 26, F, 3], ['ThumbHash', 68, OUT, 5]].map(([s, y, col, n]) =>
    txt(8, y + 10, String(s), { size: 7.5, fill: col }) +
    Array.from({ length: n * 3 }, (_, i) =>
      slab(64 + (i % (n * 3)) * (100 / (n * 3)), y, 100 / (n * 3) - 1, 20,
        { fill: ['#42588a', '#6685c4', '#2a3a5c', '#7fa3dd', '#33456a'][i % 5], rx: 1 })).join('') +
    txt(228, y + 13, n === 3 ? '细节到这' : '同样字节细节更多', { size: 7, anchor: 'end', fill: col })).join('') +
  `<g>${anim('opacity', [[0, 0], [1200, 0], [1700, 1], [3000, 1], [3300, 0]])}` +
  txt(64, 104, '还多了透明通道 · 宽高也能自己推出来', { size: 7.5, fill: OUT }) + '</g>' +
  `<g>${anim('opacity', [[0, 1], [1200, 1], [1700, 0], [3300, 0], [3600, 1]])}` +
  txt(64, 104, 'BlurHash 的改进版 · 字节数一样', { size: 7.5, fill: F }) + '</g>',
  ''),

'progressive-image': scene(
  frame(20, 14, 200, 62) +
  [0, 1, 2, 3].map((i) => {
    const on = [[300, 1100], [1100, 1900], [1900, 2700], [2700, 3600]][i]
    const blur = [7, 3.5, 1.4, 0][i]
    return `<g>${between(on[0], on[1], 140)}` +
      (blur ? `<defs><filter id="pi${i}"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>` : '') +
      `<g${blur ? ` filter="url(#pi${i})"` : ''}>` +
      slab(24, 18, 192, 54, { fill: '#4a659c', rx: 2 }) + slab(34, 26, 62, 38, { fill: '#7fa3dd', rx: 2 }) +
      slab(110, 34, 96, 32, { fill: '#2a3a5c', rx: 2 }) + '</g>' +
      txt(120, 92, `第 ${i + 1} 遍扫描`, { size: 7.5, anchor: 'middle', fill: i === 3 ? OUT : F }) + '</g>'
  }).join('') +
  txt(8, 110, '渐进式 JPEG / 交错 PNG · 由模糊到清晰，不是从上往下刷', { size: 7, fill: F }),
  '')

}
delete H['polling-vs-sse']
