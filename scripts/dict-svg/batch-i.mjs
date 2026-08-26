// 批次 I · 给「录不出来」的动效词条手画替代图。
//
// 这些词条本来挂的是真组件实录（webm），但组件在选型台里坏了、录出来是错的。
// 与其留一段误导人的片子，不如手画一张说清楚它长什么样 ——
// 判据和内置那 162 条一样：**时序即语义**，节奏画错了比静态图更有害。
import { C, anim, appear, between, clipped, cursor, frame, r, scene, slab, txt } from './templates2.mjs'

const IN = C.in, OUT = C.out, F = C.faint, SL = C.slab

export const I = {

// PixelTrail「鼠标拖尾」——
// 组件的着色器里 trail = texture2D(mouseTrail,…).r 恒为 1，整块画布被涂成一个颜色，
// 完全不动鼠标截图也是实心的，所以既不是背景问题也不是颜色问题（两条都试过）。
// drei 的 useTrailTexture 没把纹理绑进 uniform，见素材库 known-issues。
'fx-PixelTrail': (() => {
  // **8000 字符是硬上限**（dict.ts 的 sanitizeSvg 会截断）。
  // 13×6 的格子逐个写 <rect> 是 22KB，直接超。所以：
  //   · 底格用 <pattern> 一次画完，不是 78 个 rect
  //   · 只给轨迹附近的格子写动画，远的不写
  //   · 格子做粗到 9×4
  const COLS = 9, ROWS = 4
  const W = 208, H = 66, X0 = 16, Y0 = 22
  const CW = W / COLS, CH = H / ROWS
  const path = [[300, .06, .3], [1000, .32, .78], [1700, .58, .22], [2400, .84, .7]]
  const px = (f) => X0 + f * W
  const py = (f) => Y0 + f * H
  const at = (cx, cy) => {
    let bt = 0, bd = 1e9
    for (let i = 0; i < path.length - 1; i++) {
      const [t0, ax, ay] = path[i], [t1, bx, by] = path[i + 1]
      for (let s = 0; s <= 10; s++) {
        const k = s / 10
        const d = (px(ax + (bx - ax) * k) - cx) ** 2 + (py(ay + (by - ay) * k) - cy) ** 2
        if (d < bd) { bd = d; bt = t0 + (t1 - t0) * k }
      }
    }
    return { t: bt, d: Math.sqrt(bd) }
  }
  let cells = ''
  for (let c = 0; c < COLS; c++) for (let rr = 0; rr < ROWS; rr++) {
    const cx = X0 + c * CW + CW / 2, cy = Y0 + rr * CH + CH / 2
    const { t, d } = at(cx, cy)
    if (d > 24) continue
    const on = Math.round(t + d * 4)              // 越远亮得越晚 → 一圈扩散
    const life = Math.round(950 - d * 14)         // 也退得更早 → 尾巴自然收窄
    cells += `<rect x="${r(X0 + c * CW + 1)}" y="${r(Y0 + rr * CH + 1)}" width="${r(CW - 2)}" height="${r(CH - 2)}" rx="1.5" fill="${OUT}" opacity="0">` +
      anim('opacity', [[0, 0], [on, 0], [on + 100, .95], [on + life, 0]]) + '</rect>'
  }
  const pat = `<defs><pattern id="ptg" width="${r(CW)}" height="${r(CH)}" patternUnits="userSpaceOnUse" x="${r(X0 + 1)}" y="${r(Y0 + 1)}">` +
    `<rect width="${r(CW - 2)}" height="${r(CH - 2)}" rx="1.5" fill="#171d2a"/></pattern></defs>`
  return scene(
    frame(X0 - 5, Y0 - 5, W + 10, H + 10, { fill: '#0b0e14' }) + pat +
    `<rect x="${r(X0)}" y="${r(Y0)}" width="${r(W)}" height="${r(H)}" fill="url(#ptg)"/>` + cells +
    cursor(path.map(([t, fx, fy]) => [t, px(fx), py(fy)]), { linger: 500 }) +
    txt(8, 104, '离指针越远的格子亮得越晚、退得越早，尾巴就收窄了', { size: 7, fill: F }),
    '鼠标划过处逐格点亮马赛克方块 · 随后拖出一条尾巴')
})()

}
