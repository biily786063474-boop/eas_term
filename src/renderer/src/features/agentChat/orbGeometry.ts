// 「正在处理」那颗球的几何：一个点阵球面，若干「层」像魔方一样依次拧过去，
// 拧到底之后再逐层拧回来，循环。参考 https://orbs.jakubantalik.com 的 `solving`
// 形态（组件里内部叫 `rubik`），按它的公式与调参值实现。
//
// **这里不碰 DOM，也不引 React** —— `node --test` 直接跑。画布那一侧
// （ThinkingOrb.tsx）只负责把 buildOrb() 吐出来的点画出去，不做任何几何判断。
// 分开是因为这类东西一旦混在组件里，「转得对不对」就只能靠盯着屏幕看，
// 而它每一帧都在变，肉眼分不出「慢了 10%」和「拧错了轴」。

/** 一个「层」：绕哪根轴、切片的坐标区间、拧多少度 */
export interface Move {
  /** 0=x 1=y 2=z */
  axis: 0 | 1 | 2
  /** 切片区间 [lo, hi)，在该轴的坐标上取 */
  lo: number
  hi: number
  /** 拧到底的角度（±90°） */
  ang: number
}

export interface OrbConfig {
  /** 纬线圈数 */
  latRings: number
  /** 赤道上的经向点数（往两极按 cos 收窄） */
  lonDensity: number
  /** 一轮里拧几层 */
  moveCount: number
  /** 点的基础半径 */
  rBase: number
  /** 点半径随「离观察者多近」增加多少 */
  rDepth: number
  /** 正在拧的那一层，点额外放大多少 */
  rActive: number
  /** 最远处的墨色（0=最亮，1=最暗；见 lum 的换算） */
  inkFar: number
  /** 从最远到最近墨色变化的跨度 */
  inkSpan: number
  /** 点半径随画布尺寸缩放的指数 */
  rsPow: number
  /** 点半径下限，低于这个画出来会闪 */
  rMin: number
}

/** 参考站 `solving` 的原始参数 */
export const SOLVING: OrbConfig = {
  latRings: 15,
  lonDensity: 40,
  moveCount: 14,
  rBase: 0.6,
  rDepth: 1.7,
  rActive: 0.3,
  inkFar: 0.62,
  inkSpan: 0.54,
  rsPow: 0.6,
  rMin: 0.3
}

/**
 * 摆进对话流那一档的调参（28px）。
 *
 * 参考站只给了两档：64px（count .35 / size 1.05 / speed 1.82）和
 * 20px（count .088 / size 1.9 / speed 1.95）。**照搬 20px 那档不行** ——
 * 实测渲染成图对比过：20px 档只有 30 个点，缩到我们这个尺寸就是一团散点，
 * 完全看不出是个球，更看不出「有一层正在拧」。这是这个动效唯一的信息量。
 *
 * 所以这一档是按 28px 重新调的：点数往回加（count .2 ≈ 80 个点），单点相应调细
 * （size 1.35），转速取两档之间。一个完整周期（打乱 14 层 + 复原 + 停顿）约 6.8 秒。
 */
export const INLINE_TUNING = { speed: 1.9, count: 0.2, size: 1.35 }

/** 参考站那支 hash —— 用它而不用 Math.random 是因为**每帧都要重算这批层**，
 *  必须是同一个序列，否则球面会每帧换一套拧法，看起来像在抽搐。 */
export function hash(i: number, seed: number): number {
  const n = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
  return n - Math.floor(n)
}

/** 造出这一轮要拧的那些层。纯函数、只依赖下标，所以每帧算出来都一样。 */
export function makeMoves(count: number): Move[] {
  const out: Move[] = []
  for (let i = 0; i < count; i++) {
    const axis = Math.min(2, Math.floor(hash(i, 2.3) * 3)) as 0 | 1 | 2
    const lo = -1 + 0.5 * Math.min(3, Math.floor(hash(i, 5.9) * 4))
    out.push({ axis, lo, hi: lo + 0.5, ang: (hash(i, 7.7) < 0.5 ? 1 : -1) * (Math.PI / 2) })
  }
  return out
}

export interface MoveProgress {
  /** 每一层此刻拧到了几成（0..1） */
  amount: number[]
  /** 此刻正在拧的是第几层；-1 = 停顿期，谁都没在动 */
  active: number
}

/**
 * 一轮的节奏：先逐层拧到底（打乱），再逐层拧回去（复原），最后停顿一下再来。
 *
 * 一个周期 = `2 × 层数 × step + pause`。前半程 s∈[0,n) 是打乱、后半程是复原，
 * 复原时把同一层的 amount 从 1 退回 0 —— 所以「拧回去」不是新算一套反向的层，
 * 而是**同一层倒着放**，球面必然精确回到原位。
 */
export function moveProgress(
  t: number,
  count: number,
  step = 0.42,
  pause = 1.2
): MoveProgress {
  const cycle = 2 * count * step + pause
  const u = t % cycle
  const amount = new Array<number>(count).fill(0)
  if (u >= 2 * count * step) return { amount, active: -1 } // 停顿期
  const s = Math.floor(u / step)
  const f = (u - s * step) / step
  // 每一层在自己那格时间的前 70% 里拧完，剩下 30% 是留白 ——
  // 没有这段留白，层与层之间衔接得太紧，看着像一直在糊
  const h = 1 - (1 - Math.min(1, f / 0.7)) ** 3
  if (s < count) {
    for (let i = 0; i < s; i++) amount[i] = 1
    amount[s] = h
    return { amount, active: s }
  }
  const p = 2 * count - 1 - s
  for (let i = 0; i < p; i++) amount[i] = 1
  amount[p] = 1 - h
  return { amount, active: p }
}

