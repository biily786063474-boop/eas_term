// 终端分屏布局：二叉分割树 + 扁平化矩形计算。
// 所有终端叶子以绝对定位渲染在同一容器里，分屏/调整比例只改坐标，
// 不改变 React 元素层级，从而保证 xterm 实例永不重挂载、滚动缓冲不丢失。

// Blender 式编辑器区域：每个叶子是一个"面板"，可通过下拉框切换功能类型。
// 源代码管理不占主面板（它在侧栏「版本」标签里），但 Git diff 会作为一种“代码面板”
// 开在主区域——code 面板带 diff 参数时渲染 DiffView，否则渲染普通只读 CodeView。
// 'history'(SourceTree 式 Git 历史) 和 'chat'(Claude Code 对话导航) 都是大视图，
// 分别从侧栏「版本」和终端头部按钮打开，不出现在面板下拉框里。
// 'agent'(通用 AI CLI 对话，见 features/agentChat/) 同属这一类——它唯一的创建入口是
// 子项目 C 的画布默认节点（新建项目时落一个空态），同样不出现在面板下拉框里；
// 但仍要在 store/tabsSlice.ts 的 setPaneKind 分支里补全，否则这个联合类型一扩员，
// 那个函数的穷尽匹配就编译不过。
// 'dict'(专业名词词典) 从面板下拉框打开：查词条 → 点击把实现逻辑插入活动终端光标处。
export type PaneKind =
  | 'terminal'
  | 'code'
  | 'image'
  | 'history'
  | 'chat'
  | 'agent'
  | 'dict'
  | 'web'
  | 'wiki'
  | 'codegraph'

/** Git diff 在主区域的展示参数（由侧栏「版本」标签点击文件时下发） */
export interface DiffSpec {
  cwd: string
  relPath: string
  mode: 'worktree' | 'staged'
}

export type PaneState =
  | { kind: 'terminal'; ptyId: string }
  | { kind: 'code'; filePath: string | null; diff?: DiffSpec }
  | { kind: 'image'; filePath: string | null }
  | { kind: 'history'; cwd: string }
  | { kind: 'chat'; cwd: string }
  /** AI 对话面板。
   *  · sessionId 是 **Eas-Term 内部**的会话号（ac-N），指向主进程里那个活着的 session。
   *    进程一退就无效，**不落盘**。
   *  · resumeId 是 **CLI 自己**的会话 id（Claude 的 session_id / Codex 的 thread id），
   *    两个 adapter 都能拿它续上下文（`--resume` / `exec resume`）。它本来就是为跨重启
   *    设计的，**要落盘** —— 不存的话重开这个节点，模型就完全不记得之前聊过什么。 */
  | {
      kind: 'agent'
      cwd: string
      sessionId?: string
      resumeId?: string
      /**
       * 这个会话是谁开的。缺省 = 用户自己开的。
       *
       * **它只影响一件事：关掉节点要不要连进程一起杀。**
       *   · 用户自己开的 → 关节点就是「我不要它了」，杀（既有行为，见 killPanePty）
       *   · 团队派生的   → 关节点只是「这块屏幕我不看了」，进程继续跑，
       *     由团队面板负责停它
       *
       * 不区分的话，你想看一眼某个 agent 然后关掉窗口，就把它干掉了。
       * 反过来，标了 team 却没有面板能停它，就是制造孤儿 —— 所以这个字段
       * 必须和团队面板的「停」按钮一起上线，不能单独放开。
       */
      owner?: 'team'
      /** 团队里的角色名（researcher / cross-checker …）。**只有 owner:'team' 才有。**
       *  存在这里而不是只写进首条消息：面板要按角色列出「谁在干什么」，
       *  而首条消息发完就沉进对话流里了，面板捞不出来。 */
      role?: string
      /**
       * 挂载后自动发出去的首条消息（派活用）。
       *
       * 为什么走 pane 而不是从外面直接调 agentChat.start：**会话的驱动者只能有一个**。
       * AgentChatView 自己管着 phase / sessionId / 事件订阅，外部另起一个会话它不知道，
       * 界面会停在空态而底下已经在烧 token。这里只是「预填一条消息并自动按下发送」。
       *
       * **发出去之后必须清掉**（clearInitialMessage），否则组件重新挂载会再发一遍。
       */
      initialMessage?: string
      /**
       * 用哪个 CLI 起这个会话。缺省 = 让 AgentChatView 自己挑第一个可用的（既有行为）。
       *
       * **为插件而加**：插件属于哪个 CLI 是确定的（GitHub 是 Codex 的、
       * claude-mem 是 Claude 的），从「插件」选项卡开出来的会话必须用对家伙，
       * 否则那个插件的工具在会话里根本不存在 —— 又是一次「说你能做、工具却不在」。
       * 形状照抄 initialMessage：写进 pane、由组件读取，不从外面直接驱动会话。
       *
       * **类型是 string 不是字面量联合**：CLI 清单本来就是 listClis() 运行时给的，
       * 写死两个名字等于把「第三个 CLI」挡在类型层外面（omp 就是第三个）。
       * 校验放在读的那一侧 —— AgentChatView 拿它去 `usable.find(c => c.id === pinnedCli)`，
       * 找不到就退回默认选择，不会因为一个不认识的名字硬失败。
       *
       * **它今天不落盘**：persist.ts 的 serializeCanvas 对 agent pane 只写
       * `{kind, cwd, resumeId}`。所以别把它当成「记住用户选的 CLI」—— 它只是
       * 内存里的一次性传参（插件页开会话 / 派活），重启后就没了。
       */
      cli?: string
      /** 这个面板用哪个角色（`AgentRole.id`）。空 = 无角色。
       *
       *  **和上面的 `role` 不是一回事**：那个是团队派活的角色名（字符串），
       *  这个是「工匠 / 验官 / 画师」那 8 个预设之一。
       *
       *  ⚠️ **角色只在 spawn 时生效**（契约走系统提示，那条 flag 只传一次）。
       *  所以换角色 = 结束当前会话重开，界面那侧会弹确认（用户 2026-09-03 选的 b）。 */
      roleId?: string
      /** 这次会话带哪个插件（PluginInfo.id）。**一次只带一个**（用户 2026-08-24 定死）——
       *  180 个插件全带会把系统提示词撑爆。主进程据此决定往 agent-mcp.json 里合并谁。 */
      pluginId?: string
    }
  /** 代码可视化：把这个项目的模块依赖与耦合状态画出来。
   *  `root` 是要扫的项目根 —— 存下来，重启后不用再问一次。 */
  | { kind: 'codegraph'; root: string }
  | { kind: 'dict' }
  | { kind: 'wiki' }
  | { kind: 'web'; url: string | null; title?: string }

