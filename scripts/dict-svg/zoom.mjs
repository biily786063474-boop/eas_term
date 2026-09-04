// 生成「全景界面 → 区块」的镜头推进示意图（词条 hover 预览用）。
//
// ── 为什么不是动画 viewBox ──────────────────────────────────────────────
// 那是最自然的写法，但 **Blink 不支持 SMIL 动画 viewBox** —— 2026-09-04 实测：
// `<animate attributeName="viewBox">` 跑起来了（animationsPaused() 为 false），
// 但 `svg.viewBox.animVal` 全程等于 baseVal，画面纹丝不动，**且不报任何错**。
// 改用嵌套两层 <g>：外层 translate、内层 scale，合成出来就是镜头。
//
//   屏幕坐标 = translate + scale × 图形坐标
//   要让区域 (rx,ry,rw,rh) 铺满画布 (W,H)：
//     s  = min(W/rw, H/rh)
//     tx = -rx*s + (W - rw*s)/2      ty = -ry*s + (H - rh*s)/2
//
// ── 风格必须和已有的 243 张一致 ─────────────────────────────────────────
// viewBox 0 0 240 120 · dur 4000ms · repeatCount indefinite ·
// 底 #0f1218 · 描边 #2a2f3a · 弱文字 #8a8f99 · 强调 #e0a45e · 块填充 #26314a
//
// ── sanitizer 的约束（src/main/dict.ts:33）────────────────────────────
// 禁 <style> <use> <image> <script> <foreignObject>、禁 on* 属性、
// 禁指向外部的 href。**所以样式只能内联，图形不能复用**。单条上限 8000 字符。

const W = 240, H = 120
const DUR = '4000ms'
const C = {
  bg: '#0f1218', line: '#2a2f3a', dim: '#8a8f99',
  hi: '#e0a45e',
  // 演示层用的块色**比全景骨架亮一档** —— 全景被压到 .22 之后，
  // 用同一个色会糊在一起（实测）。
  block: '#33405e', block2: '#1b2231', text: '#5b6270'
}
/** 镜头时间轴：全景 → 推进 → 演示 → 拉回。keyTimes 五个点对应五个机位。 */
const KT = '0;0.18;0.34;0.86;1'
const EASE = 'calcMode="spline" keySplines=".4 0 .2 1;.4 0 .2 1;.4 0 .2 1;.4 0 .2 1"'

/** 一张全景里的各个区块：名字 → [x,y,w,h]。**这就是「区块」标签在图上的样子**。 */
const MOBILE_FRAME = [93, 6, 54, 108]
const M = {
  '导航栏':  [95, 8, 50, 10],
  '搜索':    [97, 20, 46, 8],
  '首屏':    [95, 30, 50, 20],
  '轮播':    [95, 30, 50, 20],
  '图集':    [95, 30, 50, 20],
  '金刚区':  [95, 52, 50, 16],
  '列表':    [95, 70, 50, 28],
  '卡片':    [97, 71, 46, 12],
  '空状态':  [95, 52, 50, 30],
  '表单':    [95, 30, 50, 46],
  '按钮':    [97, 88, 46, 10],
  '弹层':    [95, 60, 50, 38],
  '标签栏':  [95, 100, 50, 12]
}
const DESKTOP_FRAME = [12, 10, 216, 100]
const D = {
  '导航栏':  [14, 12, 212, 12],
  '搜索':    [150, 14, 60, 8],
  '侧边栏':  [14, 26, 40, 82],
  '首屏':    [56, 26, 170, 34],
  '卡片':    [58, 62, 52, 22],
  '表格':    [56, 26, 170, 60],
  '列表':    [56, 26, 170, 60],
  '空状态':  [56, 30, 170, 50],
  '表单':    [56, 26, 100, 70],
  '按钮':    [58, 92, 34, 10],
  '弹层':    [70, 30, 100, 60],
  '页脚':    [14, 96, 212, 12],
  '图集':    [56, 26, 170, 44]
}

/** 画全景骨架。目标区块之外的都画得很淡 —— **对比度就是「这块在哪」的全部信息**。 */
function panorama(platform, target) {
  const [fx, fy, fw, fh] = platform === '移动' ? MOBILE_FRAME : DESKTOP_FRAME
  const map = platform === '移动' ? M : D
  const parts = [
    `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${platform === '移动' ? 6 : 3}" fill="${C.block2}" stroke="${C.line}"/>`
  ]
  // 骨架块：**按固定顺序画，目标那块最后画**，免得被别的盖住
  const order = Object.keys(map).filter((k) => k !== target)
  const seen = new Set()
  for (const k of order) {
    const key = map[k].join(',')
    if (seen.has(key)) continue // 多个区块共用同一块地方（首屏/轮播/图集），只画一次
    seen.add(key)
    const [x, y, w, h] = map[k]
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${C.block}" opacity=".38"/>`)
  }
  return parts.join('')
}

