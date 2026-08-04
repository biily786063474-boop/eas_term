// 画布切片：全局唯一的无限画布场景（单例，不属于任何 tab）。
// viewMode 全局切换分屏 / 画布；canvas 场景与 split 树共享同一批 leaf（见 §04 数据模型）。
// 节点通过 leafId 引用 split 树里的 leaf → 两视图同一个 PaneView 实例 → 终端不断连。
//
// 这个文件现在只剩 action。其余三块：
//   canvas/types.ts    数据形状与切片接口（对外契约）
//   canvas/layout.ts   几何计算（纯函数，不碰 store）
//   canvas/persist.ts  落盘格式与坏存档防御

import type { StateCreator } from 'zustand'
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
import type { PersistedCanvas } from './canvas/persist'
import { track } from '../features/notify/track'

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
  if (keys.length !== 1 || !keys[0].startsWith('f:')) return {}
  let f = s.canvas.frames.find((x) => x.id === keys[0].slice(2))
  // 上限 8 层纯粹是防呆：数据坏掉出现环时不至于把界面卡死
  for (let i = 0; f && !f.projectId && f.parentId && i < 8; i++) {
    const pid: string = f.parentId
    f = s.canvas.frames.find((x) => x.id === pid)
  }
  const projectId = f?.projectId
  return projectId && projectId !== s.activeProjectId ? { activeProjectId: projectId } : {}
}

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
  viewMode: 'split',
  canvas: initialScene,
  canvasCommittedScale: 1,

  setViewMode: (mode) => {
    track('view')
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
      canvas: { viewport: scene.viewport, frames: scene.frames, shapes: scene.shapes, freeNodes: scene.freeNodes },
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
      return {
        canvas: { ...s.canvas, frames: reflowFrames(frames) },
        // 删的正好是最大化的那个 → 顺手清掉，别在状态里留一个指向已删节点的引用。
        // 读取端有 liveMaximizedNode 兜底（悬空也不会出事），但脏状态本身还是要清：
        // canvas_get_state 会把它当 `maximized` 字段报给 AI，留着就是在骗它。
        maximizedNode:
          s.maximizedNode?.nodeId === nodeId ? null : s.maximizedNode
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
        freeNodes: [...s.canvas.freeNodes, { id, pane, x: pos.x, y: pos.y, w, h, readOnly: opts?.readOnly }]
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

  // 清标签写 undefined 而不是留着 null：canvas.json 里 `status: null` 和「没这个键」
  // 语义一样却要两处判空，落盘时 JSON.stringify 也会把 null 老实写出来。
  setFrameStatus: (id, status) =>
    set((s) => ({
      canvas: {
        ...s.canvas,
        frames: s.canvas.frames.map((f) =>
          f.id === id ? { ...f, status: status ?? undefined } : f
        )
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
  setCanvasSel: (keys) => set((s) => ({ canvasSel: keys, ...followSel(s, keys) })),
  toggleCanvasSel: (key, additive) =>
    set((s) => {
      if (additive) {
        const keys = s.canvasSel.includes(key)
          ? s.canvasSel.filter((k) => k !== key)
          : [...s.canvasSel, key]
        return { canvasSel: keys, ...followSel(s, keys) }
      }
      // 非累加：已是唯一选中则保持，否则替换为仅此项
      if (s.canvasSel.length === 1 && s.canvasSel[0] === key) return s
      return { canvasSel: [key], ...followSel(s, [key]) }
    }),
  clearCanvasSel: () => set((s) => (s.canvasSel.length ? { canvasSel: [] } : s))
})

