// 校验器自测：把真实踩过的坏例子跑一遍，确认 verify.mjs 还抓得住。
//
// **为什么需要这个**：改校验器的采样方式时（均匀撒点 → 按 keyTimes 采点），
// 很容易在修误报的同时把真问题也放过去。而「抓不到问题的校验」比没有校验更糟 ——
// 它给你一个绿勾，让你不再去看。
//
//   node scripts/dict-svg/selftest.mjs
import { verify } from './verify.mjs'

const S = (inner, extra = '') =>
  `<svg viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg">${extra}${inner}</svg>`
const A = (attr, values, keyTimes, more = '') =>
  `<animate attributeName="${attr}" values="${values}" keyTimes="${keyTimes}"${more} dur="4000ms" repeatCount="indefinite"/>`

const BAD = {
  // keyTimes 不以 1 结尾 —— 第一版防抖/节流就是这样，图上只剩两条横线
  'keyTimes 没到 1': S(`<rect x="10" y="10" width="20" height="20" opacity="0">${A('opacity', '0;1;1;0', '0;0.05;0.72;0.8')}</rect>`),
  // keySplines 控制点越界 —— CSS 的 cubic-bezier 允许，SMIL 不允许
  'keySplines 越界': S(`<circle cx="10" cy="10" r="5">${A('cx', '10;200', '0;1', ' calcMode="spline" keySplines="0.34 1.56 0.64 1"')}</circle>`),
  // 从 A 动到 A —— 指针停在原地、scale 1→1 都会写出这种空动画
  '从 A 动到 A': S(`<g><animateTransform attributeName="transform" type="translate" values="5,5;5,5" keyTimes="0;1" dur="4000ms" repeatCount="indefinite"/><rect width="9" height="9"/></g>`),
  // 被 sanitizeSvg 剥掉标签
  '过不了清洗': S(`<rect x="10" y="10" width="9" height="9">${A('x', '10;100', '0;1')}</rect>`, '<script>x=1</script>'),
  // 超 8000 字符会被静默截断
  '超字数上限': S(`<rect x="10" y="10" width="9" height="9">${A('x', '10;100', '0;1')}</rect>`, '<rect x="1" y="1" width="1" height="1"/>'.repeat(230))
}

// 这些**必须判过**。误报会逼人去改本来没问题的图。
const GOOD = {
  '普通淡入淡出': S(`<rect x="10" y="10" width="20" height="20" opacity="0">${A('opacity', '0;0;1;1;0', '0;0.05;0.1;0.8;1')}</rect>`),
  // 只亮 120ms 的字符：均匀撒 24 点会漏掉（每点相隔 167ms），按 keyTimes 采就不会。
  // 注意 keyTimes 仍要补到 1 —— 第一版这个 fixture 结尾写成 0.235，
  // 结果它本身就是非法的，被校验器判挂。**是样例写错了，不是校验器误伤。**
  '一闪而过的元素': S(`<text x="10" y="20" opacity="0">#${A('opacity', '0;0;1;1;0;0', '0;0.2;0.205;0.23;0.235;1')}</text>`),
  // 重复 keyTime：实测 Chrome 容忍，动画照跑 —— 一度误以为这也会失效
  '重复 keyTime': S(`<rect x="10" y="10" width="20" height="20" opacity="0">${A('opacity', '0;0;1;1;0;0', '0;0;0.035;0.225;0.26;1')}</rect>`),
  // 只改高度（手风琴展开）：快照里漏了 bb.height 的那一版会误判它死了
  '只改高度': S(`<rect x="10" y="10" width="40" height="0">${A('height', '0;0;30;30', '0;0.2;0.4;1')}</rect>`),
  // 只改纵向位置
  '只改纵坐标': S(`<rect x="10" width="40" height="10" y="0">${A('y', '10;10;60;60', '0;0.2;0.5;1')}</rect>`),
  // 描边推进（SVG 路径绘制）：宿主快照看不出来，得读 stroke-dashoffset
  '只改描边偏移': S(`<path d="M10 10 L200 90" stroke="#fff" fill="none" stroke-dasharray="220">${A('stroke-dashoffset', '220;220;0;0', '0;0.1;0.7;1')}</path>`),
  // 滤镜参数：既不在计算样式里，也不在 bbox 里，只能读 animVal
  '只改滤镜参数': S(`<g filter="url(#f1)"><rect x="10" y="10" width="30" height="30" fill="#fff"/></g>`,
    `<defs><filter id="f1"><feGaussianBlur stdDeviation="0">${A('stdDeviation', '0;6;0;0', '0;0.3;0.6;1')}</feGaussianBlur></filter></defs>`),
  // 沿路径运动：没有 attributeName，产生的是附加变换 —— 只有屏幕坐标看得见
  '沿路径运动': S(`<path id="p1" d="M10 10 L200 90" fill="none" stroke="#333"/><g><rect width="8" height="8" fill="#fff"/><animateMotion dur="4000ms" repeatCount="indefinite"><mpath href="#p1"/></animateMotion></g>`)
}

const bad = await verify(BAD)
const caught = new Set(bad.fails.map((f) => f.split(':')[0]))
let ok = true
for (const k of Object.keys(BAD)) {
  if (!caught.has(k)) ok = false
  console.log(`  ${caught.has(k) ? '✓ 抓到' : '✗ 漏掉'}  ${k}`)
}
const good = await verify(GOOD)
const wrong = new Set(good.fails.map((f) => f.split(':')[0]))
for (const k of Object.keys(GOOD)) {
  if (wrong.has(k)) ok = false
  console.log(`  ${wrong.has(k) ? '✗ 误伤' : '✓ 放行'}  ${k}`)
}
console.log(ok ? '\n  ✓ 校验器可信：坏例子全抓到，好例子没误伤' : '\n  ✗ 校验器有盲区或会误伤，先修它再谈别的')
process.exit(ok ? 0 : 1)
