// 画布几何：Frame 网格排布、去重叠、节点找空位。
//
// 这一块是纯函数——输入一批 Frame/Node，输出新的一批，不碰 store、不碰盘。
// 抽出来是因为它是整个画布最难读的部分（reflow / deoverlap / findFreePos 互相咬合），
// 夹在 action 之间时，改一个间距常数都得先确认没踩到别的分支。
import type { CanvasFrame, CanvasNode } from './types'
import type { LeafNode, PaneState } from '../../layout'
import { uid } from '../shared'

// 节点网格布局参数（终端节点默认高度保证 ≥20 行：body≈NODE_H-30，行高 fontSize13×1.25≈16.25px）
export const NODE_W = 440
export const NODE_H = 380
export const GAP = 22
export const HEAD = 34 // Frame 头部高度
export const PAD = 16
export const COLS = 2

/** 依据一批共享 leaf 生成一个网格布局的 Frame（纯函数，不落 state） */
export function makeProjectFrame(
  leaves: LeafNode[],
  name: string,
  projectId: string | null,
  x: number,
  y: number
): CanvasFrame {
  const nodes: CanvasNode[] = leaves.map((leaf, i) => ({
    id: uid('cnode'),
    leafId: leaf.id,
    x: PAD + (i % COLS) * (NODE_W + GAP),
    y: HEAD + PAD + Math.floor(i / COLS) * (NODE_H + GAP),
    w: NODE_W,
    h: NODE_H
  }))
  const cols = Math.min(COLS, Math.max(1, leaves.length))
  const rows = Math.max(1, Math.ceil(leaves.length / COLS))
  return {
    id: uid('frame'),
    projectId,
    name,
    x,
    y,
    w: PAD * 2 + cols * NODE_W + (cols - 1) * GAP,
    h: HEAD + PAD * 2 + rows * NODE_H + (rows - 1) * GAP,
    collapsed: false,
    nodes
  }
}

/** 一个 Frame 恰好裹住其「节点 + 子 Frame」所需的宽高（右/下留 PAD）。子 Frame 用世界坐标，
 *  换算成相对本 Frame 的偏移参与计算。空 Frame → 最小 240×120（可用的空容器）。 */
export function frameExtent(frame: CanvasFrame, allFrames: CanvasFrame[]): { w: number; h: number } {
  let right = 0
  let bottom = 0
  for (const n of frame.nodes) {
    right = Math.max(right, n.x + n.w)
    bottom = Math.max(bottom, n.y + n.h)
  }
  for (const c of allFrames) {
    if (c.parentId !== frame.id) continue
    const ch = c.collapsed ? HEAD : c.h
    right = Math.max(right, c.x - frame.x + c.w)
    bottom = Math.max(bottom, c.y - frame.y + ch)
  }
  return { w: Math.max(240, right + PAD), h: Math.max(120, bottom + PAD) }
}

/** 全场景重排：每个 Frame 的宽高都收紧到「裹住自身节点 + 子 Frame」。
 *  由深到浅处理（先定子尺寸，父再据此裹住），保持既能长大也能收缩（Req G）。 */
export function reflowFrames(frames: CanvasFrame[]): CanvasFrame[] {
  const depthOf = (f: CanvasFrame): number => {
    let d = 0
    let cur: CanvasFrame | undefined = f
    const seen = new Set<string>()
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = frames.find((x) => x.id === cur!.parentId)
      if (cur) d++
    }
    return d
  }
  const order = [...frames].sort((a, b) => depthOf(b) - depthOf(a)) // 深 → 浅
  const byId = new Map(frames.map((f) => [f.id, { ...f }]))
  for (const f of order) {
    const cur = byId.get(f.id)!
    const ext = frameExtent(cur, [...byId.values()])
    cur.w = ext.w
    cur.h = ext.h
  }
  return frames.map((f) => byId.get(f.id)!)
}

