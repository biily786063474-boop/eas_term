// 画布切片：全局唯一的无限画布场景（单例，不属于任何 tab）。
// viewMode 全局切换分屏 / 画布；canvas 场景与 split 树共享同一批 leaf（见 §04 数据模型）。
// 节点通过 leafId 引用 split 树里的 leaf → 两视图同一个 PaneView 实例 → 终端不断连。

import type { StateCreator } from 'zustand'
import { collectLeaves, LeafNode, PaneState } from '../layout'
import { uid } from './shared'
import type { AppState } from './types'

export type ViewMode = 'split' | 'canvas'

export interface CanvasViewport {
  x: number
  y: number
  scale: number
}

/** 终端节点上的「Agent 控制台」配置（画布独有 chrome，分屏不渲染；底层仍是真实 CLI）。
 *  未设(undefined)= 纯终端；设了则显示控制条，点启动把参数拼成 CLI 命令写进终端。 */
export interface NodeAgent {
  /** 当前选中的 agent（段控件切换；决定胶囊选项、启动命令） */
  kind: 'claude' | 'codex'
  /** 模型：按 agent 各记一套（Claude→opus/sonnet…，Codex→gpt-5-codex/gpt-5…），切 agent 互不覆盖。键=kind */
  model?: Partial<Record<'claude' | 'codex', string>>
  /** 思考档位：同样按 agent 各记一套。值来自探测（Claude 真实 / Codex 已知默认），放宽为 string 随 CLI 演进 */
  effort?: Partial<Record<'claude' | 'codex', string>>
  /** 这个终端节点**自己的**会话 id（按 agent 各记一套）。
   *  没有它的话，「回溯」只能用 `claude -c` / `codex resume --last`，语义是
   *  「继续这个目录里最近的会话」——同一项目开几个终端就会互相抢，
   *  终端 A 续到终端 B 的对话。绑定之后每个终端只回自己的那条线。 */
  session?: Partial<Record<'claude' | 'codex', string>>
}

/** 画布节点：坐标相对所属 Frame（含头部偏移）。
 *  终端节点用 leafId 引用共享 leaf（两视图同源，pane-layer 渲染）；
 *  文件预览节点用 pane 自带内容（画布独有，装饰层渲染，不进分屏）。二者二选一。 */
export interface CanvasNode {
  id: string
  leafId?: string
  pane?: PaneState
  /** 画布组件（如版本管理）；画布独有，type 查 features/canvas/components/registry */
  component?: { type: string; props?: Record<string, unknown> }
  /** 自定义名称（可重命名）；未设则用默认标题 */
  name?: string
  /** 终端节点的 Agent 控制台配置（画布独有；持久化，重开保留选择） */
  agent?: NodeAgent
  x: number
  y: number
  w: number
  h: number
}

/** Frame：对应一个项目（顶层）或一个文件夹（子 Frame），容纳若干节点。
 *  子 Frame：parentId 指向父 Frame、folderPath 记文件夹路径；坐标同为世界坐标。 */
export interface CanvasFrame {
  id: string
  projectId: string | null
  name: string
  x: number
  y: number
  w: number
  h: number
  collapsed: boolean
  nodes: CanvasNode[]
  /** 父 Frame id（子 Frame 才有）；顶层项目 Frame 为 undefined/null */
  parentId?: string | null
  /** 子 Frame 对应的文件夹绝对路径 */
  folderPath?: string
}

/** 图形/便签：世界坐标 */
export interface CanvasShape {
  id: string
  type: 'rect' | 'arrow' | 'sticky'
  x: number
  y: number
  w: number
  h: number
  text?: string
  color?: string
}

export interface CanvasScene {
  viewport: CanvasViewport
  frames: CanvasFrame[]
  shapes: CanvasShape[]
}

