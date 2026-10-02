// 发布分屏落到画布数据上：找 / 建插件拥有的子 Frame，按 planSplit 增 / 复用 / 替换，按 splitLayout 排版。
// 纯函数（不碰 DOM、不调 set），canvasSlice.openSplit 只负责写回 store 与对准镜头。
import type { CanvasFrame, CanvasNode } from './types'
import { planSplit, splitLayout, SPLIT_CELL, type SplitWant } from './splitLayout.ts'

/** Frame 几何常量（来自 canvas/layout.ts）。layout.ts 经 ../shared 拖进 Electron 依赖，node --test 裸跑不起来，故由调用方注入。 */
export interface SplitGeom { HEAD: number; PAD: number; GAP: number }
export interface SplitRequest { pluginId: string; parentFrameId: string; title: string; max: number; cells: SplitWant[]; published: string[] }
export interface SplitResult { frameId: string; opened: string[]; reused: string[]; replaced: Array<{ out: string; in: string }> }

const companionOf = (n: CanvasNode) => (n.pane?.kind === 'web' ? n.pane.companion : undefined)

export function applySplit(frames: readonly CanvasFrame[], req: SplitRequest, now: number, newId: (p: string) => string, geom: SplitGeom): { frames: CanvasFrame[]; result: SplitResult } | null {
  const { HEAD, PAD, GAP } = geom
  const parent = frames.find((f) => f.id === req.parentFrameId)
  if (!parent) return null
  let sub = frames.find((f) => f.parentId === parent.id && f.owner?.pluginId === req.pluginId && f.owner.purpose === 'split')
  const created = !sub
  if (!sub) {
    const nodeBottom = parent.nodes.length ? Math.max(...parent.nodes.map((n) => n.y + n.h)) : HEAD
    const childBottom = frames.filter((c) => c.parentId === parent.id).reduce((m, c) => Math.max(m, c.y - parent.y + (c.collapsed ? HEAD : c.h)), HEAD)
    sub = { id: newId('frame'), projectId: parent.projectId, name: req.title, parentId: parent.id, owner: { pluginId: req.pluginId, purpose: 'split' }, x: parent.x + PAD, y: parent.y + Math.max(nodeBottom, childBottom, HEAD) + GAP, w: 320, h: 140, collapsed: false, nodes: [] }
  }
  const cells = sub.nodes.flatMap((n) => { const c = companionOf(n); return c ? [{ key: c.key, nodeId: n.id, openedAt: c.openedAt }] : [] })
  const plan = planSplit(cells, req.cells, req.published, req.max)
  const toNode = (w: SplitWant, at: number, nodeId: string): CanvasNode => ({ id: nodeId, x: 0, y: 0, w: SPLIT_CELL.w, h: SPLIT_CELL.h, pane: { kind: 'web', url: w.url, companion: { pluginId: req.pluginId, panelId: w.companion.panelId, props: w.companion.props, key: w.key, openedAt: at } } })
  let t = now
  let nodes = sub.nodes.map((n) => {
    const r = plan.replace.find((x) => x.out.nodeId === n.id)
    return r ? toNode(r.in, t++, n.id) : n
  })
  nodes = [...nodes, ...plan.add.map((w) => toNode(w, t++, newId('cnode')))]
  // 格子按 openedAt 排位；非分屏节点（用户自己拖进来的）原样留在后面
  const split = nodes.filter((n) => companionOf(n)).sort((a, b) => companionOf(a)!.openedAt - companionOf(b)!.openedAt)
  const others = nodes.filter((n) => !companionOf(n))
  const lay = splitLayout(split.length)
  const placed = split.map((n, i) => ({ ...n, x: PAD + lay.slots[i].x, y: HEAD + PAD + lay.slots[i].y, w: SPLIT_CELL.w, h: SPLIT_CELL.h }))
  const next: CanvasFrame = { ...sub, name: req.title, nodes: [...placed, ...others], w: Math.max(sub.w, lay.w + 2 * PAD), h: Math.max(HEAD + PAD * 2 + lay.h, 140) }
  const out = created ? [...frames, next] : frames.map((f) => (f.id === next.id ? next : f))
  return { frames: out, result: { frameId: next.id, opened: plan.add.map((w) => w.key), reused: plan.reuse, replaced: plan.replace.map((r) => ({ out: r.out.key, in: r.in.key })) } }
}