export interface LeafNode {
  type: 'leaf'
  id: string
  pane: PaneState
}

export interface SplitNode {
  type: 'split'
  id: string
  dir: 'row' | 'column'
  ratio: number
  children: [LayoutNode, LayoutNode]
}

export type LayoutNode = LeafNode | SplitNode

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LeafRect {
  leaf: LeafNode
  rect: Rect
}

export interface DividerRect {
  splitId: string
  dir: 'row' | 'column'
  /** 该 split 占据的整个区域，用于拖拽时换算比例 */
  region: Rect
  /** 分割线位置（区域内偏移后的绝对坐标） */
  pos: Rect
}

const DIVIDER = 0 // 分割线不占布局空间，渲染时用固定像素宽的把手覆盖在边界上

export function computeLayout(
  node: LayoutNode,
  rect: Rect,
  leaves: LeafRect[],
  dividers: DividerRect[]
): void {
  if (node.type === 'leaf') {
    leaves.push({ leaf: node, rect })
    return
  }
  const [a, b] = node.children
  if (node.dir === 'row') {
    const wA = (rect.w - DIVIDER) * node.ratio
    computeLayout(a, { x: rect.x, y: rect.y, w: wA, h: rect.h }, leaves, dividers)
    computeLayout(
      b,
      { x: rect.x + wA + DIVIDER, y: rect.y, w: rect.w - wA - DIVIDER, h: rect.h },
      leaves,
      dividers
    )
    dividers.push({
      splitId: node.id,
      dir: 'row',
      region: rect,
      pos: { x: rect.x + wA, y: rect.y, w: 0, h: rect.h }
    })
  } else {
    const hA = (rect.h - DIVIDER) * node.ratio
    computeLayout(a, { x: rect.x, y: rect.y, w: rect.w, h: hA }, leaves, dividers)
    computeLayout(
      b,
      { x: rect.x, y: rect.y + hA + DIVIDER, w: rect.w, h: rect.h - hA - DIVIDER },
      leaves,
      dividers
    )
    dividers.push({
      splitId: node.id,
      dir: 'column',
      region: rect,
      pos: { x: rect.x, y: rect.y + hA, w: rect.w, h: 0 }
    })
  }
}

export function collectLeaves(node: LayoutNode, out: LeafNode[] = []): LeafNode[] {
  if (node.type === 'leaf') out.push(node)
  else node.children.forEach((c) => collectLeaves(c, out))
  return out
}

/** 用 replacement 替换树中 id 为 targetId 的叶子，返回新树（未找到则原样返回） */
export function replaceLeaf(
  node: LayoutNode,
  targetId: string,
  replacement: LayoutNode
): LayoutNode {
  if (node.type === 'leaf') return node.id === targetId ? replacement : node
  const [a, b] = node.children
  const na = replaceLeaf(a, targetId, replacement)
  const nb = replaceLeaf(b, targetId, replacement)
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}

/** 删除叶子：其兄弟节点接管父 split 的位置。根叶子被删则返回 null */
export function removeLeaf(node: LayoutNode, targetId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === targetId ? null : node
  const [a, b] = node.children
  const na = removeLeaf(a, targetId)
  if (na === null) return b
  const nb = removeLeaf(b, targetId)
  if (nb === null) return na
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}

export function updateRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio }
  const [a, b] = node.children
  const na = updateRatio(a, splitId, ratio)
  const nb = updateRatio(b, splitId, ratio)
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}

export function firstLeaf(node: LayoutNode): LeafNode {
  return node.type === 'leaf' ? node : firstLeaf(node.children[0])
}

/** 更新指定叶子的面板内容，返回新树 */
export function updatePane(
  node: LayoutNode,
  leafId: string,
  pane: PaneState
): LayoutNode {
  if (node.type === 'leaf') return node.id === leafId ? { ...node, pane } : node
  const [a, b] = node.children
  const na = updatePane(a, leafId, pane)
  const nb = updatePane(b, leafId, pane)
  if (na === a && nb === b) return node
  return { ...node, children: [na, nb] }
}