export interface CanvasSlice {
  /** 全局视图：分屏 / 画布。titlebar 分段控件切换，不属于任何 tab */
  viewMode: ViewMode
  canvas: CanvasScene
  setViewMode: (mode: ViewMode) => void
  /** app 启动时从磁盘恢复画布场景（frames/shapes/viewport/viewMode）。
   *  终端节点已剥离旧 leafId → 占位，进画布时 materialize 重开绑定。 */
  loadCanvas: () => Promise<void>
  /** 把画布里的终端占位节点（无 leafId/pane/component）逐个重开终端并绑定 leafId */
  materializeCanvas: () => Promise<void>
  setViewport: (vp: Partial<CanvasViewport>) => void
  /** 「落定的缩放比」：画布终端的字号/头部按它渲染;缩放手势中它不变(终端靠 pane 的 transform 做实时预览),
   *  手势停止 ~160ms 后才落到当前 viewport.scale(此时才真正落字号+fit,鼠标坐标恢复精准)。
   *  文件/图形节点无此顾虑(本就用 transform),不受影响。 */
  canvasCommittedScale: number
  /** 把当前项目的所有 leaf 铺成一个 Frame（幂等：已有该项目 Frame 则跳过） */
  seedCanvas: () => void
  /** 拖项目入画布：已有 Frame 则跳过（由调用方聚焦），否则（必要时先开终端）在落点建 Frame */
  addProjectFrame: (projectId: string | null, x: number, y: number) => Promise<void>
  moveFrame: (id: string, x: number, y: number) => void
  resizeFrame: (id: string, w: number, h: number) => void
  toggleCollapse: (id: string) => void
  moveNode: (frameId: string, nodeId: string, x: number, y: number) => void
  resizeNode: (frameId: string, nodeId: string, w: number, h: number) => void
  /** 把节点从一个 Frame 移到另一个 Frame（拖模块进子 Frame，悬停 1s 判定） */
  moveNodeToFrame: (fromFrameId: string, nodeId: string, toFrameId: string) => void
  /** 拖动结束后：若该节点与同 Frame 其它模块重叠，挪到离当前位置最近的空位（防碰撞） */
  settleNode: (frameId: string, nodeId: string) => void
  /** 拖文件入 Frame：新增一个画布自带的文件预览节点（不进分屏） */
  addFileNode: (frameId: string, pane: PaneState, x: number, y: number) => void
  /** 拖组件入 Frame：新增一个画布组件节点（尺寸由调用方从 registry 取，避免循环依赖） */
  addComponentNode: (
    frameId: string,
    type: string,
    x: number,
    y: number,
    w: number,
    h: number
  ) => void
  removeNode: (frameId: string, nodeId: string) => void
  addShape: (shape: Omit<CanvasShape, 'id'>) => void
  updateShape: (id: string, patch: Partial<CanvasShape>) => void
  removeShape: (id: string) => void
  renameFrame: (id: string, name: string) => void
  /** 删除 Frame：连同后代子 Frame 一起删，逐个 closeLeaf 杀掉各自成员终端 */
  removeFrame: (id: string) => void
  /** 拖文件夹入某 Frame → 在其内新增一个空的子 Frame（父随之裹住） */
  addSubFrame: (parentId: string, folderPath: string, name: string) => void
  /** 复制画布独有节点（文件/组件；终端节点不复制，pty 唯一） */
  duplicateNode: (frameId: string, nodeId: string) => void
  /** 在 Frame 里新开一个终端节点（openTerminal + 挂到 Frame，自动堆叠） */
  addTerminalNode: (frameId: string) => Promise<void>
  /** 开一个终端并把命令**填进去但不回车**（首启引导装 CLI 用）。
   *  只填不发是刻意的：跑什么用户看得见，回车由他自己按——我们不在别人机器上静默装东西。 */
  prefillTerminal: (cmd: string) => Promise<void>
  /** 在 Frame 里新开一个迷你浏览器节点（web pane，空地址，自动堆叠） */
  addBrowserNode: (frameId: string) => void
  /** 在 Frame 里新开一个带地址的浏览器节点并聚焦（终端/外部链接「跳出的网页」默认走画板浏览器） */
  addWebNode: (frameId: string, url: string) => void
  /** 更新 web 节点的当前地址（浏览器导航时回写，重开还原到上次页面） */
  setNodeUrl: (frameId: string, nodeId: string, url: string) => void
  /** 更新 web 节点的页面标题（存 pane.title；节点头部显示时手动 name 优先，其次标题） */
  setWebNodeTitle: (frameId: string, nodeId: string, title: string) => void
  /** 把画布平移到某节点居中（保持当前缩放）——如浏览器里点链接开新页时聚焦过去 */
  focusCanvasNode: (frameId: string, nodeId: string) => void
  /** 一键整理 Frame 内模块：按各自大小从左上角起流式重排，行内对齐、消除重叠与空隙 */
  tidyFrame: (frameId: string) => void
  /** 重命名节点（自定义名称） */
  renameNode: (frameId: string, nodeId: string, name: string) => void
  /** 设置终端节点的 Agent 控制台配置（传 null 清除=回到纯终端） */
  setNodeAgent: (frameId: string, nodeId: string, agent: NodeAgent | null) => void
  /** 更新画布组件节点的 props（如设计模块把 designState 存回节点，随 canvas.json 持久化） */
  setNodeComponentProps: (
    frameId: string,
    nodeId: string,
    props: Record<string, unknown>
  ) => void
  /** 最大化沉浸的节点（画布模式下铺满整个视口工作；再点还原回原位）。不持久化 */
  maximizedNode: { frameId: string; nodeId: string } | null
  setMaximizedNode: (v: { frameId: string; nodeId: string } | null) => void
  /** 画布选中集合（key：s:形状 / f:Frame / n:frameId:nodeId 节点，含终端节点）。
   *  提到 store 是为了让浮在 PaneLayer 的终端节点也能被选中并显示高亮 + F 聚焦。 */
  canvasSel: string[]
  setCanvasSel: (keys: string[]) => void
  toggleCanvasSel: (key: string, additive: boolean) => void
  clearCanvasSel: () => void
}

