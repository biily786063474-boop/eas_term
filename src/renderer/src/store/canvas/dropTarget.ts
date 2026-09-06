// 「文件拖到画布上」的落点归属：**内容一律进 Frame**（用户 2026-09-06）。
//
// 在这之前，从知识库/skill 抽屉拖出来的文件会落成**自由节点** —— 不属于任何 Frame，
// 于是也不受「一个 Frame 最多 5 个内容模块」的约束（那条规则按 Frame 数，见 nodeCap.ts），
// 画布上照样能堆到几十个。现在这条路先过这里定一个 Frame，再走 addFileNode。
//
// 纯几何，不碰 store，可测。
//
// ⚠️ HEAD/PAD 是**抄**过来的，不是 import 的。`layout.ts` 传递依赖到
// `store/shared` → `features/gantt/collector`，`node --test` 的类型剥离顺着这条链
// 一路解析不到（那些文件的相对 import 没带 `.ts`），整个测试文件加载失败。
// 与其为一个常量去改一整条链的 import，不如抄两个数字 —— 但**它们要跟 layout.ts 对齐**，
// 已挂进 docs/architecture/13-所有权矩阵.md 的跨文件同步清单。
const HEAD = 34 // = layout.ts 的 HEAD，Frame 头部高度
const PAD = 16 // = layout.ts 的 PAD

export interface FrameBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 点到矩形的距离（在矩形内为 0） */
function distToRect(f: FrameBox, wx: number, wy: number): number {
  const dx = Math.max(f.x - wx, 0, wx - (f.x + f.w))
  const dy = Math.max(f.y - wy, 0, wy - (f.y + f.h))
  return Math.hypot(dx, dy)
}

function contains(f: FrameBox, wx: number, wy: number): boolean {
  return wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h
}

/**
 * 世界坐标的落点 → 落进哪个 Frame、以及相对该 Frame 的坐标。
 *
 * - 落点在某个 Frame 里 → 就是它；**多个命中取面积最小的**（子 Frame 套在父 Frame 里，
 *   命中子 Frame 时用户显然是要放进子 Frame）
 * - 落在空白处 → 取**离落点最近**的 Frame，坐标夹回它的内框（不能因为一次拖拽把节点
 *   甩到 Frame 外面，那样 Frame 会被撑大成一条）
 * - 一个 Frame 都没有 → null，调用方自己决定（目前是退回自由节点：没地方可放）
 */
export function dropIntoFrame(
  frames: readonly FrameBox[],
  wx: number,
  wy: number,
  size: { w: number; h: number }
): { frameId: string; x: number; y: number } | null {
  if (!frames.length) return null
  const hits = frames.filter((f) => contains(f, wx, wy))
  const target = hits.length
    ? hits.reduce((a, b) => (a.w * a.h <= b.w * b.h ? a : b))
    : frames.reduce((a, b) => (distToRect(a, wx, wy) <= distToRect(b, wx, wy) ? a : b))
  // 落点居中到光标（-90/-15 沿用项目文件树那条路的手感），再夹进内框
  const rawX = wx - target.x - 90
  const rawY = wy - target.y - 15
  const maxX = Math.max(PAD, target.w - size.w - PAD)
  const maxY = Math.max(HEAD + PAD, target.h - size.h - PAD)
  return {
    frameId: target.id,
    x: Math.min(Math.max(rawX, PAD), maxX),
    y: Math.min(Math.max(rawY, HEAD + PAD), maxY)
  }
}
