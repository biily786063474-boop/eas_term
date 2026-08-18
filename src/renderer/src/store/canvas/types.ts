// 画布的数据形状与切片接口。
//
// 单独一个文件的理由：这里是画布和外界的**契约** —— mcpHandler、store/index、
// store/types 都只认这些类型。类型和实现混在一个 1186 行的文件里时，
// 想知道「一个 Frame 到底有哪些字段」得先滚过几百行几何计算。
import type { LeafNode, PaneState } from '../../layout'
import type { UndoState } from './undo'
import type { ProjectStatus } from '../../../../shared/types'

/** 三种视图共享同一批 leaf（终端只有一份，换视图不重挂载）：
 *   split  分屏 —— 按 tab 树布局
 *   canvas 画布 —— 按世界坐标 × 视口定位
 *   board  看板 —— 按项目状态分列，每个项目一张卡片、卡片里嵌一个终端 */
export type ViewMode = 'split' | 'canvas' | 'board' | 'gantt'

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
  /** 这个终端绑的角色 id（~/.eas/roles.json 里的一条）。
   *  只影响**启动命令**怎么拼——模型/档位默认值 + 职责契约。
   *  注意 --resume 不重放 system prompt：会话一旦起来，角色就定死了，
   *  改 roleId 只对下一次全新启动生效（界面上必须说清楚，不能默默改）。 */
  roleId?: string
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
  /** 只读预览：目前只有从知识库拖出来的自由节点会设——内容离开知识库目录后不该被改，
   *  CodeView 读到这个标记就不出「编辑」按钮。跟「是不是自由节点」故意分开存：
   *  这标的是「这份内容不让改」，不是「这节点没有 Frame」，两件事碰巧目前总是同时发生。 */
  readOnly?: boolean
  /** 可写节点的保存通道。'skill' = 走 skillLibrary:writeFile —— 从 skill 面板拖出来的
   *  文件在 `~/.claude/skills` 这类位置，fs:writeTextFile 过 fsGuard（只认项目根和
   *  知识库根）够不到，保存会失败。存成节点上的一个字符串标记而不是一个函数，
   *  是因为 freeNodes 要持久化，函数存不进去、重开就没了。
   *  未设 = 走 fs:writeTextFile（项目文件的既有路径）。 */
  writeVia?: 'skill'
  x: number
  y: number
  w: number
  h: number
}

/** Frame 的颜色状态标签：蓝=进行中 / 黄=待执行 / 红=已完结。
 *  未设(undefined)= 无标签，Frame 保持主题色——「没标状态」和「标了某个状态」
 *  是两件事，不能拿其中一个状态当默认值顶替。
 *  目前只是纯视觉标记，不驱动任何逻辑；分类/筛选是后续的事。 */
export type FrameStatus = ProjectStatus

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
  /** 颜色状态标签；未设 = 无标签 */
  status?: FrameStatus
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

/** 待办清单里的一条待办 */
export interface TodoItem {
  id: string
  title: string
  /** 灯箱里写的详细正文 */
  body?: string
  done: boolean
  /** 完成时刻（ms 时间戳）；「已完成」区按它倒序排列，新的排前面。未完成时必为 undefined。 */
  doneAt?: number
}

/** 待办清单模块：世界坐标，自由存在（不属于任何 Frame/项目），一个模块装多条待办。
 *
 *  **故意不是 CanvasShape 的第四种 type**：`clearShapes()`（快照后清标记）会把 shapes
 *  整个清空，那是矩形/箭头/批注的既有行为——待办不该被连带清掉，所以另开一个数组、
 *  和 shapes/freeNodes 平级。渲染上仍然共享 CanvasShapeLayer（矩形/箭头/批注同一个
 *  z-index 层级），只是**不共享数据结构**。 */
export interface TodoBoard {
  id: string
  x: number
  y: number
  w: number
  /** 落盘 schema 占位（当前渲染走内容自增高度，不读这个字段；为将来手动调高预留位置） */
  h: number
  title?: string
  items: TodoItem[]
}

export interface CanvasScene {
  viewport: CanvasViewport
  frames: CanvasFrame[]
  shapes: CanvasShape[]
  /** 不属于任何 Frame 的自由节点：世界坐标（不像 frame.nodes 那样是相对 Frame）。
   *  目前唯一的产生方式是从知识库拖文件出来——先例是 shapes（矩形/箭头/便签）同样用世界坐标、
   *  同样独立于 Frame，自由节点是它的直接类比，不是节点系统的另一套并行实现。 */
  freeNodes: CanvasNode[]
  /** 待办清单模块：同样世界坐标、独立于 Frame，与 shapes 平级但不共享数组
   *  （理由见 TodoBoard 类型上方注释）。 */
  todos: TodoBoard[]
}

