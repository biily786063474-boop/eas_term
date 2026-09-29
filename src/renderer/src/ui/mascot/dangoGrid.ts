// 像素团子（Eas-Term 吉祥物）的网格定义。纯函数，不碰 DOM —— 形状、状态、尺寸规则都在这里，有测试。
// 设计稿：docs/design/mascot/2026-09-28-island-dango.html（v17，用户逐轮定稿）。
//
// 网格 24 × 20 格，每格 4 个 viewBox 单位。只输出「实心格」的路径，镂空处（眼睛、嘴）就是真透明，
// 所以只需要一种颜色：fill=currentColor，放在哪儿就跟着哪儿的文字色走，不写死颜色。

export type DangoState = 'idle' | 'run' | 'wait' | 'done' | 'bg' | 'err'

/** 一帧里会变的东西：光标耳是否亮、眼睛横移、是否闭眼 */
export interface DangoFrame { earOn?: boolean; eyeDx?: number; closed?: boolean }

export const CELL = 4
const COLS = 24

/** 72px 及以下不画脚（用户定），同时裁掉底部两行 */
export const FEET_MIN_PX = 73

type Cell = readonly [number, number]

function span(out: Cell[], y: number, a: number, b: number): void { for (let x = a; x <= b; x++) out.push([x, y]) }

/** 身体 + 右耳（不含会闪的左耳） */
function bodyCells(): Cell[] {
  const c: Cell[] = []
  span(c, 4, 4, 19); span(c, 5, 3, 20); for (let y = 6; y <= 15; y++) span(c, y, 2, 21); span(c, 16, 3, 20); span(c, 17, 4, 19)
  span(c, 2, 16, 17); span(c, 3, 15, 18) // 右耳：两行，4 宽 + 顶上 2 宽
  return c
}

/** 左耳 = 块状光标（运行中会闪），和右耳同形 */
function earCells(): Cell[] { const c: Cell[] = []; span(c, 2, 6, 7); span(c, 3, 5, 8); return c }

function feetCells(): Cell[] { const c: Cell[] = []; span(c, 19, 4, 9); span(c, 19, 14, 19); return c }

/** 脸上要镂空的格。眼睛 2×4 竖块放在 11–14 行，嘴 2 格宽紧贴眼睛下沿（15 行） */
export function faceHoles(state: DangoState, frame: DangoFrame = {}): Cell[] {
  const h: Cell[] = []
  const dx = frame.eyeDx ?? 0
  const L = 7 + dx, R = 15 + dx
  const eye = (x0: number, y0: number): void => { for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 2; x++) h.push([x, y]) }
  if (frame.closed || state === 'bg') { for (const x0 of [L, R]) span(h, 13, x0 - 1, x0 + 2) }
  else if (state === 'done') { for (const x0 of [L, R]) h.push([x0 - 1, 13], [x0, 12], [x0 + 1, 12], [x0 + 2, 13]) }
  else if (state === 'err') { for (const x0 of [L, R]) for (const [ox, y] of [[-1, 11], [2, 11], [0, 12], [1, 12], [0, 13], [1, 13], [-1, 14], [2, 14]] as const) h.push([x0 + ox, y]) }
  else if (state === 'wait') { eye(L, 10); eye(R, 10) }
  else { eye(L, 11); eye(R, 11) }
  if (state !== 'err') h.push([11, 15], [12, 15])
  return h
}

export interface DangoShape { path: string; viewBox: string; width: number; height: number }

/** 状态 + 尺寸 + 当前帧 → 一条 SVG 路径（每行连续格合成一段，省节点） */
export function dangoShape(state: DangoState, size: number, frame: DangoFrame = {}): DangoShape {
  const feet = size >= FEET_MIN_PX
  const on = new Set<string>()
  const add = (cells: Cell[]): void => { for (const [x, y] of cells) on.add(x + ',' + y) }
  add(bodyCells())
  if (frame.earOn !== false) add(earCells())
  if (feet) add(feetCells())
  for (const [x, y] of faceHoles(state, frame)) on.delete(x + ',' + y)
  let d = ''
  for (let y = 0; y < 20; y++) {
    let x = 0
    while (x < COLS) {
      if (!on.has(x + ',' + y)) { x++; continue }
      let end = x
      while (end + 1 < COLS && on.has(end + 1 + ',' + y)) end++
      const w = (end - x + 1) * CELL
      d += `M${x * CELL} ${y * CELL}h${w}v${CELL}h-${w}z`
      x = end + 1
    }
  }
  const top = 2 * CELL // 头顶两行永远是空的（两只短耳从第 2 行开始）
  const vbH = (feet ? 20 : 18) * CELL - top
  return { path: d, viewBox: `0 ${top} ${COLS * CELL} ${vbH}`, width: size, height: Math.round(size * vbH / (COLS * CELL)) }
}

/** 每个状态的帧序列：[帧, 持续毫秒]。只有 idle / run 会动；其余状态静止（动作少 = 常驻开销少）。 */
export function dangoTimeline(state: DangoState): Array<[DangoFrame, number]> {
  if (state === 'run') {
    // 光标耳按终端光标的节奏闪（530ms），眼睛每两次闪烁换一次方向：像在读滚动的输出
    const out: Array<[DangoFrame, number]> = []
    for (const eyeDx of [0, -1, 0, 1]) { out.push([{ earOn: true, eyeDx }, 530], [{ earOn: false, eyeDx }, 530]) }
    return out
  }
  if (state === 'idle') return [[{}, 3600], [{ closed: true }, 160]]
  return [[{}, 0]]
}