/** 目标区块的高亮框：全景阶段亮起，**镜头一到位就淡掉**。
 *  它的线宽不跟着缩放走，推进后会变成一条很粗的橙边把画面框死（实测过），
 *  所以淡出必须排在推进结束（0.34）之后一点点，不能拖到拉回时才淡。 */
function marker(r) {
  const [x, y, w, h] = r
  return `<rect x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}" rx="2" fill="none" stroke="${C.hi}" stroke-width="1">`
    + `<animate attributeName="opacity" values="0;1;1;0;0;0" keyTimes="0;0.18;0.30;0.42;0.92;1" dur="${DUR}" repeatCount="indefinite"/></rect>`
}

/** 有些区块是**又宽又扁的横条**（桌面的导航栏、页脚：212×12）。
 *  按 `min(W/rw, H/rh)` 算出来的倍数被宽度卡死在 1.13 —— 等于没推进。
 *  给它们单独配一个**居中的、窄一些的镜头框**：接受左右被裁掉，
 *  换来看得清。裁掉的部分不重要，横条的内容本来就是重复的。 */
/** **倍数低于 2 就等于没推进** —— 生成时有断言兜着（见 buildSvg 末尾）。
 *  宽条裁左右、高条裁上下，裁掉的都是重复内容。 */
const CAM = {
  '页脚':   [72, 92, 96, 20],   // 212×12 → 1.13x，裁成 96 宽 → 2.50x
  '导航栏': [72, 8, 96, 20],    // 同上
  '表格':   [56, 26, 110, 46],  // 170×60 被宽度卡在 1.41x → 2.18x（左对齐，演示都画在左边）
  '侧边栏': [11, 26, 46, 48]    // 40×82 被高度卡在 1.46x → 2.50x
}

/** 镜头。返回 [开标签, 闭标签]，中间夹要被推进的内容。 */
function camera(r) {
  const [rx, ry, rw, rh] = r
  const s = Math.min(W / rw, H / rh)
  const tx = -rx * s + (W - rw * s) / 2
  const ty = -ry * s + (H - rh * s) / 2
  const f = (n) => +n.toFixed(2)
  const open =
    `<g><animateTransform attributeName="transform" type="translate" ${EASE} `
    + `values="0,0;0,0;${f(tx)},${f(ty)};${f(tx)},${f(ty)};0,0" keyTimes="${KT}" dur="${DUR}" repeatCount="indefinite"/>`
    + `<g><animateTransform attributeName="transform" type="scale" ${EASE} `
    + `values="1;1;${f(s)};${f(s)};1" keyTimes="${KT}" dur="${DUR}" repeatCount="indefinite"/>`
  return [open, '</g></g>']
}

/** 演示层：只在镜头推到位之后显形。stroke 宽度要除以放大倍数，否则放大后边框会变成一堵墙。 */
function detailWrap(r, inner) {
  const [, , rw, rh] = r  // 线宽按**实际镜头框**换算，和 camera() 用同一个 r
  const s = Math.min(W / rw, H / rh)
  return `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${KT}" dur="${DUR}" repeatCount="indefinite"/>`
    + inner.replace(/__SW__/g, (1 / s * 1.2).toFixed(3))
    + '</g>'
}

export function buildSvg({ platform, block, detail, cam: camOverride }) {
  const map = platform === '移动' ? M : D
  const r = map[block]
  if (!r) throw new Error(`「${platform}」全景里没有「${block}」这块地方`)
  // 桌面的横条用居中的镜头框，其余就用区块本身
  // **镜头框可以按词条单独给。** 同一个区块里，不同手法演示的位置不一样：
  // 页脚的「回到顶部」在最右边、「页脚折叠分组」在最左边，用同一个框必然框空一个。
  // 演示层仍然按**区块坐标**画（不重写演示），只是镜头看哪一块可以调。
  const cam = camOverride ?? CAM[block] ?? r
  const zoom = Math.min(W / cam[2], H / cam[3])
  // **低于 2 倍的"推进"看起来就是没动。** 这条断言逼着新增区块时把镜头框配对，
  // 而不是等到肉眼发现"这张图怎么不动"。
  if (zoom < 2) throw new Error(`「${block}」的镜头只有 ${zoom.toFixed(2)}x，给它配一个 CAM 框`)
  const [open, close] = camera(cam)
  return `<svg viewBox="0 0 ${W} ${H}" font-family="sans-serif" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>`
    + open
    // **推进后要把全景压暗。** 骨架块和演示层用的是同一档蓝（#26314a），
    // 不压的话演示画上去几乎看不见 —— 表格那几张实测就是"看起来是空的"。
    + `<g><animate attributeName="opacity" values="1;1;.22;.22;1" keyTimes="${KT}" dur="${DUR}" repeatCount="indefinite"/>`
    + panorama(platform, block)
    + '</g>'
    + marker(r)
    + detailWrap(cam, detail(r, C))
    + close
    + '</svg>'
}
export { C, KT, DUR, M, D }
