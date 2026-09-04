// 力导向布局（「知识图谱」那种）。**纯几何、确定性、一次算完，不做动画。**
//
// ── 为什么原来只做环形，以及这次怎么绕开那三条 ────────────────────────────
// `radial.ts` 的文件头记着不用力导向的三个理由。这里逐条回应：
//
// ① **不确定** —— 同一份数据每次跑出来不一样，用户下次打开找不到上次看的那块地。
//    → 这里**没有任何随机数**：初始位置来自节点 id 的哈希（确定）＋ 环形起手，
//      迭代次数固定。同一份数据永远算出同一张图。
// ② **要跑模拟，节点一多就掉帧** —— 而画布上还有终端和网页在争帧。
//    → **不做动画**：一次算完再画。300 次迭代 × 26 个节点是几毫秒的事。
//      节点多时按 `MAX_NODES` 截断（调用方已经先聚合到领地级了）。
// ③ 它优化的是「看起来不重叠」，而环形回答的是「谁和谁连」。
//    → 两者各答一半，所以是**并列的两个视图**而不是替换：
//      环形适合「扫一眼谁连谁」，力导向适合「哪几块自然抱团」。
//
// 面积仍然正比于内容量（半径按 sqrt(weight)，和环形那套共用一个判据）。

import type { PlacedNode, RadialNode } from './radial.ts'

/** 迭代次数。**固定值，不看收敛** —— 收敛判据会让不同数据跑出不同轮数，
 *  而「同一份数据每次一样」比「多跑几轮更漂亮」重要。 */
const ITERATIONS = 320
/** 超过这么多节点就不跑力导向了（调用方应该先聚合）。 */
export const MAX_NODES = 120

/** 从字符串算一个稳定的 [0,1) —— **代替随机初始位置**。
 *  用 id 而不是下标：下标会随排序变，而排序会随数据变。 */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const R_MIN = 5
const R_MAX = 17

/**
 * 力导向布局。**确定性**：同一份输入永远得到同一份输出。
 *
 * @param nodes 节点（`weight` 决定面积）
 * @param links 边，用来算引力
 * @param w/h   可用画布尺寸
 */
export function forceLayout(
  nodes: readonly RadialNode[],
  links: readonly { from: string; to: string }[],
  w: number,
  h: number
): PlacedNode[] {
  if (!nodes.length) return []
  const use = nodes.slice(0, MAX_NODES)
  const cx = w / 2
  const cy = h / 2
  const maxW = Math.max(...use.map((n) => n.weight), 1)
  // 面积正比于 weight（不是半径正比）—— 和环形那套同一个判据
  const radius = (n: RadialNode): number => R_MIN + (R_MAX - R_MIN) * Math.sqrt(n.weight / maxW)

  // 初始位置：环形起手 ＋ 由 id 决定的微扰。**环形起手很重要** ——
  // 全堆在中心的话前几十轮都在互相弹开，最后的形状更依赖迭代次数
  const idx = new Map(use.map((n, i) => [n.id, i]))
  const pos = use.map((n, i) => {
    const a = (i / use.length) * Math.PI * 2 - Math.PI / 2
    const jitter = (hash01(n.id) - 0.5) * 0.35
    const rr = Math.min(w, h) * (0.3 + hash01(n.id + 'r') * 0.06)
    return { x: cx + Math.cos(a + jitter) * rr, y: cy + Math.sin(a + jitter) * rr }
  })

  // 邻接（无向，去重）—— 引力只看「连没连」，不看方向
  const adj = new Map<number, Set<number>>()
  for (const l of links) {
    const a = idx.get(l.from)
    const b = idx.get(l.to)
    if (a === undefined || b === undefined || a === b) continue
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  const k = Math.sqrt((w * h) / use.length) * 0.9 // 理想边长
  /** 每个点连了几条边。**引力要按度数摊薄** ——
   *  不摊的话枢纽节点被几十条边同时往里拉，整张图会塌成一个疙瘩
   *  （2026-09-03 第一版就是这样：26 个点挤在右下角一小团，标签互相压）。 */
  const degree = use.map((_, i) => adj.get(i)?.size ?? 0)
  for (let iter = 0; iter < ITERATIONS; iter++) {
    // 温度线性退火：前期大步找形状，后期小步定位置
    const temp = (1 - iter / ITERATIONS) * (Math.min(w, h) * 0.045) + 0.2
    const fx = new Array(use.length).fill(0)
    const fy = new Array(use.length).fill(0)

    // 斥力：所有点两两相斥（26 个节点 = 325 对，跑 320 轮也就十万次，几毫秒）
    for (let i = 0; i < use.length; i++) {
      for (let j = i + 1; j < use.length; j++) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          // 完全重合时**用确定的方向推开**，不能用随机 —— 随机会毁掉确定性
          dx = (i - j) * 0.01 + 0.01
          dy = 0.01
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        // 半径也算进去：大节点占的地方大，该把邻居推得更远
        const want = k + radius(use[i]) + radius(use[j])
        let f = (want * want) / d2
        // **贴太近时额外加一记硬斥力**：平方反比在极近处仍然可能被引力压过去，
        // 而圆叠圆是这张图上最不能接受的失败（测试里那条「两点距离要大于半径和」）
        const touch = radius(use[i]) + radius(use[j]) + 6
        if (d < touch) f += (touch - d) * 12
        fx[i] += (dx / d) * f
        fy[i] += (dy / d) * f
        fx[j] -= (dx / d) * f
        fy[j] -= (dy / d) * f
      }
    }
    // 引力：有边的互相拉
    for (const [i, set] of adj) {
      for (const j of set) {
        if (j < i) continue
        const dx = pos[i].x - pos[j].x
        const dy = pos[i].y - pos[j].y
        const d = Math.hypot(dx, dy) || 0.01
        // **按度数摊薄 ＋ 封顶**：`d²/k` 随距离无上限增长，
        // 而枢纽节点同时被几十条边拉 —— 两者叠起来就是那个疙瘩
        const raw = (d * d) / k
        const share = 2 / (Math.sqrt(degree[i]) + Math.sqrt(degree[j]) + 2)
        const f = Math.min(raw * share, k * 0.6)
        fx[i] -= (dx / d) * f
        fy[i] -= (dy / d) * f
        fx[j] += (dx / d) * f
        fy[j] += (dy / d) * f
      }
    }
    // 向心力：把孤立点收回来，否则它们会被斥力推到画布外
    for (let i = 0; i < use.length; i++) {
      // 向心力**只兜孤立点**：连通的点已经被引力管着，
      // 对它们再施向心力就是在跟「铺开」对着干
      const pullK = degree[i] === 0 ? 0.03 : 0.004
      fx[i] += (cx - pos[i].x) * pullK
      fy[i] += (cy - pos[i].y) * pullK
    }
    // 落位，步长受温度限制
    for (let i = 0; i < use.length; i++) {
      const d = Math.hypot(fx[i], fy[i]) || 1
      const step = Math.min(d, temp)
      pos[i].x += (fx[i] / d) * step
      pos[i].y += (fy[i] / d) * step
    }
  }

  // 缩放进画布：留出边距给标签（标签写在节点外侧）
  const pad = 46
  const xs = pos.map((p) => p.x)
  const ys = pos.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const sx = (w - pad * 2) / Math.max(maxX - minX, 1)
  const sy = (h - pad * 2) / Math.max(maxY - minY, 1)
  const s = Math.min(sx, sy, 1.6)

  return use.map((n, i) => {
    const x = pad + (pos[i].x - minX) * s
    const y = pad + (pos[i].y - minY) * s
    return {
      ...n,
      x,
      y,
      r: radius(n),
      // 标签朝外要用角度，这里按「相对画布中心」算 —— 力导向没有天然的环
      angle: Math.atan2(y - h / 2, x - w / 2)
    }
  })
}

