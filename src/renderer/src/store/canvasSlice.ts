// 画布切片：全局唯一的无限画布场景（单例，不属于任何 tab）。
// viewMode 全局切换分屏 / 画布；canvas 场景与 split 树共享同一批 leaf（见 §04 数据模型）。
// 节点通过 leafId 引用 split 树里的 leaf → 两视图同一个 PaneView 实例 → 终端不断连。
//
// 这个文件现在只剩 action。其余三块：
//   canvas/types.ts    数据形状与切片接口（对外契约）
//   canvas/layout.ts   几何计算（纯函数，不碰 store）
//   canvas/persist.ts  落盘格式与坏存档防御

import type { StateCreator } from 'zustand'
import { teamModeTargetId } from '../features/canvas/teamMode'
import { collectLeaves, LeafNode, PaneState } from '../layout'
import { uid } from './shared'
import type { AppState } from './types'

import type {
  CanvasFrame,
  CanvasNode,
  CanvasScene,
  CanvasShape,
  CanvasSlice,
  CanvasViewport,
  FrameStatus,
  NodeAgent,
  TodoBoard,
  TodoItem,
  ViewMode
} from './canvas/types'
import {
  GAP,
  HEAD,
  NODE_H,
  NODE_W,
  PAD,
  boxOverlap,
  collectDescendants,
  deoverlapFrames,
  makeProjectFrame,
  placeNodeAtPoint,
  placeNodeInFrame,
  reflowFrames,
  reflowSeparate,
  findFreePos,
  findFreePosWorld,
  pushDownOverlaps
} from './canvas/layout'
import { clampScale, finiteOr, initialScene, sanitizeCanvas, serializeCanvas } from './canvas/persist'
import { fitScale } from './canvas/fitScale'
import { tidyOrder } from './canvas/tidyOrder'
import {
  TODO_BOARD_DEFAULT_H,
  TODO_BOARD_DEFAULT_W,
  moveTodoItem,
  toggleTodoItemDone as applyToggleTodoItemDone
} from './canvas/todoBoard'
import type { PersistedCanvas } from './canvas/persist'
import { track } from '../features/notify/track'
import { soleFrameIdOfSel } from './canvas/selKey'
import { emptyUndo, pushUndo, stepUndo, stepRedo, snapshotOf, parseSnapshot } from './canvas/undo'
import type { UndoState } from './canvas/undo'

// 这些是画布对外的公开接口，调用点一直从 './canvasSlice' 取，拆分后原样转出去
export type {
  CanvasFrame,
  CanvasNode,
  CanvasScene,
  CanvasShape,
  CanvasSlice,
  CanvasViewport,
  FrameStatus,
  NodeAgent,
  PersistedCanvas,
  TodoBoard,
  TodoItem,
  ViewMode
}
export { serializeCanvas }


// materializeCanvas 防重入（避免恢复与进画布同时触发导致重复 spawn）
let materializing = false

// 缩放手势结束判定:每次 scale 变都重置,停 160ms 无新缩放 → 把 committedScale 落到当前 scale
let commitScaleTimer: ReturnType<typeof setTimeout> | null = null

/** 画布上选中了东西 → 顺带把「当前项目」切过去，右侧抽屉的项目高亮和文件树才跟得上你的手。
 *
 *  只认「单选一个 Frame」：多选时说不清该跟谁，与其乱跳不如不动。
 *  子 Frame 自己不带 projectId（那是顶层 Frame 的字段），得沿 parentId 往上找。
 *  返回空对象表示「这次不改」——展开进 set 的返回值里刚好是无操作。 */
function followSel(s: AppState, keys: string[]): { activeProjectId?: string } {
  // 「选中的东西在哪个 Frame 里」——选中 Frame 本身、或选中它里面的节点，都算。
  // 判据在 store/canvas/selKey.ts，skill 面板用的是同一份。
  const fid = soleFrameIdOfSel(keys)
  if (!fid) return {}
  let f = s.canvas.frames.find((x) => x.id === fid)
  // 上限 8 层纯粹是防呆：数据坏掉出现环时不至于把界面卡死
  for (let i = 0; f && !f.projectId && f.parentId && i < 8; i++) {
    const pid: string = f.parentId
    f = s.canvas.frames.find((x) => x.id === pid)
  }
  const projectId = f?.projectId
  return projectId && projectId !== s.activeProjectId ? { activeProjectId: projectId } : {}
}

/** Frame → 它所属项目的 id。子 Frame（文件夹）自己可能没有 projectId，沿 parentId 往上找。
 *  循环引用（理论上不该有，但存档是文件、改坏过一次就够受）用 seen 兜住，不会转不出来。 */
