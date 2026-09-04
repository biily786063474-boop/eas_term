// 后端词条的示意图：**分层流向图**（调用方 → 服务 → 存储/下游）。
//
// ── 为什么不用前端那套「全景 → 区块」的镜头推进 ────────────────────────
// 镜头推进回答的是「这个手法用在页面的哪一块」。后端没有页面，
// 硬套只能编一个假的界面出来。这里回答的是另一个问题：
// **「它作用在哪一层，以及在那一层上发生了什么」**。
//
// 风格与前端那套一致（同一个 viewBox / 时长 / 配色），这样两类图放在一起不打架：
// viewBox 0 0 240 120 · dur 4000ms · repeatCount indefinite ·
// 底 #0f1218 · 描边 #2a2f3a · 弱文字 #8a8f99 · 强调 #e0a45e · 块 #33405e
//
// sanitizer 约束同前端那套：禁 <style>/<use>/on*，单条 ≤ 8000 字符
// （见 src/main/dict.ts:33）。**样式只能内联。**

const W = 240, H = 120
const DUR = '4000ms'
export const C = {
  bg: '#0f1218', line: '#2a2f3a', dim: '#8a8f99',
  hi: '#e0a45e', block: '#33405e', block2: '#1b2231',
  ok: '#5ec9a8',   // 后端那一类的分类色，用在"成功/正常"上
  bad: '#e07a7a'   // 失败/拒绝。**只用在真的表示失败的地方**，别当装饰
}

/** 三层的位置。左→右是一次请求的方向。 */
export const LANES = {
  client:  { x: 10,  y: 30, w: 46, h: 60, label: '调用方' },
  service: { x: 88,  y: 22, w: 64, h: 76, label: '服务' },
  store:   { x: 184, y: 30, w: 46, h: 60, label: '存储' }
}

/** 画三层的框和标题。`on` 指名哪一层是这条手法的主场，它会被点亮。 */
export function lanes(on, override = {}) {
  return Object.entries(LANES).map(([k, L0]) => {
    const L = { ...L0, ...(override[k] ?? {}) }
    const lit = k === on
    return `<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="3" fill="${C.block2}" `
      + `stroke="${lit ? C.hi : C.line}" stroke-width="${lit ? 1 : 0.7}"/>`
      + `<text x="${L.x + L.w / 2}" y="${L.y - 3}" font-size="6" text-anchor="middle" `
      + `fill="${lit ? C.hi : C.dim}">${L.label}</text>`
  }).join('')
}

/** 一条从 a 到 b 的请求：一个小方块沿直线跑过去。
 *  @param t  [出发, 到达] 两个时间点（0~1）
 *  @param col 颜色
 *  @param dashed 是否画一条虚线轨道 */
export function packet(ax, ay, bx, by, t, col = C.hi, r = 2) {
  const kt = `0;${t[0]};${t[1]};1`  // packet 本来就是 0…1 收尾，合法
  return `<circle r="${r}" fill="${col}" opacity="0">`
    + `<animate attributeName="opacity" values="0;1;1;0" keyTimes="${kt}" dur="${DUR}" repeatCount="indefinite"/>`
    + `<animate attributeName="cx" values="${ax};${ax};${bx};${bx}" keyTimes="${kt}" dur="${DUR}" repeatCount="indefinite"/>`
    + `<animate attributeName="cy" values="${ay};${ay};${by};${by}" keyTimes="${kt}" dur="${DUR}" repeatCount="indefinite"/></circle>`
}

/** 静态的连线轨道 */
export function track(ax, ay, bx, by, dash = false) {
  return `<path d="M${ax} ${ay} L${bx} ${by}" stroke="${C.line}" stroke-width="0.7" fill="none"`
    + (dash ? ' stroke-dasharray="2 2"' : '') + '/>'
}

/** 构造一对合法的 keyTimes / values。
 *
 *  ⚠️ **SMIL 的 keyTimes 必须以 0 开头、以 1 结尾，且个数与 values 相等。**
 *  任一条不满足，整条动画被判非法、**直接忽略、不报任何错**。
 *  第一版这里写了 `keyTimes="0;0.44;0.5;0.9;0.96"`（没到 1），
 *  于是熔断那道断口和幂等键的「已处理过」标签全是死的，看代码看不出来。
 *
 *  @param stops [时间, 值] 的序列，时间要在 (0,1) 之间递增
 *  @param edge  0 和 1 两端补什么值（一般是"看不见"的那个值）
 */
export function kv(stops, edge) {
  const times = [0, ...stops.map((s) => s[0]), 1]
  const vals = [edge, ...stops.map((s) => s[1]), edge]
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) throw new Error(`keyTimes 必须递增：${times.join(';')}`)
  }
  return `keyTimes="${times.join(';')}" values="${vals.join(';')}"`
}

/** 一行说明文字，钉在底部。**一句话说清这张图在演什么** —— 后端的机制
 *  光看方块动是猜不出来的，这行字不是装饰。 */
export function caption(text) {
  return `<text x="${W / 2}" y="${H - 5}" font-size="6.5" text-anchor="middle" fill="${C.dim}">${text}</text>`
}

/** 组装。 */
export function buildFlow(inner) {
  return `<svg viewBox="0 0 ${W} ${H}" font-family="sans-serif" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>` + inner + '</svg>'
}
export { DUR, W, H }

// ── 复用件 ────────────────────────────────────────────────────────────────
// 40 张图靠这几个拼，避免每张都手写坐标 —— 手写的那部分越多，
// 「某张图某个元素永远不显形」这类静默错误就越多（已经踩过两次）。

/** 层内的一个小方块 ＋ 居中文字 */
export function box(x, y, w, h, text = '', fill = C.block, col = C.dim, size = 5.5) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="${fill}"/>`
    + (text ? `<text x="${x + w / 2}" y="${y + h / 2 + 2}" font-size="${size}" text-anchor="middle" fill="${col}">${text}</text>` : '')
}
/** 只有描边的方块（表示"框住/圈定"而不是"实体"） */
export function outline(x, y, w, h, col = C.hi, text = '', size = 5.5) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="none" stroke="${col}" stroke-width="0.8"/>`
    + (text ? `<text x="${x + w / 2}" y="${y + h / 2 + 2}" font-size="${size}" text-anchor="middle" fill="${col}">${text}</text>` : '')
}
/** 竖着排 n 行（表格行 / 队列 / 列表） */
export function rows(x, y, w, n, h, gap, fill = C.block, op = 1) {
  return Array.from({ length: n }, (_, i) =>
    `<rect x="${x}" y="${(y + i * (h + gap)).toFixed(1)}" width="${w}" height="${h}" rx="0.8" fill="${fill}" opacity="${op}"/>`).join('')
}
/** 一段文字 */
export function text(x, y, t, col = C.dim, size = 5.5, anchor = 'middle') {
  return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${col}">${t}</text>`
}
/** 让一段内容在某个时间窗口里显形（用 kv 保证 keyTimes 合法） */
export function showAt(inner, from, to) {
  return `<g opacity="0"><animate attributeName="opacity" ${kv([[from, 0], [Math.min(from + 0.04, to), 1], [to, 1], [Math.min(to + 0.04, 0.999), 0]], 0)} dur="${DUR}" repeatCount="indefinite"/>${inner}</g>`
}
/** 一个属性在演示期内的动画 */
export function anim(attr, stops, edge) {
  return `<animate attributeName="${attr}" ${kv(stops, edge)} dur="${DUR}" repeatCount="indefinite"/>`
}