const initialScene: CanvasScene = {
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

// materializeCanvas 防重入（避免恢复与进画布同时触发导致重复 spawn）
let materializing = false

// 缩放手势结束判定:每次 scale 变都重置,停 160ms 无新缩放 → 把 committedScale 落到当前 scale
let commitScaleTimer: ReturnType<typeof setTimeout> | null = null

// 节点网格布局参数（终端节点默认高度保证 ≥20 行：body≈NODE_H-30，行高 fontSize13×1.25≈16.25px）
const NODE_W = 440
const NODE_H = 380
const GAP = 22
const HEAD = 34 // Frame 头部高度
const PAD = 16
const COLS = 2

/** 依据一批共享 leaf 生成一个网格布局的 Frame（纯函数，不落 state） */
function makeProjectFrame(
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
function frameExtent(frame: CanvasFrame, allFrames: CanvasFrame[]): { w: number; h: number } {
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
function reflowFrames(frames: CanvasFrame[]): CanvasFrame[] {
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
const FRAME_GAP = 24
function deoverlapFrames(frames: CanvasFrame[]): CanvasFrame[] {
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
function reflowSeparate(frames: CanvasFrame[]): CanvasFrame[] {
  return deoverlapFrames(reflowFrames(frames))
}

/** 某 Frame 的所有后代 Frame id（递归，用于拖父带子 / 删父连子） */
function collectDescendants(frames: CanvasFrame[], id: string): Set<string> {
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
function placeNodeInFrame(frame: CanvasFrame, node: CanvasNode, allFrames: CanvasFrame[]): CanvasFrame {
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
const boxOverlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** 在 Frame 内找一个不与 others 重叠、且离首选点 (prefX,prefY) 最近的空位（螺旋环形外扩搜索）。
 *  左/上边界钳制到 PAD / HEAD+PAD。找不到则回落首选点。 */
function findFreePos(others: Box[], w: number, h: number, prefX: number, prefY: number): { x: number; y: number } {
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

/** 把新节点放到「离松手鼠标点最近的空位」（拖入判定用），避开已有模块重叠。 */
function placeNodeAtPoint(frame: CanvasFrame, node: CanvasNode, prefX: number, prefY: number): CanvasFrame {
  const others = frame.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
  const { x, y } = findFreePos(others, node.w, node.h, prefX, prefY)
  return { ...frame, nodes: [...frame.nodes, { ...node, x, y }] }
}

// ---- 坏存档防御 ----
// 磁盘 canvas.json 可能「能 parse 但成员畸形」(schema 无版本演进 / JSON.stringify 丢 undefined 键 /
// 崩溃半截写入 / 手改)。直接灌进 state → 渲染期 `f.nodes.forEach`、`vp.scale(NaN)` 抛错 → 无 Error
// Boundary 时整树白、且因订阅未挂覆盖不了坏档 → 永久打不开。sanitizeCanvas 逐项规范化:坏 frame/node
// 丢弃而非整档,数值兜有限值,scale 钳到画布合法区间(与 CanvasStage 的 SCALE_MIN/MAX 一致)。
const VP_SCALE_MIN = 0.2
const VP_SCALE_MAX = 2.2
const CANVAS_VERSION = 1
const finiteOr = (v: unknown, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : dflt
const clampScale = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(VP_SCALE_MAX, Math.max(VP_SCALE_MIN, v)) : 1

function sanitizeViewport(raw: unknown): CanvasViewport {
  const v = (raw ?? {}) as Record<string, unknown>
  return { x: finiteOr(v.x, 0), y: finiteOr(v.y, 0), scale: clampScale(v.scale) }
}

// 迁移旧 agent 格式:接 Codex 时 model/effort 从「字符串」改成「按 agent 分的对象」{[kind]:值}。
// 旧存档里的字符串(如 model:'opus')新代码读 agent.model?.[kind] 得 undefined → 回落默认,导致
// 「重启不记忆思考/模型」。这里按 agent.kind 把字符串转成对象,让旧选择恢复。
function migrateAgent(raw: unknown): NodeAgent | undefined {
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

function sanitizeNode(raw: unknown): CanvasNode | null {
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

function sanitizeFrame(raw: unknown): CanvasFrame | null {
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

const SHAPE_TYPES = new Set(['rect', 'arrow', 'sticky'])
function sanitizeShape(raw: unknown): CanvasShape | null {
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
function sanitizeCanvas(raw: unknown): { scene: PersistedCanvas; droppedFrames: number } {
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

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
  viewMode: 'split',
  canvas: initialScene,
  canvasCommittedScale: 1,

  setViewMode: (mode) => {
    set({ viewMode: mode })
    if (mode === 'canvas') {
      // 首次进画布时，把当前项目的终端 seed 成 Frame（若尚未 seed）
      get().seedCanvas()
      // 恢复来的终端占位节点在此重开绑定（幂等，无占位则空转）
      void get().materializeCanvas()
    }
  },

  loadCanvas: async () => {
    let raw: unknown = null
    try {
      raw = await window.api.canvas.load()
    } catch (e) {
      console.error('[loadCanvas] 读盘失败,保持空场景', e)
      return
    }
    if (raw == null) return
    // 坏档防御:逐项规范化,坏 frame/node 丢弃而非让渲染崩成永久白屏
    const { scene, droppedFrames } = sanitizeCanvas(raw)
    if (droppedFrames > 0) console.warn(`[loadCanvas] 丢弃了 ${droppedFrames} 个损坏的 frame`)
    // committedScale 跟随恢复的 scale,使启动时 pane transform=1(不误缩放)
    set(() => ({
      canvas: { viewport: scene.viewport, frames: scene.frames, shapes: scene.shapes },
      canvasCommittedScale: scene.viewport.scale
    }))
    // 恢复上次停留的视图
    if (scene.viewMode === 'canvas') set({ viewMode: 'canvas' })
    // 启动即静默对齐两个视图：不管现在停在分屏还是画布，都把画布里的终端占位重开成真终端。
    // 分屏与画布共享同一批 leaf，所以画布有几个终端，分屏一开始就有几个——不必等用户切到画布
    // 才「把画布的终端拉到分屏」。await 只等重开完成，不阻塞 UI 渲染。
    await get().materializeCanvas()
  },

  materializeCanvas: async () => {
    if (materializing) return
    materializing = true
    try {
      const frames = get().canvas.frames
      for (const f of frames) {
        try {
          // 项目已被删除的 Frame：跳过重开终端（避免开到 home）
          if (f.projectId && !get().projects.some((p) => p.id === f.projectId)) continue
          for (const n of f.nodes) {
            try {
              if (n.leafId || n.pane || n.component) continue // 已绑定 / 文件 / 组件 → 跳过
              // 终端占位 → 重开一个终端绑定到该节点（全新 shell）
              const before = new Set(
                get()
                  .tabs.filter((t) => t.projectId === f.projectId)
                  .flatMap((t) => collectLeaves(t.root).map((l) => l.id))
              )
              await get().openTerminal({ projectId: f.projectId })
              const newLeaf = get()
                .tabs.filter((t) => t.projectId === f.projectId)
                .flatMap((t) => collectLeaves(t.root))
                .find((l) => !before.has(l.id))
              if (!newLeaf) continue
              set((s) => ({
                canvas: {
                  ...s.canvas,
                  frames: s.canvas.frames.map((fr) =>
                    fr.id === f.id
                      ? {
                          ...fr,
                          nodes: fr.nodes.map((nn) =>
                            nn.id === n.id ? { ...nn, leafId: newLeaf.id } : nn
                          )
                        }
                      : fr
                  )
                }
              }))
            } catch (e) {
              // 单个节点重开失败不中断整轮恢复（否则一个坏节点连带掐掉后续 + 保存订阅）
              console.error('[materializeCanvas] 节点重开失败,跳过', e)
            }
          }
        } catch (e) {
          console.error('[materializeCanvas] frame 恢复失败,跳过', e)
        }
      }
    } finally {
      materializing = false
    }
  },

  setViewport: (vp) => {
    set((s) => {
      const cur = s.canvas.viewport
      const next = { ...cur, ...vp }
      // 兜死 NaN/0/超界:scale=0 会让终端 placement 变 NaN 整屏消失、拖拽 dx/scale=Infinity 腐化存档
      return {
        canvas: {
          ...s.canvas,
          viewport: { x: finiteOr(next.x, cur.x), y: finiteOr(next.y, cur.y), scale: clampScale(next.scale) }
        }
      }
    })
    // 缩放手势:scale 变了 → 进入「transform 预览」(committedScale 不动,终端保持字号靠 pane transform 实时缩放),
    // 手势停 160ms 后把 committedScale 落到当前 scale——此刻终端才真正落字号+fit,鼠标坐标恢复精准。
    // 纯平移(只改 x/y)不触发。避免连续缩放每帧重建 GPU canvas(P2 白屏根因),又保留实时跟随。
    if (vp.scale !== undefined && get().canvas.viewport.scale !== get().canvasCommittedScale) {
      if (commitScaleTimer) clearTimeout(commitScaleTimer)
      commitScaleTimer = setTimeout(() => {
        set((s) => ({ canvasCommittedScale: s.canvas.viewport.scale }))
      }, 160)
    }
  },

  seedCanvas: () => {
    const s = get()
    const projectId = s.activeProjectId
    if (s.canvas.frames.some((f) => f.projectId === projectId)) return
    const leaves = s.tabs.filter((t) => t.projectId === projectId).flatMap((t) => collectLeaves(t.root))
    if (!leaves.length) return
    const project = s.projects.find((p) => p.id === projectId)
    const frame = makeProjectFrame(leaves, project?.name ?? '未命名', projectId ?? null, 80, 80)
    set((st) => ({ canvas: { ...st.canvas, frames: [...st.canvas.frames, frame] } }))
  },

  addProjectFrame: async (projectId, x, y) => {
    if (get().canvas.frames.some((f) => f.projectId === projectId)) return
    // 项目还没终端 → 先开一个，Frame 里才有内容
    let leaves = get()
      .tabs.filter((t) => t.projectId === projectId)
      .flatMap((t) => collectLeaves(t.root))
    if (!leaves.length) {
      await get().openTerminal({ projectId })
      leaves = get()
        .tabs.filter((t) => t.projectId === projectId)
        .flatMap((t) => collectLeaves(t.root))
    }
    if (!leaves.length) return
    const project = get().projects.find((p) => p.id === projectId)
    const frame = makeProjectFrame(leaves, project?.name ?? '未命名', projectId ?? null, x, y)
    set((st) => ({ canvas: { ...st.canvas, frames: [...st.canvas.frames, frame] } }))
  },

  moveFrame: (id, x, y) =>
    set((s) => {
      const target = s.canvas.frames.find((f) => f.id === id)
      if (!target) return s
      const dx = x - target.x
      const dy = y - target.y
      const desc = collectDescendants(s.canvas.frames, id) // 拖父带子：后代同步位移
      const moved = s.canvas.frames.map((f) =>
        f.id === id ? { ...f, x, y } : desc.has(f.id) ? { ...f, x: f.x + dx, y: f.y + dy } : f
      )
      // 移动的若是子 Frame，其父需重新裹住 → 全场景 reflow
      return { canvas: { ...s.canvas, frames: reflowFrames(moved) } }
    }),

  // 帧尺寸由 reflowFrames 依内容自动裹紧（Req G），无手动 resize；保留方法只作兜底 reflow
  resizeFrame: (id) =>
    set((s) => {
      if (!s.canvas.frames.some((f) => f.id === id)) return s
      return { canvas: { ...s.canvas, frames: reflowFrames(s.canvas.frames) } }
    }),

  toggleCollapse: (id) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
      }
    })),

  moveNode: (frameId, nodeId, x, y) =>
    set((s) => {
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId
          ? {
              ...f,
              // 钳制左/上边界，避免模块跑到 Frame 头部或左侧外；右/下由 reflow 自动裹住
              nodes: f.nodes.map((n) =>
                n.id === nodeId ? { ...n, x: Math.max(PAD, x), y: Math.max(HEAD + PAD, y) } : n
              )
            }
          : f
      )
      return { canvas: { ...s.canvas, frames: reflowFrames(frames) } }
    }),

  resizeNode: (frameId, nodeId, w, h) =>
    set((s) => {
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId
          ? {
              ...f,
              nodes: f.nodes.map((n) =>
                n.id === nodeId ? { ...n, w: Math.max(120, w), h: Math.max(80, h) } : n
              )
            }
          : f
      )
      // 放大模块撑大所属 Frame 后，顶层 Frame 之间去重叠（把被压的邻居往下让），防相互遮挡
      return { canvas: { ...s.canvas, frames: reflowSeparate(frames) } }
    }),

  settleNode: (frameId, nodeId) =>
    set((s) => {
      const f0 = s.canvas.frames.find((f) => f.id === frameId)
      const node = f0?.nodes.find((n) => n.id === nodeId)
      if (!f0 || !node) return s
      const others = f0.nodes.filter((n) => n.id !== nodeId).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
      // 不重叠则不动（保留用户手放的位置）
      if (!others.some((o) => boxOverlap({ x: node.x, y: node.y, w: node.w, h: node.h }, o))) return s
      const { x, y } = findFreePos(others, node.w, node.h, node.x, node.y)
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId ? { ...f, nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)) } : f
      )
      return { canvas: { ...s.canvas, frames: reflowFrames(frames) } }
    }),

  moveNodeToFrame: (fromFrameId, nodeId, toFrameId) =>
    set((s) => {
      if (fromFrameId === toFrameId) return s
      const fromF = s.canvas.frames.find((f) => f.id === fromFrameId)
      const node = fromF?.nodes.find((n) => n.id === nodeId)
      if (!fromF || !node) return s
      // 先从原 Frame 摘除，再堆叠进目标 Frame（保留节点 id 与内容），最后全场景 reflow
      let frames = s.canvas.frames.map((f) =>
        f.id === fromFrameId ? { ...f, nodes: f.nodes.filter((n) => n.id !== nodeId) } : f
      )
      frames = frames.map((f) =>
        f.id === toFrameId ? placeNodeInFrame(f, { ...node }, frames) : f
      )
      return { canvas: { ...s.canvas, frames: reflowFrames(frames) } }
    }),

  addFileNode: (frameId, pane, x, y) =>
    set((s) => {
      const w = pane.kind === 'image' ? 260 : pane.kind === 'web' ? 320 : 300
      const h = pane.kind === 'web' ? 260 : pane.kind === 'image' ? 200 : 220
      // 插到离松手鼠标点最近的空位（x,y 已是相对 Frame 的落点），避开已有模块重叠
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId ? placeNodeAtPoint(f, { id: uid('cnode'), pane, x, y, w, h }, x, y) : f
      )
      return { canvas: { ...s.canvas, frames: reflowSeparate(frames) } }
    }),

  addComponentNode: (frameId, type, x, y, w, h) =>
    set((s) => {
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId
          ? placeNodeAtPoint(f, { id: uid('cnode'), component: { type }, x, y, w, h }, x, y)
          : f
      )
      return { canvas: { ...s.canvas, frames: reflowSeparate(frames) } }
    }),

  removeNode: (frameId, nodeId) =>
    set((s) => {
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId ? { ...f, nodes: f.nodes.filter((n) => n.id !== nodeId) } : f
      )
      return { canvas: { ...s.canvas, frames: reflowFrames(frames) } }
    }),

  addShape: (shape) =>
    set((s) => ({
      canvas: { ...s.canvas, shapes: [...s.canvas.shapes, { ...shape, id: uid('shape') }] }
    })),

  updateShape: (id, patch) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        shapes: s.canvas.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh))
      }
    })),

  removeShape: (id) =>
    set((s) => ({
      canvas: { ...s.canvas, shapes: s.canvas.shapes.filter((sh) => sh.id !== id) }
    })),

  renameFrame: (id, name) =>
    set((s) => ({
      canvas: { ...s.canvas, frames: s.canvas.frames.map((f) => (f.id === id ? { ...f, name } : f)) }
    })),

  // 删 Frame：连同所有后代子 Frame 一起删，逐个 closeLeaf 杀掉各自的成员终端
  removeFrame: (id) => {
    const s = get()
    const desc = collectDescendants(s.canvas.frames, id)
    const toRemove = new Set([id, ...desc])
    s.canvas.frames
      .filter((f) => toRemove.has(f.id))
      .forEach((frame) =>
        frame.nodes.forEach((n) => {
          if (!n.leafId) return
          const tab = s.tabs.find((t) => collectLeaves(t.root).some((l) => l.id === n.leafId))
          if (tab) s.closeLeaf(tab.id, n.leafId)
        })
      )
    set((st) => ({
      canvas: {
        ...st.canvas,
        frames: reflowFrames(st.canvas.frames.filter((f) => !toRemove.has(f.id)))
      }
    }))
  },

  addSubFrame: (parentId, folderPath, name) =>
    set((s) => {
      const parent = s.canvas.frames.find((f) => f.id === parentId)
      if (!parent) return s
      // 堆叠到父 Frame 现有内容（节点 + 已有子 Frame）下方，避免与终端等重叠（世界坐标）
      const nodeBottom = parent.nodes.length ? Math.max(...parent.nodes.map((n) => n.y + n.h)) : HEAD
      const childBottom = s.canvas.frames
        .filter((c) => c.parentId === parentId)
        .reduce((m, c) => Math.max(m, c.y - parent.y + (c.collapsed ? HEAD : c.h)), HEAD)
      const offY = Math.max(nodeBottom, childBottom, HEAD) + GAP
      const sub: CanvasFrame = {
        id: uid('frame'),
        projectId: parent.projectId,
        name,
        parentId,
        folderPath,
        x: parent.x + PAD,
        y: parent.y + offY,
        w: 320,
        h: 140,
        collapsed: false,
        nodes: []
      }
      return { canvas: { ...s.canvas, frames: reflowFrames([...s.canvas.frames, sub]) } }
    }),

  duplicateNode: (frameId, nodeId) =>
    set((s) => {
      const frames = s.canvas.frames.map((f) => {
        if (f.id !== frameId) return f
        const n = f.nodes.find((x) => x.id === nodeId)
        if (!n || n.leafId) return f
        return { ...f, nodes: [...f.nodes, { ...n, id: uid('cnode'), x: n.x + 22, y: n.y + 22 }] }
      })
      return { canvas: { ...s.canvas, frames: reflowFrames(frames) } }
    }),

  addTerminalNode: async (frameId) => {
    const frame = get().canvas.frames.find((f) => f.id === frameId)
    if (!frame) return
    const before = new Set(
      get()
        .tabs.filter((t) => t.projectId === frame.projectId)
        .flatMap((t) => collectLeaves(t.root).map((l) => l.id))
    )
    await get().openTerminal({ projectId: frame.projectId })
    const newLeaf = get()
      .tabs.filter((t) => t.projectId === frame.projectId)
      .flatMap((t) => collectLeaves(t.root))
      .find((l) => !before.has(l.id))
    if (!newLeaf) return
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: reflowSeparate(
          s.canvas.frames.map((f) =>
            f.id === frameId
              ? placeNodeInFrame(
                  f,
                  { id: uid('cnode'), leafId: newLeaf.id, x: 0, y: 0, w: NODE_W, h: NODE_H },
                  s.canvas.frames
                )
              : f
          )
        )
      }
    }))
  },

  prefillTerminal: async (cmd) => {
    const s = get()
    const before = new Set(s.tabs.flatMap((t) => collectLeaves(t.root).map((l) => l.id)))
    // 画布模式且有顶层 Frame → 开成画布上的终端节点（用户正看着那儿）；否则退回普通新终端
    const frame = s.viewMode === 'canvas' ? s.canvas.frames.find((f) => !f.parentId) : undefined
    if (frame) await get().addTerminalNode(frame.id)
    else await get().openTerminal()
    const leaf = get()
      .tabs.flatMap((t) => collectLeaves(t.root))
      .find((l) => !before.has(l.id))
    if (leaf?.pane.kind !== 'terminal') return
    const ptyId = leaf.pane.ptyId
    // 新开的终端要先把 shell 的启动输出（提示符、rc 脚本回显）吐完，
    // 太早写进去会被冲掉，用户看到的是一行残缺命令
    setTimeout(() => window.api.pty.write(ptyId, cmd), 700)
    // 顺手把画布挪到这个新终端上，不然它可能落在视口外
    if (frame) {
      const node = get().canvas.frames.find((f) => f.id === frame.id)?.nodes.find((n) => n.leafId === leaf.id)
      if (node) get().focusCanvasNode(frame.id, node.id)
    }
  },

  addBrowserNode: (frameId) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: reflowSeparate(
          s.canvas.frames.map((f) =>
            f.id === frameId
              ? placeNodeInFrame(
                  f,
                  { id: uid('cnode'), pane: { kind: 'web', url: null }, x: 0, y: 0, w: 480, h: 340 },
                  s.canvas.frames
                )
              : f
          )
        )
      }
    })),

  addWebNode: (frameId, url) => {
    const id = uid('cnode')
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: reflowSeparate(
          s.canvas.frames.map((f) =>
            f.id === frameId
              ? placeNodeInFrame(f, { id, pane: { kind: 'web', url }, x: 0, y: 0, w: 480, h: 340 }, s.canvas.frames)
              : f
          )
        )
      }
    }))
    // 聚焦到新建的浏览器节点（画布 pan 过去）
    get().focusCanvasNode(frameId, id)
  },

  setNodeUrl: (frameId, nodeId, url) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? {
                ...f,
                nodes: f.nodes.map((n) =>
                  n.id === nodeId && n.pane?.kind === 'web'
                    ? { ...n, pane: { ...n.pane, url } }
                    : n
                )
              }
            : f
        )
      }
    })),

  setWebNodeTitle: (frameId, nodeId, title) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? {
                ...f,
                nodes: f.nodes.map((n) =>
                  n.id === nodeId && n.pane?.kind === 'web'
                    ? { ...n, pane: { ...n.pane, title } }
                    : n
                )
              }
            : f
        )
      }
    })),

  focusCanvasNode: (frameId, nodeId) => {
    const s = get()
    const f = s.canvas.frames.find((x) => x.id === frameId)
    const n = f?.nodes.find((x) => x.id === nodeId)
    if (!f || !n) return
    const vp = document.querySelector('.canvas-viewport') as HTMLElement | null
    const vw = vp?.clientWidth ?? window.innerWidth
    const vh = vp?.clientHeight ?? window.innerHeight
    const scale = s.canvas.viewport.scale // 保持当前缩放，只平移
    const cx = f.x + n.x + n.w / 2
    const cy = f.y + n.y + n.h / 2
    get().setViewport({ x: vw / 2 - cx * scale, y: vh / 2 - cy * scale, scale })
  },

  // 一键整理：以左上角为基准，按模块自身大小做「行式打包」重排——
  // 同一行顶端对齐、行间等距，宽度放不下就换行；不改模块大小，只改位置。
  tidyFrame: (frameId) =>
    set((s) => {
      const frame = s.canvas.frames.find((f) => f.id === frameId)
      if (!frame || !frame.nodes.length) return s
      // 若 Frame 里有子 Frame，模块从子 Frame 下方开始排，避免压住它们
      const childBottom = s.canvas.frames
        .filter((c) => c.parentId === frameId)
        .reduce((m, c) => Math.max(m, c.y - frame.y + (c.collapsed ? HEAD : c.h)), 0)
      const startY = childBottom ? childBottom + GAP : HEAD + PAD
      // 保持用户原有布局意图：按阅读顺序（先上后左）决定排列先后
      const order = [...frame.nodes].sort((a, b) => a.y - b.y || a.x - b.x)
      // 行宽：至少放得下最宽的模块，默认沿用 Frame 当前内容宽度
      const maxW = Math.max(frame.w - PAD * 2, ...order.map((n) => n.w))
      let x = PAD
      let y = startY
      let rowH = 0
      const placed = new Map<string, { x: number; y: number }>()
      for (const n of order) {
        if (x > PAD && x + n.w > PAD + maxW) {
          x = PAD
          y += rowH + GAP
          rowH = 0
        }
        placed.set(n.id, { x, y })
        x += n.w + GAP
        rowH = Math.max(rowH, n.h)
      }
      // 按原数组顺序写回（数组下标即 z 序，不要因排序改变层级）
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId
          ? { ...f, nodes: f.nodes.map((n) => ({ ...n, ...(placed.get(n.id) ?? {}) })) }
          : f
      )
      return { canvas: { ...s.canvas, frames: reflowSeparate(frames) } }
    }),

  // 重命名画布节点 → 同步分屏那边的标签名（两个模式的终端名双向一致）
  renameNode: (frameId, nodeId, name) =>
    set((s) => {
      const trimmed = name.trim()
      const leafId = s.canvas.frames
        .find((f) => f.id === frameId)
        ?.nodes.find((n) => n.id === nodeId)?.leafId
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId
          ? {
              ...f,
              nodes: f.nodes.map((n) =>
                n.id === nodeId ? { ...n, name: trimmed || undefined } : n
              )
            }
          : f
      )
      // 该节点绑定着某个 leaf → 把它所属 tab 的标题一并改掉（清空则恢复自动标题）
      const tabs = leafId
        ? s.tabs.map((t) =>
            collectLeaves(t.root).some((l) => l.id === leafId)
              ? trimmed
                ? { ...t, title: trimmed, customTitle: true }
                : {
                    ...t,
                    title: s.projects.find((p) => p.id === t.projectId)?.name ?? '终端',
                    customTitle: false
                  }
              : t
          )
        : s.tabs
      return { canvas: { ...s.canvas, frames }, tabs }
    }),

  setNodeAgent: (frameId, nodeId, agent) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? {
                ...f,
                nodes: f.nodes.map((n) =>
                  n.id === nodeId ? { ...n, agent: agent ?? undefined } : n
                )
              }
            : f
        )
      }
    })),

  setNodeComponentProps: (frameId, nodeId, props) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? {
                ...f,
                nodes: f.nodes.map((n) =>
                  n.id === nodeId && n.component
                    ? { ...n, component: { ...n.component, props: { ...n.component.props, ...props } } }
                    : n
                )
              }
            : f
        )
      }
    })),

  maximizedNode: null,
  setMaximizedNode: (v) => set({ maximizedNode: v }),
  canvasSel: [],
  setCanvasSel: (keys) => set({ canvasSel: keys }),
  toggleCanvasSel: (key, additive) =>
    set((s) => {
      if (additive)
        return {
          canvasSel: s.canvasSel.includes(key)
            ? s.canvasSel.filter((k) => k !== key)
            : [...s.canvasSel, key]
        }
      // 非累加：已是唯一选中则保持，否则替换为仅此项
      if (s.canvasSel.length === 1 && s.canvasSel[0] === key) return s
      return { canvasSel: [key] }
    }),
  clearCanvasSel: () => set((s) => (s.canvasSel.length ? { canvasSel: [] } : s))
})
