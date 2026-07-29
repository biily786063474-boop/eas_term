// 画布的落盘形态与坏存档防御。
//
// 序列化和 sanitize 是同一件事的两面：一个决定「写出去长什么样」，
// 一个决定「读回来遇到畸形数据怎么办」。分开放的话，改了写入格式却忘了
// 放宽读取校验，下次启动就是一片白——所以它们必须挨着。
import type { CanvasFrame, CanvasNode, CanvasScene, CanvasShape, CanvasViewport, NodeAgent, ViewMode } from './types'
import type { LeafNode, PaneState } from '../../layout'
import { collectLeaves } from '../../layout'
import { HEAD, NODE_H, NODE_W, PAD } from './layout'

export const initialScene: CanvasScene = {
  viewport: { x: 0, y: 0, scale: 1 },
  frames: [],
  shapes: []
}

/** 落盘的画布场景（含 viewMode）。终端节点的 leafId 已剥离（会话相关，重开时重绑）。 */
export interface PersistedCanvas {
  /** schema 版本；读时按版本迁移（当前恢复路径统一走 sanitizeCanvas 兜底，不强依赖） */
  version?: number
  viewMode: ViewMode
  viewport: CanvasViewport
  frames: CanvasFrame[]
  shapes: CanvasShape[]
}

/**
 * 序列化画布用于落盘。leafId 是会话相关的，一律剥离：
 *  · 终端 leaf 节点 → 落成占位（重开时重开终端重绑）；
 *  · 被切成图片/代码/网页预览的 leaf 节点 → 落成带 pane 的文件节点，
 *    重开时按 pane 恢复（不再当终端占位重新 spawn，避免「图片重开变终端」）。
 * leafPaneOf：按 leafId 取该 leaf 当前的 pane（从 tabs 里查，调用方注入）。
 */
export function serializeCanvas(
  canvas: CanvasScene,
  viewMode: ViewMode,
  leafPaneOf: (leafId: string) => PaneState | undefined
): PersistedCanvas {
  return {
    version: CANVAS_VERSION,
    viewMode,
    viewport: canvas.viewport,
    frames: canvas.frames.map((f) => ({
      ...f,
      nodes: f.nodes.map((n) => {
        const copy = { ...n }
        if (n.leafId) {
          const pane = leafPaneOf(n.leafId)
          if (pane && (pane.kind === 'code' || pane.kind === 'image' || pane.kind === 'web')) {
            copy.pane = pane // 非终端 leaf → 存成文件节点
          }
        }
        delete copy.leafId
        return copy
      })
    })),
    shapes: canvas.shapes
  }
}


// ---- 坏存档防御 ----
// 磁盘 canvas.json 可能「能 parse 但成员畸形」(schema 无版本演进 / JSON.stringify 丢 undefined 键 /
// 崩溃半截写入 / 手改)。直接灌进 state → 渲染期 `f.nodes.forEach`、`vp.scale(NaN)` 抛错 → 无 Error
// Boundary 时整树白、且因订阅未挂覆盖不了坏档 → 永久打不开。sanitizeCanvas 逐项规范化:坏 frame/node
// 丢弃而非整档,数值兜有限值,scale 钳到画布合法区间(与 CanvasStage 的 SCALE_MIN/MAX 一致)。
export const VP_SCALE_MIN = 0.2
export const VP_SCALE_MAX = 2.2
export const CANVAS_VERSION = 1
export const finiteOr = (v: unknown, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : dflt
export const clampScale = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(VP_SCALE_MAX, Math.max(VP_SCALE_MIN, v)) : 1

export function sanitizeViewport(raw: unknown): CanvasViewport {
  const v = (raw ?? {}) as Record<string, unknown>
  return { x: finiteOr(v.x, 0), y: finiteOr(v.y, 0), scale: clampScale(v.scale) }
}

// 迁移旧 agent 格式:接 Codex 时 model/effort 从「字符串」改成「按 agent 分的对象」{[kind]:值}。
// 旧存档里的字符串(如 model:'opus')新代码读 agent.model?.[kind] 得 undefined → 回落默认,导致
// 「重启不记忆思考/模型」。这里按 agent.kind 把字符串转成对象,让旧选择恢复。
export function migrateAgent(raw: unknown): NodeAgent | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  const kind: 'claude' | 'codex' = a.kind === 'codex' ? 'codex' : 'claude'
  const toRec = (v: unknown): Partial<Record<'claude' | 'codex', string>> | undefined =>
    typeof v === 'string'
      ? { [kind]: v }
      : v && typeof v === 'object'
        ? (v as Partial<Record<'claude' | 'codex', string>>)
        : undefined
  return { kind, model: toRec(a.model), effort: toRec(a.effort) }
}