export function projectIdOfFrame(
  frames: { id: string; projectId: string | null; parentId?: string | null }[],
  frameId: string
): string | null {
  const seen = new Set<string>()
  let cur = frames.find((f) => f.id === frameId)
  while (cur && !cur.projectId && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur = frames.find((f) => f.id === cur!.parentId)
  }
  return cur?.projectId ?? null
}

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
  // 新默认是画布。**全新用户走的就是这个初值** —— loadCanvas 里 `raw == null` 时
  // 直接 return，根本不进 sanitizeCanvas，所以那边的兜底对没有存档的人不生效。
  viewMode: 'canvas',
  viewModePicked: false,
  canvas: initialScene,
  canvasCommittedScale: 1,

  setViewMode: (mode) => {
    track('view')
    // 亲手切过就记上：之后无论切到哪（包括切回分屏）都以用户的选择为准，
    // 不再套用新默认。这是「亲手选了分屏」与「从没动过」的唯一分水岭。
    set({ viewMode: mode, viewModePicked: true })
    if (mode === 'canvas') {
      // 兜底扫一遍孤儿节点。正常路径（closeLeaf / closeTab / removeProject）都已经就地清了，
      // 这里是防「以后又新增一条关 leaf 的路却忘了清」——那种漏网的表现是画布上一个
      // 点不掉的空白框，而用户要到切进画布才看得见，正好在这儿补上。
      // **必须排在 materializeCanvas 前面**：materialize 只认 leafId 为空的占位节点，
      // 先清掉带死 leafId 的孤儿，不会互相干扰。
      get().pruneOrphanNodes()
      // 首次进画布时，把当前项目的终端 seed 成 Frame（若尚未 seed）
      get().seedCanvas()
      // 恢复来的终端占位节点在此重开绑定（幂等，无占位则空转）
      void get().materializeCanvas()
    }
  },

  loadCanvas: async () => {
    // **撤销记录要等这整套流程跑完再开。** 加载存档、materializeCanvas 重建 leaf
    // 都会改 canvas，但那些不是用户的操作 —— 记进去的话，用户按一次撤销就把画布
    // 退回加载前的空场景（最坏的一种「撤销」）。三条出口（读盘失败 / 没有存档 /
    // 正常走完）都得开，所以包一层 finally，不在每条 return 前各写一遍。
    try {
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
        canvas: {
          viewport: scene.viewport,
          frames: scene.frames,
          shapes: scene.shapes,
          freeNodes: scene.freeNodes,
          todos: scene.todos
        },
        canvasCommittedScale: scene.viewport.scale
      }))
      // 恢复视图。**这里以前是「只 set 非 split」** —— 默认值还是 split 时那样写没问题，
      // 但现在默认是 canvas，再那样写会把「亲手选了分屏」的人也留在 canvas 初值上。
      // 白名单校验已经在 sanitizeCanvas 里做完（三个分支给出的都是合法值），
      // 这里直接采信它算出来的结果。
      set({ viewMode: scene.viewMode, viewModePicked: scene.viewModePicked === true })
      // 启动即静默对齐两个视图：不管现在停在分屏还是画布，都把画布里的终端占位重开成真终端。
      // 分屏与画布共享同一批 leaf，所以画布有几个终端，分屏一开始就有几个——不必等用户切到画布
      // 才「把画布的终端拉到分屏」。await 只等重开完成，不阻塞 UI 渲染。
      await get().materializeCanvas()
  
    } finally {
      set({ undoReady: true })
    }
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
              if (n.leafId || n.component) continue // 已绑定 / 组件 → 跳过
              // **agent 节点也要重建 leaf**，不能跟文件节点一样「有 pane 就跳过」：
              // 带 pane 无 leafId 的节点走的是「画布自带的文件预览节点」那条渲染路
              //（CanvasFileNode，只认 code/image/web），agent 落在那儿会渲染成一个空白框。
              // 它得像终端一样有真的 leaf —— 只是建的时候不 spawn pty。
              // 放在 `n.pane` 判断之前，否则永远进不来。
              const agentPane = n.pane?.kind === 'agent' ? n.pane : undefined
              const isAgent = !!agentPane
              if (n.pane && !isAgent) continue // 文件/图片/网页 → 画布自带节点，不需要 leaf
              const before = new Set(
                get()
                  .tabs.filter((t) => t.projectId === f.projectId)
                  .flatMap((t) => collectLeaves(t.root).map((l) => l.id))
              )
              if (isAgent)
                // **cwd 和 resumeId 都要带上。**
                // 以前这里只传 projectId：cwd 靠项目路径兜底（节点指向子目录或
                // worktree 时就错了），而 resumeId 直接丢掉 —— 落盘时特意存它
                // （persist 里那句「它就是为跨重启续上下文设计的」），恢复时却不用，
                // 于是重启后每个 AI 节点都是「界面摆着历史、模型一个字都不记得」。
                // 2026-08-20 实测：恢复出来的 agent leaf resumeId 全是 null。
                await get().openAgentPane({
                  projectId: f.projectId,
                  // 收窄一次再取字段：PaneState 是联合类型，terminal 分支没有这两个
                  ...(agentPane?.cwd ? { cwd: agentPane.cwd } : {}),
                  ...(agentPane?.resumeId ? { resumeId: agentPane.resumeId } : {})
                })
              else await get().openTerminal({ projectId: f.projectId })
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
                            nn.id === n.id
                              ? // **leafId 回填的同时要把 pane 清掉。**
                                //
                                // `pane` 在存档里的作用只有一个：告诉恢复流程「这个节点
                                // 是 agent 不是终端」。leaf 一建出来它的使命就完了，
                                // 留着会让这个节点同时满足两条渲染路径 ——
                                // CanvasStage 按 `n.pane` 画一个文件节点的壳，
                                // PaneLayer 按 `n.leafId` 再浮一层内容，
                                // 于是节点头部有两套按钮、边框错开 4~5px 露出两条线
                                //（用户 2026-08-20 截图：「新建的 AI 对话是正常的，
                                // 关机再打开之后的窗口就不正常」——差别正在这里）。
                                //
                                // 不影响下次存档：落盘时 persist 会按 leafPaneOf 现查
                                // 当前 leaf 的 pane 重新写进去，不依赖这里留着的这份。
                                { ...nn, leafId: newLeaf.id, pane: undefined }
                              : nn
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
    // 项目在画布上从零开始 → 先开一个面板，Frame 里才有内容。
    // **开的是 AI 对话而不是终端** —— 规格 §六：这个前端是新建 Frame 的新默认
    //（终端保留，只是不再是唯一入口，面板类型下拉里随时能换回去）。
    // 只影响「这个项目一个 leaf 都还没有」这条路；已经开着终端的项目拖进画布，
    // 照旧把现有终端铺进 Frame，不动用户正在干的活。
    let leaves = get()
      .tabs.filter((t) => t.projectId === projectId)
      .flatMap((t) => collectLeaves(t.root))
    if (!leaves.length) {
      await get().openAgentPane({ projectId })
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

  settleResize: (frameId, nodeId) =>
    set((s) => {
      const f0 = s.canvas.frames.find((f) => f.id === frameId)
      if (!f0) return s
      const next = pushDownOverlaps(f0, nodeId)
      if (next === f0) return s // 没压住谁，别白白触发一次重排
      const frames = s.canvas.frames.map((f) => (f.id === frameId ? next : f))
      // 推开之后 Frame 会变高，所以要再收紧一次并让顶层 Frame 之间去重叠
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

  /** 标记「手机碰过这个节点」。手机新建会话、在上面发消息时打。
   *  找不到就静默忽略 —— 节点可能已经被关掉了，那不是错误。 */
  markPhoneNode: (nodeId, at) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.nodes.some((n) => n.id === nodeId)
            ? { ...f, nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, phoneAt: at } : n)) }
            : f
        )
      }
    })),

  /** 你点开它了 → 痕迹消掉。**判据是「你看过」不是「显示过」** */
  clearPhoneNode: (nodeId) =>
    set((s) => {
      // 没打过标记就别动 —— 每次点节点都重建一遍 frames 数组是白白的重渲染
      if (!s.canvas.frames.some((f) => f.nodes.some((n) => n.id === nodeId && n.phoneAt)))
        return s
      return {
        canvas: {
          ...s.canvas,
          frames: s.canvas.frames.map((f) => ({
            ...f,
            nodes: f.nodes.map((n) => {
              if (n.id !== nodeId || !n.phoneAt) return n
              const { phoneAt: _drop, ...rest } = n
              return rest
            })
          }))
        }
      }
    }),

  setNodeAgentSession: (frameId, nodeId, sessionId) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id !== frameId
            ? f
            : {
                ...f,
                nodes: f.nodes.map((n) =>
                  // **只认自带 pane 的 agent 节点**：引用 leaf 的那些会话 id 在 leaf 上
                  //（走 setAgentSessionId），在这儿写会造出两个都说了算的地方
                  n.id === nodeId && n.pane?.kind === 'agent'
                    ? { ...n, pane: { ...n.pane, sessionId } }
                    : n
                )
              }
        )
      }
    })),

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

  // 删画布节点。**如果它是个终端节点（带 leafId），连带把那个 leaf 一起关掉。**
  //
  // 为什么必须连带：画布和分屏共享同一批 leaf，只删画布这一半，分屏/看板里那个终端
  // 还活着、shell 还在跑，而画布上已经找不到它了——用户的说法是「画板里删了，
  // 别的模式没关」。反过来的方向在 tabsSlice.closeLeaf 里补（那边负责扫掉画布上的孤儿）。
  //
  // 不再弹额外确认：右键终端节点的「关闭终端」历来就是直接 closeLeaf 不问，
  // 这里保持同一口径。真要加确认应该两处一起加，别只让其中一条路变得更啰嗦。
  removeNode: (frameId, nodeId) => {
    // 先取 leafId 再删——删完就查不到了
    const leafId = get()
      .canvas.frames.find((f) => f.id === frameId)
      ?.nodes.find((n) => n.id === nodeId)?.leafId
    set((s) => {
      const frames = s.canvas.frames.map((f) =>
        f.id === frameId ? { ...f, nodes: f.nodes.filter((n) => n.id !== nodeId) } : f
      )
      return {
        canvas: { ...s.canvas, frames: reflowFrames(frames) },
        // 删的正好是最大化的那个 → 顺手清掉，别在状态里留一个指向已删节点的引用。
        // 读取端有 liveMaximizedNode 兜底（悬空也不会出事），但脏状态本身还是要清：
        // canvas_get_state 会把它当 `maximized` 字段报给 AI，留着就是在骗它。
        maximizedNode: s.maximizedNode?.nodeId === nodeId ? null : s.maximizedNode
      }
    })
    if (!leafId) return
    const tab = get().tabs.find((t) => collectLeaves(t.root).some((l) => l.id === leafId))
    // closeLeaf 回头会调 pruneOrphanNodes()，那时这个节点已经删掉了 → 空转，不会来回递归
    if (tab) get().closeLeaf(tab.id, leafId)
  },

  // ── 撤销 ────────────────────────────────────────────────────────────────
  // 栈机制在 store/canvas/undo.ts（纯函数、可单测）；这里只负责「什么时候记」
  // 和「怎么把一份快照放回画布」。记录的触发在 store/index.ts 的 subscribe ——
  // 53 个改 canvas 的 action 一个都不用改，也就一个都漏不掉。
  canvasUndo: emptyUndo(),
  undoReady: false,

  undoCanvas: () => applyUndoStep(set, get, stepUndo),
  redoCanvas: () => applyUndoStep(set, get, stepRedo),

  pruneOrphanNodes: () =>
    set((s) => {
      // 只清「有 leafId、但那个 leaf 已经不在 tabs 树里」的节点。
      //
      // **`leafId` 为空的节点绝对不能碰**：那是存档恢复出来的终端占位，
      // materializeCanvas 还等着给它们重开终端并回填 leafId（见 persist.ts 的说明——
      // leafId 是会话相关的，落盘时一律剥离）。误删这些等于每次重启丢光画布上的终端。
      const live = new Set(s.tabs.flatMap((t) => collectLeaves(t.root).map((l) => l.id)))
      const orphan = (n: CanvasNode): boolean => !!n.leafId && !live.has(n.leafId)
      if (!s.canvas.frames.some((f) => f.nodes.some(orphan))) return {} // 没孤儿就别动，省一次重排和整树重渲染
      const dropped = new Set(
        s.canvas.frames.flatMap((f) => f.nodes.filter(orphan).map((n) => n.id))
      )
      const frames = s.canvas.frames.map((f) => ({ ...f, nodes: f.nodes.filter((n) => !orphan(n)) }))
      return {
        canvas: { ...s.canvas, frames: reflowFrames(frames) },
        maximizedNode:
          s.maximizedNode && dropped.has(s.maximizedNode.nodeId) ? null : s.maximizedNode
      }
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

  /** 清空所有标记（快照后用）。一次性，不做撤销 —— 清空是用户在弹窗里按下的，不是副作用 */
  clearShapes: () => set((s) => ({ canvas: { ...s.canvas, shapes: [] } })),

  // ── 待办清单：自由存在（不属于任何 Frame），世界坐标，一个模块装多条待办。
  // 渲染共享 CanvasShapeLayer 的层级，但数据独立于 shapes（见 canvas/types.ts 的 TodoBoard 注释）
  // ——尤其是 clearShapes 不会碰这里，快照清标记不该连带清掉待办。
  addTodoBoard: (x, y) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        todos: [
          ...s.canvas.todos,
          { id: uid('todo'), x, y, w: TODO_BOARD_DEFAULT_W, h: TODO_BOARD_DEFAULT_H, items: [] }
        ]
      }
    })),

  moveTodoBoard: (id, x, y) =>
    set((s) => ({
      canvas: { ...s.canvas, todos: s.canvas.todos.map((b) => (b.id === id ? { ...b, x, y } : b)) }
    })),

  removeTodoBoard: (id) =>
    set((s) => ({
      canvas: { ...s.canvas, todos: s.canvas.todos.filter((b) => b.id !== id) }
    })),

  renameTodoBoard: (id, title) =>
    set((s) => ({
      canvas: { ...s.canvas, todos: s.canvas.todos.map((b) => (b.id === id ? { ...b, title } : b)) }
    })),

  // 插到最前面而不是追加到末尾：点「+」是「现在马上要写一条」的手势，插在最前不用滚动
  // 就能看见刚建的空标题卡片，正好也是它立刻进入标题编辑态的地方。
  addTodoItem: (boardId) => {
    const id = uid('titem')
    set((s) => ({
      canvas: {
        ...s.canvas,
        todos: s.canvas.todos.map((b) =>
          b.id === boardId ? { ...b, items: [{ id, title: '', done: false }, ...b.items] } : b
        )
      }
    }))
    return id
  },

  removeTodoItem: (boardId, itemId) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        todos: s.canvas.todos.map((b) =>
          b.id === boardId ? { ...b, items: b.items.filter((it) => it.id !== itemId) } : b
        )
      }
    })),

  updateTodoItem: (boardId, itemId, patch) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        todos: s.canvas.todos.map((b) =>
          b.id === boardId
            ? { ...b, items: b.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
            : b
        )
      }
    })),

  toggleTodoItemDone: (boardId, itemId) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        todos: s.canvas.todos.map((b) =>
          b.id === boardId ? { ...b, items: applyToggleTodoItemDone(b.items, itemId, Date.now()) } : b
        )
      }
    })),

  reorderTodoItem: (boardId, itemId, toIndex) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        todos: s.canvas.todos.map((b) =>
          b.id === boardId ? { ...b, items: moveTodoItem(b.items, itemId, toIndex) } : b
        )
      }
    })),

  // ── 自由节点：拖知识库文件到画布任意位置生成，不属于任何 Frame，世界坐标。
  // 是 shapes 的直接类比（同样独立于 Frame、同样世界坐标），不是节点系统的第二套实现——
  // 所以这几个 action 都不用碰 reflowFrames/placeNodeAtPoint 那套 Frame 专用几何逻辑。
  addFreeFileNode: (pane, x, y, opts) => {
    const id = uid('cnode')
    const w = pane.kind === 'image' ? 260 : pane.kind === 'web' ? 320 : 300
    const h = pane.kind === 'web' ? 260 : pane.kind === 'image' ? 200 : 220
    const others = get().canvas.freeNodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
    const pos = findFreePosWorld(others, w, h, x, y)
    set((s) => ({
      canvas: {
        ...s.canvas,
        freeNodes: [
          ...s.canvas.freeNodes,
          { id, pane, x: pos.x, y: pos.y, w, h, readOnly: opts?.readOnly, writeVia: opts?.writeVia }
        ]
      }
    }))
    return id
  },

  moveFreeNode: (nodeId, x, y) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        freeNodes: s.canvas.freeNodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n))
      }
    })),

  resizeFreeNode: (nodeId, w, h) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        freeNodes: s.canvas.freeNodes.map((n) =>
          n.id === nodeId ? { ...n, w: Math.max(120, w), h: Math.max(80, h) } : n
        )
      }
    })),

  removeFreeNode: (nodeId) =>
    set((s) => ({
      canvas: { ...s.canvas, freeNodes: s.canvas.freeNodes.filter((n) => n.id !== nodeId) },
      // 同 removeNode：删掉的正是最大化那个就顺手清，别留悬空引用
      maximizedNode: s.maximizedNode?.nodeId === nodeId ? null : s.maximizedNode
    })),

  // 自由节点只会是文件预览（pane），不会有 leafId → 不用像 renameNode 那样同步分屏 tab 标题
  renameFreeNode: (nodeId, name) =>
    set((s) => {
      const trimmed = name.trim()
      return {
        canvas: {
          ...s.canvas,
          freeNodes: s.canvas.freeNodes.map((n) =>
            n.id === nodeId ? { ...n, name: trimmed || undefined } : n
          )
        }
      }
    }),

  settleFreeNode: (nodeId) =>
    set((s) => {
      const node = s.canvas.freeNodes.find((n) => n.id === nodeId)
      if (!node) return s
      const others = s.canvas.freeNodes
        .filter((n) => n.id !== nodeId)
        .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
      if (!others.some((o) => boxOverlap({ x: node.x, y: node.y, w: node.w, h: node.h }, o))) return s
      const { x, y } = findFreePosWorld(others, node.w, node.h, node.x, node.y)
      return {
        canvas: { ...s.canvas, freeNodes: s.canvas.freeNodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)) }
      }
    }),

  setFreeNodeUrl: (nodeId, url) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        freeNodes: s.canvas.freeNodes.map((n) =>
          n.id === nodeId && n.pane?.kind === 'web' ? { ...n, pane: { ...n.pane, url } } : n
        )
      }
    })),

  setFreeNodeTitle: (nodeId, title) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        freeNodes: s.canvas.freeNodes.map((n) =>
          n.id === nodeId && n.pane?.kind === 'web' ? { ...n, pane: { ...n.pane, title } } : n
        )
      }
    })),

  duplicateFreeNode: (nodeId) =>
    set((s) => {
      const n = s.canvas.freeNodes.find((x) => x.id === nodeId)
      if (!n) return s
      return {
        canvas: {
          ...s.canvas,
          freeNodes: [...s.canvas.freeNodes, { ...n, id: uid('cnode'), x: n.x + 22, y: n.y + 22 }]
        }
      }
    }),

  focusFreeNode: (nodeId) => {
    const s = get()
    const n = s.canvas.freeNodes.find((x) => x.id === nodeId)
    if (!n) return
    const vp = document.querySelector('.canvas-viewport') as HTMLElement | null
    const vw = vp?.clientWidth ?? window.innerWidth
    const vh = vp?.clientHeight ?? window.innerHeight
    const scale = s.canvas.viewport.scale
    const cx = n.x + n.w / 2
    const cy = n.y + n.h / 2
    get().setViewport({ x: vw / 2 - cx * scale, y: vh / 2 - cy * scale, scale })
  },

  renameFrame: (id, name) =>
    set((s) => ({
      canvas: { ...s.canvas, frames: s.canvas.frames.map((f) => (f.id === id ? { ...f, name } : f)) }
    })),

  // **状态已经不存在 Frame 上了** —— 它是项目的属性（见 shared/types 的 ProjectStatus）。
  // 这个方法保留是因为画布上的入口（标题栏色点、右键菜单）手里只有 frameId；
  // 它负责把 frameId 翻译成 projectId，真正的写入在 setProjectStatus 那一处。
  // 子 Frame（文件夹）打标 = 给它所属的整个项目打标：一个项目的文件夹
  // 不该有自己独立的进度，看板里也没有「文件夹」这种卡片。
  setFrameStatus: (id, status) => {
    const s = get()
    const pid = projectIdOfFrame(s.canvas.frames, id)
    if (pid) void s.setProjectStatus(pid, status)
  },
  // 多 agent 总闸。**写到顶层 Frame 上** —— 子 Frame 是文件夹分组，不该各有一套团队设置
  // （同 setFrameStatus 把 frameId 翻译成 projectId 的道理）。判定统一走 teamModeOf()。
  toggleTeamMode: (id, on) => {
    const target = teamModeTargetId(get().canvas.frames, id)
    if (!target) return
    // 打开开关 = 「我要用多 agent」= 他现在就需要那块面板 —— 直接开出来，
    // 别让他再去扩展能力里拖一个。**只在还没有的时候建**（重复开关不会堆一堆）。
    //
    // 方案 v2 里原本定的是「开了不自动出面板，否则每个开着的项目都挂一块空面板」——
    // 那个担心不成立：开关默认是关的，主动打开就是主动要它。
    //
    // 关掉开关时**不删面板**：它列的是所有会话（不只团队的），仍然有用；
    // 而且删掉会丢掉用户对它位置和大小的调整。不想要就自己关那个节点。
    if (on) {
      const f = get().canvas.frames.find((fr) => fr.id === target)
      const has = f?.nodes.some((n) => n.component?.type === 'team')
      if (f && !has) get().addComponentNode(target, 'team', 16, 16, 420, 300)
    }
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          // 关的时候把字段删掉而不是存 false：canvas.json 里少一个恒假的键，
          // 也让「没设过」和「明确关掉」在存档里长得一样（语义上本来就一样）
          f.id === target ? (on ? { ...f, teamMode: true } : { ...f, teamMode: undefined }) : f
        )
      }
    }))
  },

  // 下面这段留给旧结构：canvas.json 里可能还带着 frame.status，
  // 迁移完就清空（见 projectsSlice 的 migrateFrameStatus）
  clearFrameStatusField: () =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) => (f.status ? { ...f, status: undefined } : f))
      }
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

  addTerminalNode: async (frameId, roleId) => {
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
                  {
                    id: uid('cnode'),
                    leafId: newLeaf.id,
                    // 带角色开的终端：直接把 agent 配好，落下去就是那个岗位，
                    // 不用用户再在控制条上点一遍。kind 取角色钉死的，没钉就默认 claude
                    ...(roleId
                      ? {
                          agent: {
                            kind: (() => {
                              const r = get().roles.find((x) => x.id === roleId)
                              return r && r.kind !== 'auto' ? r.kind : 'claude'
                            })(),
                            roleId
                          } as NodeAgent
                        }
                      : {}),
                    x: 0,
                    y: 0,
                    w: NODE_W,
                    h: NODE_H
                  },
                  s.canvas.frames
                )
              : f
          )
        )
      }
    }))
  },

  // 与 addTerminalNode 同构，只把「开哪种 leaf」换掉。**刻意不复用它加参数** ——
  // 那会让一个函数同时负责两种 pane，而两者往后会各自长出自己的选项
  // （终端有角色/命令预填，agent 有 CLI 与审批模式）。
  //
  // 走 openAgentPane 那条路：它和 openTerminal 逐条对齐，唯一差别是**不 spawn pty**
  // —— agent 面板在用户发第一条消息之前不占任何进程。
  revealAgentSession: async (sessionId, fallback) => {
    const st = get()
    // ① 这个会话挂在哪个 leaf 上。**leaf 才是会话本体** —— 画布节点只是它的可见性，
    //    摘掉节点会话照样活着（removeNode 一行都没碰 leaf），所以这里总是找得到。
    let leafId: string | undefined
    let projectId: string | null | undefined
    for (const t of st.tabs) {
      const hit = collectLeaves(t.root).find(
        (l) => l.pane.kind === 'agent' && l.pane.sessionId === sessionId
      )
      if (hit) {
        leafId = hit.id
        projectId = t.projectId
        break
      }
    }
    // ①-b leaf 没了 —— 用户手动关过这个节点（关节点不杀进程，会话还在主进程那边跑）。
    //     这不是边角情形：那正是「有个在烧钱的进程但任何 UI 都看不见它」的场景，
    //     也是用户 2026-08-20 反馈的原始处境。用 sessionId 重建一个 leaf 接管它 ——
    //     AgentChatView 挂载时看到 pane.sessionId 就直接订阅，preload 那边攒着的
    //     事件会先回放一遍，不会只看到半截。
    if (!leafId) {
      if (!fallback) return false
      const proj = st.projects.find(
        (p) => p.path && (fallback.cwd === p.path || fallback.cwd.startsWith(`${p.path}/`))
      )
      const created = await get().openAgentPane({
        projectId: proj?.id ?? null,
        cwd: fallback.cwd,
        role: fallback.role,
        owner: fallback.owner,
        sessionId,
        // 这是用户主动点开的，就该切过去给他看
        background: false
      })
      if (!created) return false
      leafId = created
      projectId = proj?.id ?? null
    }

    // ② 已经在画布上了 → 只要把视野挪过去，别重复挂一个
    for (const f of st.canvas.frames) {
      const n = f.nodes.find((x) => x.leafId === leafId)
      if (n) {
        st.focusCanvasNode(f.id, n.id)
        return true
      }
    }

    // ③ 不在画布上（默认就是这个状态）→ 挂进它所属项目的 Frame。
    //    优先当前正看着的那个，否则退回这个项目的第一个 Frame。
    //    Frame 没有「当前」这个概念（CanvasScene 里没有 activeFrameId），
    //    取这个项目的第一个即可 —— 团队 agent 都是在项目的 Frame 里派出去的。
    const frame = st.canvas.frames.find((f) => f.projectId === projectId)
    if (!frame) return false
    const nodeId = uid('cnode')
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: reflowSeparate(
          s.canvas.frames.map((f) =>
            f.id === frame.id
              ? placeNodeInFrame(
                  f,
                  { id: nodeId, leafId: leafId as string, x: 0, y: 0, w: NODE_W, h: NODE_H },
                  s.canvas.frames
                )
              : f
          )
        )
      }
    }))
    get().focusCanvasNode(frame.id, nodeId)
    return true
  },

  hideAgentSession: (sessionId) => {
    const st = get()
    let leafId: string | undefined
    for (const t of st.tabs) {
      const hit = collectLeaves(t.root).find(
        (l) => l.pane.kind === 'agent' && l.pane.sessionId === sessionId
      )
      if (hit) {
        leafId = hit.id
        break
      }
    }
    if (!leafId) return false
    for (const f of st.canvas.frames) {
      const n = f.nodes.find((x) => x.leafId === leafId)
      if (n) {
        // **不能走 removeNode** —— 它的尾巴上有一句 `closeLeaf(tab.id, leafId)`，
        // 那是「关掉这个节点」的完整语义，连 leaf 一起关掉。
        // 2026-08-20 真机验证抓到：收起之后 leaf 没了，于是再也点不开
        // （leafSurvivedHide=false、reRevealed=false）。
        //
        // 这里要的是**只摘可见性**：leaf、聊天记录、resumeId 全留着，
        // 点面板还能原样打开。真要结束会话走的是面板上那颗「停」。
        const nodeId = n.id
        const frameId = f.id
        set((st) => ({
          canvas: {
            ...st.canvas,
            frames: reflowFrames(
              st.canvas.frames.map((fr) =>
                fr.id === frameId ? { ...fr, nodes: fr.nodes.filter((x) => x.id !== nodeId) } : fr
              )
            )
          },
          // 收起的正好是最大化的那个 → 一并清掉，别留一个指向已摘节点的引用
          maximizedNode: st.maximizedNode?.nodeId === nodeId ? null : st.maximizedNode
        }))
        return true
      }
    }
    return false
  },

  addAgentNode: async (frameId, opts) => {
    const frame = get().canvas.frames.find((f) => f.id === frameId)
    if (!frame) return undefined
    const before = new Set(
      get()
        .tabs.filter((t) => t.projectId === frame.projectId)
        .flatMap((t) => collectLeaves(t.root).map((l) => l.id))
    )
    await get().openAgentPane({ projectId: frame.projectId, ...opts })
    const newLeaf = get()
      .tabs.filter((t) => t.projectId === frame.projectId)
      .flatMap((t) => collectLeaves(t.root))
      .find((l) => !before.has(l.id))
    if (!newLeaf) return undefined
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
    return newLeaf.id
  },

  prefillTerminal: async (cmd, opts) => {
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
    // run=true 时把回车一起送出去。**这条路只有「用户在确认弹窗里点过安装」才走得到** ——
    // 命令本身来自 agentInstall 的固定方案（我们自己按平台挑的），不是外部输入。
    // 仍然送进**终端**而不是后台执行：装完还要 `claude login`（那步绕不过去）、
    // 公司网络/代理失败时报错摆在眼前比一句「安装失败」有用，
    // 这两条是 agentInstall.ts 开头写的理由，和「是否静默」无关，所以保留。
    setTimeout(() => window.api.pty.write(ptyId, opts?.run ? cmd + '\r' : cmd), 700)
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

  focusCanvasNode: (frameId, nodeId, opts) => {
    const s = get()
    const f = s.canvas.frames.find((x) => x.id === frameId)
    const n = f?.nodes.find((x) => x.id === nodeId)
    if (!f || !n) return
    const vp = document.querySelector('.canvas-viewport') as HTMLElement | null
    const vw = vp?.clientWidth ?? window.innerWidth
    const vh = vp?.clientHeight ?? window.innerHeight
    // 默认保持当前缩放只平移；fit 时缩到整个节点看得全（只缩小不放大，见 fitScale.ts）。
    // 折叠的 Frame 里节点高度按 HEAD 算没有意义，但 fit 只用 n.w/n.h，
    // 拿到的就是这个节点自己的尺寸，不受 Frame 折叠影响
    const scale = opts?.fit
      ? fitScale({ w: n.w, h: n.h }, { w: vw, h: vh }, s.canvas.viewport.scale)
      : s.canvas.viewport.scale
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
      // 终端优先排到第一行左上，其余模块跟在后面；同档内保持阅读顺序。
      // 规则本身连同「怎么认出终端」都在 canvas/tidyOrder.ts，那边有 9 个测试锁着 ——
      // 写错了不会崩、只会表现成「整理完终端不在第一行」，是要靠测试才抓得住的那类。
      const order = tidyOrder(frame.nodes)
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
  startNewChat: (frameId, nodeId) => {
    const exists = get()
      .canvas.frames.find((f) => f.id === frameId)
      ?.nodes.some((n) => n.id === nodeId)
    if (!exists) return undefined
    // 用 uid 拿一个不会撞的新 key。**带随机段无所谓** —— 它跟着节点落盘，
    // 不像 leafId 那样每次重启重新生成（那正是聊天记录以前读不回来的原因）
    const next = uid('chat')
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === frameId
            ? { ...f, nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, chatId: next } : n)) }
            : f
        )
      }
    }))
    return next
  },

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
  setMaximizedNode: (v) =>
    set(() => {
      if (!v) return { maximizedNode: null }
      // **最大化 = 你要专心用这个模块，所以顺手把它选中。**
      // 画布上「未选中的模块」滚轮是拿去平移画布的（见 PaneView 的 onWheel），
      // 不选中的话铺满屏幕之后还得再点一下才能滚内容 —— 而那会儿画布已经被
      // 整个盖住了，平移根本没有意义。
      // 写在 action 里而不是四个调用点各写一遍：三种节点组件 + PaneView 都会调它。
      // 节点的 key（n: / p:）不触发 followSel（那个只认 f:），所以直接置换选中集是安全的。
      const key = v.frameId ? 'n:' + v.frameId + ':' + v.nodeId : 'p:' + v.nodeId
      // canvasSelFromMaximize=true：标记这次的 canvasSel 是最大化的副作用，不是用户真点的
      // （见 types.ts 里这个字段的注释——mcpHandler 的 canvas_snapshot 靠它避免把截图存错项目）。
      // 还原（v 为 null 的分支）故意不清它、也不碰 canvasSel：还原历来就只清 maximizedNode，
      // 这里不改这条既有行为，只是让"是不是最大化遗留"这份标记如实反映现状，直到下一次
      // 真实选中（setCanvasSel/toggleCanvasSel/clearCanvasSel）发生为止。
      return { maximizedNode: v, canvasSel: [key], canvasSelFromMaximize: true }
    }),
  canvasSel: [],
  canvasSelFromMaximize: false,
  setCanvasSel: (keys) => set((s) => ({ canvasSel: keys, canvasSelFromMaximize: false, ...followSel(s, keys) })),
  toggleCanvasSel: (key, additive) =>
    set((s) => {
      if (additive) {
        const keys = s.canvasSel.includes(key)
          ? s.canvasSel.filter((k) => k !== key)
          : [...s.canvasSel, key]
        return { canvasSel: keys, canvasSelFromMaximize: false, ...followSel(s, keys) }
      }
      // 非累加：已是唯一选中则保持 canvasSel 不变（避免无意义重渲染），但如果这个唯一选中
      // 是最大化遗留下来的，用户现在又真实点了它一次，那份"不是真选的"标记也该跟着清掉——
      // 否则"点同一个节点两次"这种最普通的操作也会被当成没选中，把新加的守卫伤到自己人。
      if (s.canvasSel.length === 1 && s.canvasSel[0] === key) {
        return s.canvasSelFromMaximize ? { canvasSelFromMaximize: false } : s
      }
      return { canvasSel: [key], canvasSelFromMaximize: false, ...followSel(s, [key]) }
    }),
  clearCanvasSel: () =>
    set((s) => (s.canvasSel.length ? { canvasSel: [], canvasSelFromMaximize: false } : s)),

  canvasTool: 'select',
  setCanvasTool: (tool) => set({ canvasTool: tool }),
  editingSticky: null,
  setEditingSticky: (id) => set({ editingSticky: id })
})

