// 画布的落盘形态与坏存档防御。
//
// 序列化和 sanitize 是同一件事的两面：一个决定「写出去长什么样」，
// 一个决定「读回来遇到畸形数据怎么办」。分开放的话，改了写入格式却忘了
// 放宽读取校验，下次启动就是一片白——所以它们必须挨着。
import type { CanvasFrame, CanvasNode, CanvasScene, CanvasShape, CanvasViewport, FrameStatus, NodeAgent, TodoBoard, ViewMode } from './types'
import type { LeafNode, PaneState } from '../../layout'
// 值 import 一律带 .ts 扩展名：`npm test` 是 `node --test` 直接加载 .ts，
// 不带扩展名它解析不到（表现是整个测试文件 ERR_MODULE_NOT_FOUND、一条都跑不起来，
// 而汇总行只会说 fail 1，很容易被当成某条断言挂了）。
// `import type` 不受影响 —— 那行在运行时会被整个擦掉。
import { HEAD, NODE_H, NODE_W, PAD } from './layout.ts'
import { sanitizeTodoBoard } from './todoBoard.ts'
import { DEFAULT_VIEW_MODE, restoreViewMode } from './viewModeRestore.ts'
import type { AgentKind } from '../../../../shared/types'

export const initialScene: CanvasScene = {
  viewport: { x: 0, y: 0, scale: 1 },
  frames: [],
  shapes: [],
  freeNodes: [],
  todos: []
}