export function sanitizeNode(raw: unknown): CanvasNode | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, unknown>
  if (typeof n.id !== 'string') return null
  const node: CanvasNode = {
    ...(n as unknown as CanvasNode),
    id: n.id,
    x: finiteOr(n.x, 0),
    y: finiteOr(n.y, 0),
    w: finiteOr(n.w, NODE_W),
    h: finiteOr(n.h, NODE_H)
  }
  if (n.agent) node.agent = migrateAgent(n.agent)
  return node
}

export function sanitizeFrame(raw: unknown): CanvasFrame | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  if (typeof f.id !== 'string') return null
  const nodes = Array.isArray(f.nodes)
    ? f.nodes.map(sanitizeNode).filter((n): n is CanvasNode => n !== null)
    : []
  return {
    ...(f as unknown as CanvasFrame),
    id: f.id,
    projectId: typeof f.projectId === 'string' ? f.projectId : null,
    name: typeof f.name === 'string' ? f.name : '未命名',
    x: finiteOr(f.x, 0),
    y: finiteOr(f.y, 0),
    w: finiteOr(f.w, NODE_W + PAD * 2),
    h: finiteOr(f.h, NODE_H + HEAD + PAD * 2),
    collapsed: f.collapsed === true,
    nodes
  }
}

export const SHAPE_TYPES = new Set(['rect', 'arrow', 'sticky'])
export function sanitizeShape(raw: unknown): CanvasShape | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.id !== 'string' || !SHAPE_TYPES.has(s.type as string)) return null
  return {
    ...(s as unknown as CanvasShape),
    id: s.id,
    type: s.type as CanvasShape['type'],
    x: finiteOr(s.x, 0),
    y: finiteOr(s.y, 0),
    w: finiteOr(s.w, 100),
    h: finiteOr(s.h, 100)
  }
}

/** 把磁盘读来的原始对象规范化成安全的 PersistedCanvas;整体异常兜底为空场景。
 *  droppedFrames：被丢弃的坏 frame 数(用于 log,避免静默丢数据)。 */
export function sanitizeCanvas(raw: unknown): { scene: PersistedCanvas; droppedFrames: number } {
  try {
    const r = (raw ?? {}) as Record<string, unknown>
    const rawFrames = Array.isArray(r.frames) ? r.frames : []
    const frames = rawFrames.map(sanitizeFrame).filter((f): f is CanvasFrame => f !== null)
    const shapes = Array.isArray(r.shapes)
      ? r.shapes.map(sanitizeShape).filter((s): s is CanvasShape => s !== null)
      : []
    return {
      scene: {
        viewMode: r.viewMode === 'canvas' ? 'canvas' : 'split',
        viewport: sanitizeViewport(r.viewport),
        frames,
        shapes
      },
      droppedFrames: rawFrames.length - frames.length
    }
  } catch {
    return {
      scene: { viewMode: 'split', viewport: { x: 0, y: 0, scale: 1 }, frames: [], shapes: [] },
      droppedFrames: 0
    }
  }
}
