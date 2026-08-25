// 批次 A · 时间轴族 + 赛跑族。
// 这两族的共同点：**语义就是时序本身**，静态图只能画个示意，画不出区别。
//
// 参数一律照词条 logic 里的数字取（防抖 300ms、长按 500ms、退避 base*2^n…），
// 不许为了好看改数 —— 图上标什么，动画就得是什么。
import { C, EASE, cubicPts, decayPts, race, springPts, stepPts, timeline } from './templates.mjs'

const IN = C.in, OUT = C.out, BAD = C.bad, OK = C.ok, F = C.faint

export const A = {

// ── 时间轴族 ─────────────────────────────────────────────────────────────

'debounce': timeline({
  span: 1500, t0: 100,
  rows: [{ label: '输入', color: IN, at: [160, 340, 520, 700, 880] },
         { label: '输出', color: OUT, at: [1180] }],
  brace: { from: 880, to: 1180, label: '静默 300ms' },
  caption: '连打 5 下都不触发 · 停手满 300ms 才发一次'
}),

'throttle': timeline({
  span: 1700, t0: 100,
  rows: [{ label: '输入', color: IN, at: [160, 260, 360, 460, 560, 660, 760, 860, 960, 1060, 1160, 1260, 1360, 1460, 1560] },
         { label: '输出', color: OUT, at: [160, 460, 760, 1060, 1360] }],
  caption: '一直打 15 下 · 每 300ms 匀速放行（打 3 下放 1 下）'
}),

'hover-intent': timeline({
  span: 2400, t0: 0,
  rows: [{ label: '指针', color: IN, at: [{ t: 120, label: '划过' }, { t: 260, color: F, x: 1 }, { t: 1100, label: '停住' }] },
         { label: '菜单', color: OUT, at: [1250] }],
  brace: { from: 1100, to: 1250, label: '等 150ms' },
  caption: '划过不展开 · 停住满 150ms 才当成真意图'
}),

'long-press': timeline({
  span: 2400, t0: 0,
  rows: [{ label: '按下', color: IN, bars: [{ from: 100, to: 300, label: '短按' }, { from: 900, to: 1400, label: '按住 500ms' }] },
         { label: '触发', color: OUT, at: [1400] }],
  marks: [{ t: 300, label: '松手→取消', color: F, y: 66 }],
  caption: '短按什么都不发生 · 按满 500ms 才算长按'
}),

'polling': timeline({
  span: 3400, t0: 0,
  rows: [{ label: '请求', color: IN, at: [150, 1350, 2550] },
         { label: '响应', color: OUT, at: [550, 1750, 2950] }],
  brace: { from: 550, to: 1350, label: '等 800ms 再问' },
  caption: '上一次答完才排下一次 · 不会堆积'
}),

'retry-backoff': timeline({
  span: 3400, t0: 0,
  rows: [{ label: '尝试', color: IN, at: [{ t: 100, color: BAD, x: 1 }, { t: 400, color: BAD, x: 1 }, { t: 1000, color: BAD, x: 1 }, { t: 2200, color: OK }] },
         { label: '等待', color: F, bars: [{ from: 100, to: 400, label: '200' }, { from: 400, to: 1000, label: '400' }, { from: 1000, to: 2200, label: '800ms' }] }],
  caption: '每失败一次等待翻倍 · 200 → 400 → 800ms'
}),

'request-deduplication': timeline({
  span: 1400, t0: 0,
  rows: [{ label: '调用', color: IN, at: [100, 180, 260, 340] },
         { label: '真实请求', color: OUT, at: [100] }],
  marks: [{ t: 400, label: '后 3 次复用同一个 Promise', color: F, y: 68 }],
  caption: '同 key 并发 4 次 · 只发 1 个真请求'
}),

'race-condition-guard': timeline({
  span: 1400, t0: 0,
  rows: [{ label: '请求', color: IN, at: [{ t: 100, label: '#1' }, { t: 300, label: '#2' }] },
         { label: '响应', color: OUT, at: [{ t: 600, label: '#2' }, { t: 1000, label: '#1', color: BAD, x: 1 }] }],
  marks: [{ t: 1000, label: '过期 · 丢弃', color: BAD, y: 68, anchor: 'middle' }],
  caption: '后发先回 · 迟到的旧响应直接丢掉不覆盖'
}),

'request-cancellation': timeline({
  span: 1400, t0: 0,
  rows: [{ label: '输入变化', color: IN, at: [100, 400] },
         { label: '在途请求', color: OUT, bars: [{ from: 100, to: 400, color: BAD, label: 'abort' }, { from: 400, to: 900, label: '完成' }] }],
  caption: '输入一变就 abort 旧请求 · 只让最后一次生效'
}),

'autosave': timeline({
  span: 2600, t0: 0,
  rows: [{ label: '打字', color: IN, at: [100, 260, 420, 580, 740, 900] },
         { label: '保存', color: OUT, at: [1700] }],
  brace: { from: 900, to: 1700, label: '停手 800ms' },
  caption: '边打不存 · 停手 800ms 后自动落盘'
}),

'animation-delay': timeline({
  span: 1400, t0: 0,
  rows: [{ label: '触发', color: IN, at: [100] },
         { label: '三个元素', color: OUT, bars: [
           { from: 100, to: 220, hollow: true, color: F, y: 0, h: 5, label: 'delay 0 / 120 / 240ms' },
           { from: 220, to: 720, y: 0, h: 5 },
           { from: 100, to: 340, hollow: true, color: F, y: 7, h: 5 }, { from: 340, to: 840, y: 7, h: 5 },
           { from: 100, to: 460, hollow: true, color: F, y: 14, h: 5 }, { from: 460, to: 960, y: 14, h: 5 }] }],
  caption: '同一次触发 · 递增 delay 就成了错落进场'
}),

'animation-iteration-count': timeline({
  span: 2200, t0: 0,
  rows: [{ label: '3 遍后停', color: OUT, bars: [{ from: 100, to: 600, label: '1' }, { from: 600, to: 1100, label: '2' }, { from: 1100, to: 1600, label: '3' }] },
         { label: 'infinite', color: IN, bars: [{ from: 100, to: 600 }, { from: 600, to: 1100 }, { from: 1100, to: 1600 }, { from: 1600, to: 2100 }] }],
  caption: '整数遍数播完即停 · infinite 一直转下去'
}),

'frame-budget': timeline({
  span: 52, t0: 0, scale: 60,
  rows: [{ label: '每帧工作', color: OUT, bars: [{ from: 0, to: 11, label: '11ms' }, { from: 16.7, to: 27, label: '10ms' }, { from: 33.4, to: 50, color: BAD, label: '超支' }] },
         { label: '按时提交', color: OUT, at: [{ t: 16.7 }, { t: 33.4 }, { t: 50, color: BAD, x: 1 }] }],
  caption: '60fps 只有 16.7ms/帧 · 超一点就丢这一帧'
}),

'jank': timeline({
  span: 120, t0: 0, scale: 26,
  rows: [{ label: '主线程', color: OUT, bars: [{ from: 0, to: 8 }, { from: 16.7, to: 24 }, { from: 33.4, to: 78, color: BAD, label: '长任务' }, { from: 83.5, to: 91 }] },
         { label: '出帧', color: OUT, at: [{ t: 16.7 }, { t: 33.4 }, { t: 50, color: BAD, x: 1 }, { t: 66.8, color: BAD, x: 1 }, { t: 83.5, color: BAD, x: 1 }, { t: 100 }] }],
  caption: '一个长任务卡住主线程 · 连丢 3 帧就是卡顿'
}),

'request-animation-frame': timeline({
  span: 90, t0: 0, scale: 34,
  rows: [{ label: '屏幕刷新', color: F, at: [0, 16.7, 33.4, 50, 66.8, 83.5] },
         { label: 'rAF 回调', color: OUT, ripple: false, at: [1, 17.7, 34.4, 51, 67.8, 84.5] }],
  caption: '回调跟着刷新走 · 每 16.7ms 在重绘前跑一次'
}),

'request-idle-callback': timeline({
  span: 90, t0: 0, scale: 34,
  rows: [{ label: '帧内工作', color: OUT, bars: [{ from: 0, to: 7 }, { from: 16.7, to: 22 }, { from: 33.4, to: 42 }] },
         { label: '空闲任务', color: OK, bars: [{ from: 7, to: 16.7, label: '埋点' }, { from: 22, to: 33.4, label: '预渲染' }, { from: 42, to: 50, label: '日志' }] }],
  caption: '只用帧尾剩下的时间 · 不跟渲染和输入抢主线程'
}),

'layout-thrashing': timeline({
  span: 1000, t0: 0,
  rows: [{ label: '读写交替', color: BAD, bars: [{ from: 40, to: 180, label: '重排' }, { from: 240, to: 380, label: '重排' }, { from: 440, to: 580, label: '重排' }, { from: 640, to: 780, label: '重排' }] },
         { label: '读完再写', color: OK, bars: [{ from: 40, to: 400, color: F, label: '批量读' }, { from: 400, to: 620, label: '只重排一次' }] }],
  caption: '循环里读一次写一次 · 每次都强制同步重排'
}),

'memoization': timeline({
  span: 1500, t0: 0,
  rows: [{ label: '调用', color: IN, at: [100, 500, 700, 900, 1100] },
         { label: '真的算', color: OUT, bars: [{ from: 100, to: 420, label: '首次 320ms' }] }],
  marks: [{ t: 780, label: '之后全是缓存命中', color: OK, y: 68, anchor: 'middle' }],
  caption: '输入没变就不重算 · 只有第一次付出代价'
}),

'timeline-orchestration': timeline({
  span: 2200, t0: 0,
  rows: [{ label: 'A / B', color: OUT, bars: [{ from: 100, to: 900, label: 'A' }, { from: 600, to: 1400, y: 12, h: 6, color: IN, label: 'B  -=0.3' }] },
         { label: 'C', color: OK, bars: [{ from: 1200, to: 2000, label: 'C' }] }],
  caption: '整条时间线可以一起暂停 · 倒放 · 变速'
}),

'undo-snackbar': timeline({
  span: 6000, t0: 0, scale: 0.55,
  rows: [{ label: '点删除', color: IN, at: [{ t: 100, label: '界面先移除' }] },
         { label: '真的删', color: OUT, bars: [{ from: 100, to: 5100, hollow: true, color: F, label: '5s 可撤销' }], at: [5100] }],
  caption: '先从界面拿掉 · 5s 内点撤销就还能回来'
}),

'toast-snackbar': timeline({
  span: 6000, t0: 0, scale: 0.55,
  rows: [{ label: '事件', color: IN, at: [100, 900] },
         { label: '浮现', color: OUT, bars: [{ from: 100, to: 3100, label: '4s 后自动消失' }, { from: 900, to: 3900, y: 12, h: 6 }] }],
  caption: '排队堆叠 · 到点自动移除（hover 时暂停计时）'
}),

'stale-while-revalidate': timeline({
  span: 1600, t0: 0,
  rows: [{ label: '界面', color: OUT, at: [{ t: 100, label: '旧数据秒开' }, { t: 900, label: '静默换新' }] },
         { label: '后台请求', color: F, bars: [{ from: 100, to: 900, label: '同时去拉最新' }] }],
  caption: '先给缓存里的旧数据 · 拿到新的再悄悄替换'
}),

'optimistic-ui': timeline({
  span: 1600, t0: 0,
  rows: [{ label: '界面', color: OUT, at: [{ t: 100, label: '立刻成功态' }, { t: 1000, label: '对账' }] },
         { label: '服务器', color: F, bars: [{ from: 100, to: 1000, label: '请求还在路上' }] }],
  marks: [{ t: 1000, label: '失败就回滚到快照', color: BAD, y: 68, anchor: 'middle' }],
  caption: '不等服务器就先渲染成功 · 失败再回滚'
}),

// ── 赛跑族 ───────────────────────────────────────────────────────────────

'easing': race({
  tracks: [{ label: 'linear', color: F, note: '匀速' },
           { label: 'ease-out', color: OUT, splines: EASE.expoOut, note: '先快后慢' }],
  caption: '同样距离同样时长 · 差别全在速度怎么分配'
}),

'cubic-bezier': race({
  tracks: [{ label: '.42 0 .58 1', color: F, splines: EASE.easeInOut, note: '两头慢' },
           { label: '.34 1.56 .64 1', color: OUT, pts: cubicPts(.34, 1.56, .64, 1), note: '冲过头再回' }],
  caption: '两个控制点决定整条速度曲线（y 可越界）'
}),

'timing-function-keywords': race({
  tracks: [{ label: 'ease', color: F, splines: EASE.ease },
           { label: 'ease-in', color: IN, splines: EASE.easeIn, note: '起步慢' },
           { label: 'ease-out', color: OUT, splines: EASE.easeOut, note: '收尾慢' }],
  caption: '关键字本质就是 cubic-bezier 的别名'
}),

'steps-easing': race({
  tracks: [{ label: 'linear', color: F, note: '连续' },
           { label: 'steps(5)', color: OUT, pts: stepPts(5), note: '5 级台阶' }],
  caption: '进度切成 n 段离散台阶 · 中间不插值'
}),

'linear-easing-function': race({
  tracks: [{ label: 'cubic-bezier', color: F, splines: EASE.easeInOut },
           { label: 'linear(…)', color: OUT, pts: [[0, 0], [.25, .35], [.5, .45], [.6, .9], [.75, .8], [1, 1]], note: '折线逼近' }],
  caption: '给一串采样点 · 点之间线性插值，能画贝塞尔画不出的形'
}),

'spring-physics': race({
  tracks: [{ label: '时长驱动', color: F, splines: EASE.easeOut, note: '到点即停' },
           { label: '弹簧', color: OUT, pts: springPts(), dur: 2200, note: '过冲再收敛' }],
  caption: '不设时长 · 由劲度与阻尼算出来什么时候停'
}),

'stiffness': race({
  tracks: [{ label: 'k 低', color: F, pts: springPts(26, 3, 1.5), dur: 2400, note: '软 · 慢' },
           { label: 'k 高', color: OUT, pts: springPts(26, 3, 3.4), dur: 2400, note: '紧 · 快' }],
  caption: '劲度越大回拉力越强 · 动画越快越紧绷'
}),

'damping': race({
  tracks: [{ label: '阻尼小', color: F, pts: springPts(30, 1.4, 3.2), dur: 2600, note: '晃很久' },
           { label: '临界阻尼', color: OUT, pts: springPts(26, 7, 0.9), dur: 2600, note: '不过冲' }],
  caption: '阻尼越大振荡衰减越快 · 阻尼比≈1 时既不过冲又最快'
}),

'spring-mass': race({
  tracks: [{ label: '质量小', color: F, pts: springPts(26, 4.4, 2.6), dur: 2200, note: '轻快' },
           { label: '质量大', color: OUT, pts: springPts(30, 2.2, 1.8), dur: 2800, note: '迟缓 · 摆更久' }],
  caption: '质量越大惯性越强 · 起步更迟、过冲后摆动更久'
}),

'overshoot': race({
  tracks: [{ label: '不过冲', color: F, splines: EASE.easeOut },
           { label: '过冲回弹', color: OUT, pts: cubicPts(.34, 1.56, .64, 1), note: '到位时弹一下' }],
  caption: '冲过目标再回摆 · 靠 y>1 的控制点或弹簧实现'
}),

'rubber-banding': race({
  tracks: [{ label: '硬边界', color: F, pts: [[0, 0], [.5, .82], [1, .82]], note: '到边就停' },
           { label: '橡皮筋', color: OUT, pts: [[0, 0], [.35, .82], [.5, .95], [.62, 1], [.8, .84], [1, .82]], note: '越界递减 · 松手弹回' }],
  caption: '越过边界后位移按阻尼递减地跟随 · 松手弹回'
}),

'momentum-scroll': race({
  tracks: [{ label: '松手即停', color: F, pts: [[0, 0], [.28, .38], [1, .38]] },
           { label: '惯性滚动', color: OUT, pts: [[0, 0], [.28, .38], ...decayPts(16).map(([t, v]) => [.28 + t * .72, .38 + v * .62])], note: '按摩擦衰减' }],
  caption: '松手时记下速度 · 之后每帧乘摩擦系数继续滑'
}),

'decay-animation': race({
  tracks: [{ label: '有目标点', color: F, splines: EASE.easeOut, note: '停在指定处' },
           { label: 'decay', color: OUT, pts: decayPts(22).map(([t, v]) => [t, v * .88]), dur: 2400, note: '落点算出来的' }],
  caption: '只给初速度和摩擦 · 落点由公式预测，不设终点'
}),

'interpolation': race({
  tracks: [{ label: 'lerp t=.5', color: F, pts: [[0, 0], [1, .5]], note: '中点' },
           { label: 'lerp t=1', color: OUT, note: 'a + (b-a)·t' }],
  caption: '在起止值之间按进度 t 算中间值 · 一切动画的地基'
}),

'tween': race({
  tracks: [{ label: '关键帧', color: F, pts: [[0, 0], [.49, 0], [.5, .5], [.99, .5], [1, 1]], note: '只有 3 张' },
           { label: '补间后', color: OUT, splines: EASE.easeInOut, note: '中间帧引擎算' }],
  caption: '只给首末状态 · 中间所有帧由引擎自动算出'
}),

'smooth-scroll': race({
  tracks: [{ label: '原生滚动', color: F, pts: [[0, 0], [.12, .3], [.24, .55], [.36, .78], [.48, 1], [1, 1]], note: '跟手即停' },
           { label: 'lerp 接管', color: OUT, pts: [[0, 0], [.15, .22], [.3, .45], [.5, .72], [.7, .88], [.85, .96], [1, 1]], note: '拖着惯性追' }],
  caption: '把当前值向目标做 lerp · 每帧追一点，永远差一口气'
})

}