// 顶层 Frame 去重叠：按阅读顺序(先上后左)放置，后来者与已放置的重叠则下移到其下方(连同后代一起移)。
// 只在「加节点导致 Frame 长大」等结构增长后调用，不介入手动拖拽(moveFrame)——避免拖动时被弹开。
export const FRAME_GAP = 24
export function deoverlapFrames(frames: CanvasFrame[]): CanvasFrame[] {
  const fh = (f: CanvasFrame): number => (f.collapsed ? HEAD : f.h)
  const overlap = (a: CanvasFrame, b: CanvasFrame): boolean =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + fh(b) && a.y + fh(a) > b.y
  const work = new Map(frames.map((f) => [f.id, { ...f }]))
  const tops = [...frames]
    .filter((f) => !f.parentId)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: string[] = []
  for (const t of tops) {
    const f = work.get(t.id)!
    let guard = 0
    let moved = true
    while (moved && guard++ < 100) {
      moved = false
      for (const pid of placed) {
        const p = work.get(pid)!
        if (overlap(f, p)) {
          f.y = p.y + fh(p) + FRAME_GAP // 下移到该 Frame 下方
          moved = true
        }
      }
    }
    placed.push(t.id)
  }
  // 顶层 Frame 的位移带上后代(子 Frame 世界坐标同步)
  const result = frames.map((f) => ({ ...f }))
  const rid = new Map(result.map((f) => [f.id, f]))
  for (const t of tops) {
    const nf = work.get(t.id)!
    const dx = nf.x - t.x
    const dy = nf.y - t.y
    if (dx === 0 && dy === 0) continue
    rid.get(t.id)!.x = nf.x
    rid.get(t.id)!.y = nf.y
    for (const d of collectDescendants(frames, t.id)) {
      const rd = rid.get(d)!
      rd.x += dx
      rd.y += dy
    }
  }
  return result
}

/** 收紧尺寸 + 顶层去重叠：用于「加节点」类会让 Frame 长大的结构变更 */
export function reflowSeparate(frames: CanvasFrame[]): CanvasFrame[] {
  return deoverlapFrames(reflowFrames(frames))
}

/** 某 Frame 的所有后代 Frame id（递归，用于拖父带子 / 删父连子） */
export function collectDescendants(frames: CanvasFrame[], id: string): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const f of frames) {
      if (f.parentId === cur && !out.has(f.id)) {
        out.add(f.id)
        stack.push(f.id)
      }
    }
  }
  return out
}

/** 把新节点放进 Frame：纵向堆叠到现有节点/子 Frame 下方（避免重叠）。尺寸交给 reflowFrames。 */
export function placeNodeInFrame(frame: CanvasFrame, node: CanvasNode, allFrames: CanvasFrame[]): CanvasFrame {
  const nodeBottom = frame.nodes.length ? Math.max(...frame.nodes.map((n) => n.y + n.h)) : HEAD
  const childBottom = allFrames
    .filter((c) => c.parentId === frame.id)
    .reduce((m, c) => Math.max(m, c.y - frame.y + (c.collapsed ? HEAD : c.h)), HEAD)
  const bottom = Math.max(nodeBottom, childBottom, HEAD) + (frame.nodes.length ? GAP : PAD)
  return { ...frame, nodes: [...frame.nodes, { ...node, x: PAD, y: bottom }] }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}
export const boxOverlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** 在 Frame 内找一个不与 others 重叠、且离首选点 (prefX,prefY) 最近的空位（螺旋环形外扩搜索）。
 *  左/上边界钳制到 PAD / HEAD+PAD。找不到则回落首选点。 */