/** 把所有已生效的层依次作用到一个点上。
 *  返回 `[x, y, z, onActiveLayer]` —— 最后一位是「这个点在正被拧的那层上吗」，
 *  用来把当前这层画得更大更亮，人眼才跟得上是哪一片在动。 */
export function applyMoves(
  p: readonly [number, number, number],
  moves: readonly Move[],
  prog: MoveProgress
): [number, number, number, boolean] {
  let [x, y, z] = p
  let onActive = false
  for (let i = 0; i < moves.length; i++) {
    if (prog.amount[i] <= 0) continue
    const m = moves[i]
    // **按当前坐标判断在不在切片里**（不是按原始坐标）—— 前面的层已经把它转走了，
    // 用原始坐标会让后面的层去拧一片已经不在那儿的点
    const coord = m.axis === 0 ? x : m.axis === 1 ? y : z
    if (coord < m.lo || coord >= m.hi) continue
    if (i === prog.active) onActive = true
    const a = m.ang * prog.amount[i]
    const c = Math.cos(a)
    const s = Math.sin(a)
    if (m.axis === 0) {
      const ny = y * c - z * s
      z = y * s + z * c
      y = ny
    } else if (m.axis === 1) {
      const nx = x * c + z * s
      z = -x * s + z * c
      x = nx
    } else {
      const nx = x * c - y * s
      y = x * s + y * c
      x = nx
    }
  }
  return [x, y, z, onActive]
}

/** 投影：先绕 y 轴转 yaw，再绕 x 轴倾 pitch，最后落到画布坐标。
 *  第三个返回值是深度（-1 最远、+1 最近），**不乘半径** —— 排序和明暗都用它。 */
export function project(
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  radius: number
): (x: number, y: number, z: number) => [number, number, number] {
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sy = Math.sin(yaw)
  const cyw = Math.cos(yaw)
  return (x, y, z) => {
    const px = x * cyw + z * sy
    const pz = -x * sy + z * cyw
    const gy = y * cp - pz * sp
    const gz = y * sp + pz * cp
    return [cx + px * radius, cy - gy * radius, gz]
  }
}

/** 点半径随画布尺寸的缩放。参考站按 300px 为基准、0.6 次方 ——
 *  线性缩放的话小尺寸下点会细到看不见，而 0.6 次方让小球的点相对更粗。 */
export function sizeScale(px: number, pow: number): number {
  return (px / 300) ** pow
}

/** 一颗画好的点 */
export interface Dot {
  x: number
  y: number
  /** 深度 -1..1，画之前按它从远到近排序 */
  z: number
  r: number
  /** 亮度 0..1（1 = 最亮）。已经换算成「深色底上该多亮」 */
  lum: number
}

/** 按「点要密还是稀」缩放。`latRings`/`lonDensity` 一起按 √count 缩 ——
 *  两个方向各缩 √n，总点数才是缩 n 倍。 */
export function scaleCount(cfg: OrbConfig, count: number): OrbConfig {
  const l = Math.sqrt(count)
  return {
    ...cfg,
    latRings: Math.max(2, Math.round(cfg.latRings * l)),
    lonDensity: Math.max(2, Math.round(cfg.lonDensity * l))
  }
}

/** 按「单点要多大」缩放三个半径项 */
export function scaleSize(cfg: OrbConfig, size: number): OrbConfig {
  return { ...cfg, rBase: cfg.rBase * size, rDepth: cfg.rDepth * size, rActive: cfg.rActive * size }
}

/**
 * 算出这一帧要画的所有点，**已按从远到近排好序**（近的后画、盖住远的）。
 *
 * @param px 画布边长（CSS 像素，不含 DPR）
 * @param t  动画时间（秒 × speed）
 */
export function buildOrb(px: number, t: number, cfg: OrbConfig): Dot[] {
  const c = px / 2
  const radius = (px / 2) * 0.82
  // 自转 + 一个很慢的俯仰摆动：只有自转的话，两极永远对着同一个方向，
  // 拧极区那几层时几乎看不出在动
  const proj = project(t * 0.55, 0.35 + 0.1 * Math.sin(t * 0.9), c, c, radius)
  const ss = sizeScale(px, cfg.rsPow)
  const moves = makeMoves(cfg.moveCount)
  const prog = moveProgress(t, cfg.moveCount)
  const dots: Dot[] = []
  for (let g = 0; g <= cfg.latRings; g++) {
    const lat = -Math.PI / 2 + (g / cfg.latRings) * Math.PI
    const cl = Math.cos(lat)
    const sl = Math.sin(lat)
    // 每圈的点数按 cos(纬度) 收窄，两极只剩一个点 —— 均匀铺的话极区会挤成一坨
    const n = Math.max(1, Math.round(Math.abs(cl) * cfg.lonDensity))
    for (let d = 0; d < n; d++) {
      const lon = (d / n) * 2 * Math.PI
      const [x, y, z, act] = applyMoves(
        [cl * Math.cos(lon), sl, cl * Math.sin(lon)],
        moves,
        prog
      )
      const [sx, sy, sz] = proj(x, y, z)
      const depth = (sz + 1) / 2
      const ink = cfg.inkFar - cfg.inkSpan * depth - (act ? 0.14 : 0)
      dots.push({
        x: sx,
        y: sy,
        z: sz,
        r: Math.max(cfg.rMin, (cfg.rBase + cfg.rDepth * depth + (act ? cfg.rActive : 0)) * ss),
        // 参考站画在浅底上，`ink` 越小越深越显眼；我们是深色底，翻过来用
        lum: 1 - ink
      })
    }
  }
  dots.sort((a, b) => a.z - b.z)
  return dots
}