export interface CanvasSlice {
  /** 全局视图：分屏 / 画布。titlebar 分段控件切换，不属于任何 tab */
  viewMode: ViewMode
  /** 用户是否亲手选过视图。默认视图改成画布之后，它是「亲手选了分屏」和
   *  「从没动过默认值」的唯一区分依据 —— 两者的 viewMode 都是 'split'。
   *  随 canvas.json 一起落盘，详见 persist.ts 里 PersistedCanvas.viewModePicked。 */
  viewModePicked: boolean
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
  /** 缩放结束后：把被这个模块压住的邻居垂直推开（下方有多个就连锁一起下移）。
   *  和 settleNode 不同——那个是让**自己**找空位，这个是让**别人**给自己让路。 */
  settleResize: (frameId: string, nodeId: string) => void
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
  /** 删画布节点；节点是终端（带 leafId）时连带关掉对应的 leaf，两个视图同时消失 */
  removeNode: (frameId: string, nodeId: string) => void
  /** 扫掉「leafId 指向一个已经不存在的 leaf」的画布节点。
   *  幂等、没孤儿时不改状态，可以随便多调。leafId 为空的节点（存档恢复的终端占位）不碰。 */
  pruneOrphanNodes: () => void

  // ── 撤销 ──────────────────────────────────────────────────────────────
  /** 撤销栈（内存，不跨重启）。栈内容与结构见 store/canvas/undo.ts */
  canvasUndo: UndoState
  /** 记录开关。**loadCanvas + materializeCanvas 跑完之前必须是 false** ——
   *  否则加载存档本身会被记成一步，用户按一次撤销就把画布退回加载前的空场景。 */
  undoReady: boolean
  /** 撤销一步。返回是否真的撤了（栈空时 false，调用方据此提示）。 */
  undoCanvas: () => boolean
  redoCanvas: () => boolean
  addShape: (shape: Omit<CanvasShape, 'id'>) => void
  updateShape: (id: string, patch: Partial<CanvasShape>) => void
  removeShape: (id: string) => void
  /** 清空所有标记（快照后用）。一次性，不做撤销 —— 清空是用户在弹窗里按下的，不是副作用。
   *  **故意不碰 todos** —— 待办清单不是标记，见 TodoBoard 类型上方注释。 */
  clearShapes: () => void
  // ── 待办清单：自由存在（不属于任何 Frame），世界坐标，一个模块装多条待办。
  // 渲染共享 CanvasShapeLayer 的层级，数据是独立数组（见 canvas/types.ts 的 TodoBoard 注释）。
  /** 新建一个空的待办清单模块，落在世界坐标 (x,y) */
  addTodoBoard: (x: number, y: number) => void
  moveTodoBoard: (id: string, x: number, y: number) => void
  removeTodoBoard: (id: string) => void
  renameTodoBoard: (id: string, title: string) => void
  /** 新增一条待办（插到未完成列表最前面，方便点完「+」立刻在可见处输入标题）。返回新 id，
   *  调用方（CanvasTodoBoard）拿它立刻进入标题编辑态。 */
  addTodoItem: (boardId: string) => string
  removeTodoItem: (boardId: string, itemId: string) => void
  updateTodoItem: (boardId: string, itemId: string, patch: { title?: string; body?: string }) => void
  /** 打勾/取消勾选：done 翻转，doneAt 跟着盖章/清空（见 todoBoard.ts 的 toggleTodoItemDone） */
  toggleTodoItemDone: (boardId: string, itemId: string) => void
  /** 拖拽排序：把 itemId 挪到未完成列表的第 toIndex 位（已完成区不参与，见 moveTodoItem 注释） */
  reorderTodoItem: (boardId: string, itemId: string, toIndex: number) => void
  renameFrame: (id: string, name: string) => void
  /** 打/清状态标签（传 null 清除 = 回到未分类）。
   *  **实际写的是项目**（见 shared/types 的 ProjectStatus）——画布上的入口手里只有 frameId，
   *  这里负责翻译成 projectId 再转发给 setProjectStatus。 */
  setFrameStatus: (id: string, status: FrameStatus | null) => void
  /** 一次性清掉旧结构遗留的 frame.status（迁移到项目之后调）。别在别处用 */
  clearFrameStatusField: () => void
  /** 删除 Frame：连同后代子 Frame 一起删，逐个 closeLeaf 杀掉各自成员终端 */
  removeFrame: (id: string) => void
  /** 拖文件夹入某 Frame → 在其内新增一个空的子 Frame（父随之裹住） */
  addSubFrame: (parentId: string, folderPath: string, name: string) => void
  /** 复制画布独有节点（文件/组件；终端节点不复制，pty 唯一） */
  duplicateNode: (frameId: string, nodeId: string) => void
  /** 在 Frame 里新开一个终端节点（openTerminal + 挂到 Frame，自动堆叠） */
  addTerminalNode: (frameId: string, roleId?: string) => Promise<void>
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
  /** 最大化沉浸的节点（画布模式下铺满整个视口工作；再点还原回原位）。不持久化。
   *  frameId 缺省 = 自由节点（不属于任何 Frame，本来就没有 frameId 可填）。 */
  maximizedNode: { frameId?: string; nodeId: string } | null
  setMaximizedNode: (v: { frameId?: string; nodeId: string } | null) => void
  /** 画布选中集合（key：s:形状 / f:Frame / n:frameId:nodeId 节点(含终端) / p:nodeId 自由节点）。
   *  提到 store 是为了让浮在 PaneLayer 的终端节点也能被选中并显示高亮 + F 聚焦。 */
  canvasSel: string[]
  setCanvasSel: (keys: string[]) => void
  toggleCanvasSel: (key: string, additive: boolean) => void
  clearCanvasSel: () => void
  /** `canvasSel` 当前这份内容是不是「最大化」顺手置换进来的（而不是用户真的点选的）。
   *  只有 setMaximizedNode 的最大化分支会把它设 true；setCanvasSel/toggleCanvasSel/clearCanvasSel
   *  —— 也就是所有真实鼠标选中手势 —— 都会把它重置回 false。还原最大化时**不**清它：
   *  还原只清 maximizedNode，canvasSel 本就留着不动（沿用既有行为），这份"是不是最大化遗留"
   *  的标记也就必须跟着留到下一次真实选中发生为止，否则还原之后 canvasSel 依然是最大化时
   *  换上去的那个节点，却看不出这一点。
   *  这不是 UI 要用的字段——画布上该长什么样、highlight 该给谁，都只认 canvasSel 本身，
   *  这个字段的唯一读者是 mcpHandler 的 canvas_snapshot：它拿 canvasSel 判断"用户选没选中
   *  工作区"来决定截图存进哪个项目，而 canvasSel 能被 canvas_maximize_node 这个无关的 MCP
   *  工具悄悄置换掉（见该行为处的注释：最大化要顺手选中，是为了让滚轮正确路由到内容而不是
   *  画布本身）——canvas_snapshot 必须能分辨"这是用户点的"还是"这是最大化的副作用"，
   *  否则会把图写进用户从没点过的项目。 */
  canvasSelFromMaximize: boolean
  /** 画布当前选的绘图工具（select=选择/移动，其余是待画的图形类型）。
   *  CanvasStage（工具条）和 CanvasShapeLayer（标记层）都要读它，且必须是同一份：
   *  标记层要据此决定选了绘图工具时是否该把 mousedown 让给底下的画布视口穿透过去
   *  （否则落在已有图形上没法开始画新图形，见 Task 1 修复轮 1 的 Important 1）。不持久化。 */
  canvasTool: 'select' | 'rect' | 'arrow' | 'sticky' | 'todo'
  setCanvasTool: (tool: 'select' | 'rect' | 'arrow' | 'sticky' | 'todo') => void
  /** 正在编辑文字的便签 id（null=没有）。CanvasStage 的空白拖拽守卫
   *  （落在已有图形上没法开始画新图形以外的那一半：编辑便签时点空白不该触发框选/清选中）
   *  和 CanvasShapeLayer 的便签编辑态必须共用同一份——各起一份的话 CanvasStage 那份
   *  永远收不到 CanvasShapeLayer 的更新，读到的恒是初值，守卫形同虚设
   *  （见 Task 1 修复轮 1 的 Important 2）。不持久化。 */
  editingSticky: string | null
  setEditingSticky: (id: string | null) => void
  /** 拖知识库文件到画布任意位置（含 Frame 外）：新增一个自由 + 只读的文件预览节点，落在世界坐标 (x,y) */
  addFreeFileNode: (
    pane: PaneState,
    x: number,
    y: number,
    opts?: { readOnly?: boolean; writeVia?: 'skill' }
  ) => string
  moveFreeNode: (nodeId: string, x: number, y: number) => void
  resizeFreeNode: (nodeId: string, w: number, h: number) => void
  removeFreeNode: (nodeId: string) => void
  renameFreeNode: (nodeId: string, name: string) => void
  /** 拖动结束后：若与其它自由节点重叠，挪到最近的空位（对齐 Frame 内 settleNode 的防碰撞行为） */
  settleFreeNode: (nodeId: string) => void
  /** 把画布平移到某自由节点居中（对齐 focusCanvasNode） */
  focusFreeNode: (nodeId: string) => void
  /** 自由网页节点导航回写（极少见——知识库里拖出个 .html 才会用到，为了 WebView 行为一致仍补齐） */
  setFreeNodeUrl: (nodeId: string, url: string) => void
  setFreeNodeTitle: (nodeId: string, title: string) => void
  /** 复制自由节点（对齐 duplicateNode；自由节点没有终端，不用判 leafId） */
  duplicateFreeNode: (nodeId: string) => void
}
