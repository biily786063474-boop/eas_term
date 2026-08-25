// 名词词典「内置概念词条」的会动示意图 —— SMIL 积木。
//
// 为什么是手画 SMIL：新补的 145 条动效词条是真组件 CDP 实录（webm），
// 但内置这 242 条是**概念**（防抖、节流、骨架屏、虚拟列表），没有对应组件可录。
//
// ── 两条不能破的纪律 ──────────────────────────────────────────────────────
//
// **① keyTimes 必须 0 开头、1 结尾，个数与 values 相同。**
//    差一个，整条 <animate> 被判无效 —— 元素停在初始属性上，
//    不报错、不降级、不打日志。第一版防抖写成 `…;0.72;0.8`（没到 1），
//    所有竖条 opacity 恒为 0，图上只剩两条横线，截图发出来才发现。
//    → 所以本文件**不许手写 keyTimes**，一律走下面的 at()/seq() 生成。
//
// **② 动画时间 = 标注时间，1:1。不许为了「看得清」把节奏拉长。**
//    第一版防抖的静默期是输入间隔的 8.7 倍、节流标着「每 200ms」画的是 800ms。
//    图会动、语义也对，但读者建立的时间直觉是错的 —— 比静态图更有害。
//    看得清靠的是**元素留在原地不消失**（演完停住再淡出），不是靠放慢。
//
// ── 尺寸红线 ──────────────────────────────────────────────────────────────
// dict.ts 的 sanitizeSvg() 卡 **8000 字符**，超了静默截断。
// 所以这里所有 animate 都用 3 个值的 `0;0;1` 形态（靠 repeatCount 回到 0），
// 淡出交给外层 <g> 统一做 —— 每根条省 ~20 字符，20 根就是 400。

export const LOOP = 4000          // 全部词条统一 4s 循环，hover 体验一致
export const VB = { w: 240, h: 120 }

export const C = {
  axis: '#2a2f3a',                // 轴线、分隔
  dim: '#8a8f99',                 // 说明文字
  faint: '#525a68',               // 次要/对照/"之前"
  in: '#e0a45e',                  // 输入、触发、用户动作
  out: '#6ea8fe',                 // 输出、结果、系统响应
  ok: '#5ec27f',                  // 成功、命中
  bad: '#e0685e',                 // 失败、丢弃、掉帧
  slab: '#1e2430'                 // 占位块、卡片底
}

/** ms → keyTime。**唯一允许产生 keyTimes 数字的地方。** */
export const kt = (ms) => Math.min(1, Math.max(0, ms / LOOP)).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0')

/** 把 (时刻, 值) 列表编译成合法的 values/keyTimes 对。
 *  **自动补齐首尾**：不是 0 开头就在 0 处复制首值，不是 1 结尾就在 1 处复制末值。
 *  这就是纪律 ① 的机器实现 —— 调用方不可能写出非法 keyTimes。 */
export function seq(pairs) {
  const p = [...pairs].sort((a, b) => a[0] - b[0])
  if (p[0][0] > 0) p.unshift([0, p[0][1]])
  if (p.at(-1)[0] < LOOP) p.push([LOOP, p.at(-1)[1]])
  // 同一时刻只保留最后一个值。between(0, …) 这类写法会产出两个 0。
  // **实测 Chrome 容忍重复 keyTime，动画照跑** —— 一度以为这也会导致静默失效，
  // 拿坏例子跑校验器才发现不是（结论已订正）。留着去重只是为了输出干净、
  // keyTimes 严格递增符合规范，不是在修一个 bug。
  const out = []
  for (const [t, v] of p) {
    if (out.length && out.at(-1)[0] === t) out[out.length - 1] = [t, v]
    else out.push([t, v])
  }
  return { values: out.map((x) => x[1]).join(';'), keyTimes: out.map((x) => kt(x[0])).join(';') }
}

/** 生成一条 <animate>。dur 固定 LOOP、无限循环 —— 所有词条同一时间轴。
 *
 *  **keySplines 的个数必须正好是 values.length - 1**，否则同样静默失效。
 *  而 seq() 会自动补首尾、把段数改掉 —— 所以这里只接受**一条** spline，
 *  由本函数按实际段数复制。调用方给数组是错的，直接拒绝，别让它悄悄跑过去。 */
export function anim(attr, pairs, opt = {}) {
  const { values, keyTimes } = seq(pairs)
  const tag = opt.transform ? 'animateTransform' : 'animate'
  let extra = opt.transform ? ` type="${opt.transform}"` : ''
  if (opt.splines) {
    if (opt.splines.includes(';')) throw new Error('splines 只给一条，段数由 anim() 按 seq() 的结果补齐')
    // **keySplines 的四个控制点必须都在 [0,1]。** CSS 的 cubic-bezier 允许 y 越界
    // （back/弹性缓动就靠这个过冲），SMIL 不允许 —— 越界的整条动画被判无效，
    // 又是静默失效。想要过冲请改用 cubicPts() 采样成 values，绕开 keySplines。
    const bad = opt.splines.trim().split(/\s+/).map(Number).filter((v) => !(v >= 0 && v <= 1))
    if (bad.length) throw new Error(`keySplines 控制点必须在 [0,1]，越界值：${bad.join(', ')} —— 过冲请用 cubicPts()`)
    const segs = values.split(';').length - 1
    extra += ` calcMode="spline" keySplines="${Array(segs).fill(opt.splines).join(';')}"`
  }
  return `<${tag} attributeName="${attr}"${extra} values="${values}" keyTimes="${keyTimes}" dur="${LOOP}ms" repeatCount="indefinite"/>`
}