// ── 标签去重叠 ──────────────────────────────────────────────────────────────
//
// 环形布局天然不用管这个：标签朝外辐射，彼此隔着一个角度。
// 力导向里节点会抱团，团里的标签必然互相压 —— 实测本仓库的领地图上，
// 中间那簇有 6 个标签叠在一起，一个都读不出来。
//
// **不做力学避让，做取舍**：叠上了就只留大的那个（它代表的内容更多），
// 小的那个 hover 时仍然看得到。理由和「图上只画耦合最重的 24 个」一样 ——
// 一张什么都想说清的图，最后什么都说不清。

/** 估算标签占多宽（px）。中文按一个字 ~12px、西文 ~6.6px 算 —— 够用即可，
 *  这里要的是「会不会撞上」，不是精确排版。 */
function labelWidth(text: string, fontPx = 11): number {
  let w = 0
  for (const ch of text) w += /[一-龥　-〿＀-￯]/.test(ch) ? fontPx : fontPx * 0.55
  return w
}

/**
 * 挑出**不互相压**的那些标签。
 *
 * **确定性**：按半径从大到小、同大小按 id 排序后贪心 —— 同一份数据每次挑中同一批。
 *
 * @param placed 已布局的节点
 * @param labelOf 取标签文字
 * @returns 该显示标签的节点 id 集合
 */
export function pickLabels(
  placed: readonly { id: string; x: number; y: number; r: number }[],
  labelOf: (id: string) => string,
  fontPx = 11
): Set<string> {
  const order = [...placed].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id))
  const taken: { x1: number; y1: number; x2: number; y2: number }[] = []
  const keep = new Set<string>()
  for (const p of order) {
    const w = labelWidth(labelOf(p.id), fontPx)
    const h = fontPx * 1.35
    // 标签画在节点右侧偏上（和 GraphCanvas 的 labelAt 一致的量级）
    const box = { x1: p.x + p.r + 3, y1: p.y - h / 2, x2: p.x + p.r + 3 + w, y2: p.y + h / 2 }
    const hit = taken.some((t) => !(box.x2 < t.x1 || box.x1 > t.x2 || box.y2 < t.y1 || box.y1 > t.y2))
    if (hit) continue
    taken.push(box)
    keep.add(p.id)
  }
  return keep
}