/** 落盘的画布场景（含 viewMode）。终端节点的 leafId 已剥离（会话相关，重开时重绑）。 */
export interface PersistedCanvas {
  /** schema 版本；读时按版本迁移（当前恢复路径统一走 sanitizeCanvas 兜底，不强依赖） */
  version?: number
  viewMode: ViewMode
  /** 用户是否**亲手**选过视图。
   *
   *  存在的唯一理由：默认视图从「分屏」改成了「画布」，而
   *  **「亲手选了分屏」和「从没动过默认值」在存档里长得一模一样**（都是 `viewMode:'split'`）。
   *  没有这个字段就只能二选一：要么尊重所有 split（新默认对老用户完全不生效），
   *  要么一并推进画布（把明确选了分屏的人也掀了）。
   *
   *  老存档没有这个字段，按 viewMode 的值倒推：
   *  · 不是 split（canvas/board/gantt）→ 当时明确切过（默认是 split，不切不会变成别的）→ 尊重
   *  · 是 split 或缺失 → 无从追溯，按「没选过」用新默认；**用户切回分屏后这个字段就写上了**，
   *    最多被打扰一次。 */
  viewModePicked?: boolean
  viewport: CanvasViewport
  frames: CanvasFrame[]
  shapes: CanvasShape[]
  freeNodes: CanvasNode[]
  todos: TodoBoard[]
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
  leafPaneOf: (leafId: string) => PaneState | undefined,
  viewModePicked = false
): PersistedCanvas {
  return {
    version: CANVAS_VERSION,
    viewMode,
    viewModePicked,
    viewport: canvas.viewport,
    frames: canvas.frames.map((f) => ({
      ...f,
      nodes: f.nodes.map((n) => {
        const copy = { ...n }
        if (n.leafId) {
          const pane = leafPaneOf(n.leafId)
          if (pane && (pane.kind === 'code' || pane.kind === 'image' || pane.kind === 'web')) {
            copy.pane = pane // 非终端 leaf → 存成文件节点
          } else if (pane?.kind === 'agent') {
            // **agent 节点必须落盘**，否则重开后它既没有 leafId 也没有 pane/component，
            // materializeCanvas 那条「三者皆无 = 终端占位」的判据会把它当终端重开一个 shell
            // —— 用户看到的是「我的对话节点变成了终端」。
            //
            // 两个 id 待遇相反，别混：
            // · sessionId（ac-N，Eas-Term 内部的会话号）**不存** —— 主进程一退就无效，
            //   存下来只会让重开后的界面以为有个活会话，send/stop 都打到不存在的 id 上。
            // · resumeId（CLI 自己的会话 id）**要存** —— 它就是为跨重启续上下文设计的，
            //   不存的话重开这个节点，模型完全不记得之前聊过什么。
            // · cli（用哪个 CLI）**要存**。2026-09-03 起它不再只是内存里的一次性传参：
            //   用户在空 Frame 上点了「Codex」，重启之后这个节点还得是 Codex，
            //   而不是悄悄退回 pickDefaultCli 的推测值。
            //   老存档里没有这个字段 → 读回来是 undefined → 正好退回原来的行为。
            // · cli / roleId **都要存**：用户选的 CLI 和角色重启后还得是那个
            copy.pane = {
              kind: 'agent',
              cwd: pane.cwd,
              resumeId: pane.resumeId,
              // 签发者要一起存 —— 只存 resumeId 不存签发者，重启后又得回去猜（事故的根）
              resumeCli: pane.resumeCli,
              cli: pane.cli,
              roleId: pane.roleId
            }
          }
        }
        delete copy.leafId
        return copy
      })
    })),
    shapes: canvas.shapes,
    // 自由节点只会是文件预览（拖知识库文件生成），不会有 leafId，原样落盘即可
    freeNodes: canvas.freeNodes,
    // 待办清单不含 leafId / pane，原样落盘即可（同 shapes）
    todos: canvas.todos
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
//
// **这个函数早于角色系统。** 它写于「接 Codex」那一阶段,当时 NodeAgent 只有
// kind/model/effort 三个字段;后来角色系统加了 roleId 和 session,但没人回来
// 补这里 —— 于是每次画布落盘再读回(重启、甚至只是失焦触发的防抖保存),
// 这两个字段被原样吃掉。表现就是「选好的角色重启后弹回无角色」,
// 而且「回溯上次会话」也跟着失效(session 没了,回溯只能靠 CLI 自己的 -c/--resume --last,
// 会在同项目多个终端间互相抢)。这是真会发生的数据丢失,不是显示问题。
export function migrateAgent(raw: unknown): NodeAgent | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  const kind: AgentKind = a.kind === 'codex' ? 'codex' : 'claude'
  const toRec = (v: unknown): Partial<Record<AgentKind, string>> | undefined =>
    typeof v === 'string'
      ? { [kind]: v }
      : v && typeof v === 'object'
        ? (v as Partial<Record<AgentKind, string>>)
        : undefined
  return {
    kind,
    model: toRec(a.model),
    effort: toRec(a.effort),
    session: toRec(a.session),
    roleId: typeof a.roleId === 'string' ? a.roleId : undefined
  }
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

/** 旧存档里 frame.status 的合法值。
 *
 *  **这个字段本身已经废弃** —— 状态在 0.4.8 提升到了项目上（project.status）。
 *  留着只为一件事：启动时把老数据搬过去（见 projectsSlice 的 migrateFrameStatus），
 *  搬完就清空。所以白名单固定是当年那三个内置值，不跟着用户新建的列走。 */
export const FRAME_STATUSES = new Set<FrameStatus>(['doing', 'todo', 'done'])

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
    status: FRAME_STATUSES.has(f.status as FrameStatus) ? (f.status as FrameStatus) : undefined,
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
    const freeNodes = Array.isArray(r.freeNodes)
      ? r.freeNodes.map(sanitizeNode).filter((n): n is CanvasNode => n !== null)
      : []
    // 老存档没有 todos 字段（这个模块比 canvas.json 晚出现）→ 安全地当成 []，不是坏档。
    const todos = Array.isArray(r.todos)
      ? r.todos.map(sanitizeTodoBoard).filter((b): b is TodoBoard => b !== null)
      : []
    // 规则抽在 viewModeRestore.ts（那边不引 store/shared 那条链，能单测）
    const vm = restoreViewMode(r)
    return {
      scene: {
        viewMode: vm.viewMode,
        viewModePicked: vm.viewModePicked,
        viewport: sanitizeViewport(r.viewport),
        frames,
        shapes,
        freeNodes,
        todos
      },
      droppedFrames: rawFrames.length - frames.length
    }
  } catch {
    return {
      scene: {
        // 走到这里 = 没有可用存档（全新用户，或存档坏到读不出来）。
        // **全新用户正是新默认要服务的人**；picked 留 false，
        // 他之后亲手切到别的视图才会写上。
        viewMode: DEFAULT_VIEW_MODE,
        viewModePicked: false,
        viewport: { x: 0, y: 0, scale: 1 },
        frames: [],
        shapes: [],
        freeNodes: [],
        todos: []
      },
      droppedFrames: 0
    }
  }
}
