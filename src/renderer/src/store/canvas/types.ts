// 画布的数据形状与切片接口。
//
// 单独一个文件的理由：这里是画布和外界的**契约** —— mcpHandler、store/index、
// store/types 都只认这些类型。类型和实现混在一个 1186 行的文件里时，
// 想知道「一个 Frame 到底有哪些字段」得先滚过几百行几何计算。
import type { LeafNode, PaneState } from '../../layout'

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