/** 「在 t 时刻出现，之后一直在」。淡入 40ms —— 比一次真实点击还快，不影响读时序。 */
export const appear = (t, fade = 40) => anim('opacity', [[0, 0], [t, 0], [t + fade, 1]])

/** 「t1 出现、t2 消失」。 */
export const between = (t1, t2, fade = 60) =>
  anim('opacity', [[0, 0], [t1, 0], [t1 + fade, 1], [t2, 1], [t2 + fade, 0]])

/** 演完统一淡出的外壳。**动作要在 hold 之前演完**，剩下的时间留给「看清楚」。 */
export function stage(inner, hold = 3400, fade = 300) {
  // 收尾不用手动跳回 1：repeatCount 让下一轮从 values[0] 也就是 1 重新开始。
  return `<g>${inner}${anim('opacity', [[0, 1], [hold, 1], [hold + fade, 0]])}</g>`
}

/** 竖条脉冲 —— 时间轴上的一次事件。 */
export const tick = (x, y, t, color, h = 20, w = 3) =>
  `<rect x="${r(x)}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${color}">${appear(t)}</rect>`

/** 触发时刻的涟漪，把眼睛引到「就是这里发生了」。 */
export const ripple = (cx, cy, t, color, r0 = 12) =>
  `<circle cx="${r(cx)}" cy="${cy}" r="0" fill="none" stroke="${color}" stroke-width="1.5">` +
  anim('r', [[0, 0], [t, 0], [t + 260, r0]]) +
  anim('opacity', [[0, 0], [t, 0], [t + 50, 0.85], [t + 260, 0]]) + '</circle>'

export const txt = (x, y, s, o = {}) =>
  `<text x="${r(x)}" y="${y}" font-size="${o.size ?? 8}" fill="${o.fill ?? C.dim}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${s}</text>`

export const line = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${o.stroke ?? C.axis}"${o.w ? ` stroke-width="${o.w}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`

export const rect = (x, y, w, h, o = {}) =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${o.rx ?? 2}" fill="${o.fill ?? C.slab}"${o.stroke ? ` stroke="${o.stroke}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}>${o.inner ?? ''}</rect>`

/** 小数留一位就够 —— 每个数字省 1~2 字符，一张图几十个数字，顶着 8000 上限时是真差别。 */
export const r = (n) => (Math.round(n * 10) / 10).toString()

/** 把任意三次贝塞尔缓动采样成 [进度, 值] 点列。
 *  **过冲类缓动（y>1）只能走这条路** —— keySplines 不收越界控制点。
 *  按参数 s 均匀采样而不是按时间：X(s) 天然非匀速，正好就是缓动本身的疏密。 */
export function cubicPts(x1, y1, x2, y2, n = 22) {
  const B = (a, b, s) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n
    return [+B(x1, x2, s).toFixed(3), +B(y1, y2, s).toFixed(3)]
  })
}

/** 估算一段文字的像素宽。**只是估算**，但足够用来给左栏留位 ——
 *  行名写死 36px 那一版，`transform` 和 `left / width` 都被第一根条压住了。
 *  中日韩字符按 1em 算，ASCII 按 0.52em（等宽数字和大写会略宽，往大了估不吃亏）。 */
export const textW = (s, size = 8.5) =>
  [...String(s)].reduce((w, ch) => w + size * (/[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.52), 0)

export const svg = (body, caption) =>
  `<svg viewBox="0 0 ${VB.w} ${VB.h}" font-family="sans-serif" xmlns="http://www.w3.org/2000/svg">` +
  body + (caption ? txt(8, 114, caption) : '') + '</svg>'

/** 模拟指针。**不用真实鼠标** —— 词典是 hover 就看完，用户手不动。
 *  pts = [[t, x, y], …]。<g> 上没有 x/y 属性，位移只能走 animateTransform。 */
export function cursor(pts, opt = {}) {
  const at = pts.map((p) => [p[0], `${r(p[1])},${r(p[2])}`])
  const t0 = pts[0][0], t1 = pts.at(-1)[0]
  // 指针停在原地是正当用法（出现→点一下→消失），但那样 animateTransform 就成了
  // 「从 A 动到 A」的死动画 —— 校验会判它静默失效，而且它本来也没意义。
  // 位置不变时直接给静态 transform。
  const still = at.every(([, v]) => v === at[0][1])
  const move = still
    ? `<g transform="translate(${at[0][1].replace(',', ' ')})">`
    : `<g>${anim('transform', at, { transform: 'translate', splines: opt.splines ?? '.4 0 .2 1' })}`
  return `<g>${anim('opacity', [[0, 0], [Math.max(0, t0 - 120), 0], [t0, 1], [t1 + (opt.linger ?? 500), 1], [t1 + (opt.linger ?? 500) + 200, 0]])}` +
    move +
    `<path d="M0 0 L0 11 L3 8.4 L5 12.6 L7 11.7 L5 7.6 L8.4 7.4 Z" fill="#f0f2f6" stroke="#11141a" stroke-width=".7"/>` +
    `</g></g>`
}

/** 指针在某处「按下」的视觉：光标缩一下 + 涟漪。配合 cursor() 用。 */
export const click = (x, y, t, color = '#f0f2f6') =>
  `<circle cx="${r(x)}" cy="${r(y)}" r="0" fill="none" stroke="${color}" stroke-width="1.4">` +
  anim('r', [[0, 0], [t, 0], [t + 300, 11]]) +
  anim('opacity', [[0, 0], [t, 0], [t + 40, 0.9], [t + 300, 0]]) + '</circle>'