/**
 * 撤销/重做共用的一步。两者差别只在从哪个方向取快照，其余（应用、清孤儿、
 * 保住视口）完全一样，所以传一个 step 函数进来，不写两遍。
 *
 * **应用快照后必须跑一次 pruneOrphanNodes。** 快照里可能有终端节点，而它的
 * leaf 早在删除时就被 closeLeaf 杀掉了（canvasSlice 的 removeNode / removeFrame）——
 * shell 没了、历史输出也没了，放回来只是个指向死 leaf 的空壳。prune 会把它们清掉，
 * 于是「终端不进撤销栈」这条（用户定的）就落到实处：撤销一个含终端的 Frame 时，
 * 文件节点、便签、布局都回来，终端不假装回来。
 *
 * 视口不动：快照本来就不含 viewport（见 undo.ts）。撤销改的是内容，不是你在看哪儿。
 */
function applyUndoStep(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  step: (st: UndoState, current: string) => { next: UndoState; snapshot: string } | null
): boolean {
  const st = get()
  const r = step(st.canvasUndo, snapshotOf(st.canvas))
  if (!r) return false
  const parsed = parseSnapshot(r.snapshot)
  if (!parsed) return false // 快照坏了：什么都不做，也不消耗这一步
  set({
    canvas: {
      ...st.canvas, // viewport 原样留着
      frames: parsed.frames as CanvasScene['frames'],
      shapes: parsed.shapes as CanvasScene['shapes'],
      freeNodes: parsed.freeNodes as CanvasScene['freeNodes'],
      todos: parsed.todos as CanvasScene['todos']
    },
    canvasUndo: r.next,
    // 指向已删节点的引用要清掉，理由同 removeNode 里那段：
    // canvas_get_state 会把它当 maximized 报给 AI，留着就是在骗它
    maximizedNode: null
  })
  get().pruneOrphanNodes()
  return true
}