export function findFreePos(others: Box[], w: number, h: number, prefX: number, prefY: number): { x: number; y: number } {
  const cx = (x: number): number => Math.max(PAD, x)
  const cy = (y: number): number => Math.max(HEAD + PAD, y)
  const fits = (x: number, y: number): boolean => !others.some((o) => boxOverlap({ x, y, w, h }, o))
  const px = cx(prefX)
  const py = cy(prefY)
  if (fits(px, py)) return { x: px, y: py }
  const step = 24
  for (let r = 1; r <= 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue // 只走当前环
        const nx = cx(px + dx * step)
        const ny = cy(py + dy * step)
        if (fits(nx, ny)) return { x: nx, y: ny }
      }
    }
  }
  return { x: px, y: py }
}

/**
 * 把被 anchor 压住的同 Frame 模块**垂直推开**（连锁）。
 *
 * 用在「放大一个模块之后」：它变大了会盖住下面的邻居，松手时得让位。
 *
 * 为什么是往下推、而不是复用 findFreePos 找最近空位：
 * 最近空位会让模块往左右窜，把用户排好的列打散 —— 明明只是把一个模块拉高了一点，
 * 结果整个 Frame 的布局重新洗牌。只往下推的话，相对上下关系不变，看起来就是
 * 「下面那些整体让开了一截」，和直觉一致。
 *
 * 连锁是自然发生的：A 被推下去之后可能压到 B，轮到 B 时它会以 A 的新位置为准继续下推，
 * 所以「下面有多个模块就一起向下移」不用特殊处理。
 */
export function pushDownOverlaps(frame: CanvasFrame, anchorId: string): CanvasFrame {
  const anchor = frame.nodes.find((n) => n.id === anchorId)
  if (!anchor) return frame
  // anchor 固定不动；其余按「先上后左」处理 —— 顺序决定了谁给谁让位，
  // 按阅读顺序来才符合用户看到的排版
  const others = frame.nodes
    .filter((n) => n.id !== anchorId)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: Box[] = [{ x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h }]
  const moved = new Map<string, number>()
  for (const n of others) {
    let y = n.y
    // 逐个躲开已放置的：躲开一个之后可能又撞上另一个，所以要循环到干净为止。
    // guard 是防御性的，正常情况下最多循环 placed.length 次
    for (let guard = 0; guard < 200; guard++) {
      const hit = placed.find((p) => boxOverlap({ x: n.x, y, w: n.w, h: n.h }, p))
      if (!hit) break
      y = hit.y + hit.h + GAP
    }
    if (y !== n.y) moved.set(n.id, y)
    placed.push({ x: n.x, y, w: n.w, h: n.h })
  }
  if (!moved.size) return frame
  return {
    ...frame,
    nodes: frame.nodes.map((n) => (moved.has(n.id) ? { ...n, y: moved.get(n.id)! } : n))
  }
}

/** 把新节点放到「离松手鼠标点最近的空位」（拖入判定用），避开已有模块重叠。 */
export function placeNodeAtPoint(frame: CanvasFrame, node: CanvasNode, prefX: number, prefY: number): CanvasFrame {
  const others = frame.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
  const { x, y } = findFreePos(others, node.w, node.h, prefX, prefY)
  return { ...frame, nodes: [...frame.nodes, { ...node, x, y }] }
}

/** findFreePos 的世界坐标版：给自由节点用，不夹 PAD/HEAD（那是 Frame 内边距，世界坐标没有这个概念，
 *  夹了反而会把偏左上的位置错误地推走）。只避开「其它自由节点」，不避 Frame——自由节点允许压在 Frame 上面。 */
export function findFreePosWorld(others: Box[], w: number, h: number, prefX: number, prefY: number): { x: number; y: number } {
  const fits = (x: number, y: number): boolean => !others.some((o) => boxOverlap({ x, y, w, h }, o))
  if (fits(prefX, prefY)) return { x: prefX, y: prefY }
  const step = 24
  for (let r = 1; r <= 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = prefX + dx * step
        const ny = prefY + dy * step
        if (fits(nx, ny)) return { x: nx, y: ny }
      }
    }
  }
  return { x: prefX, y: prefY }
}
