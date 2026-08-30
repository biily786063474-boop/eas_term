// 右键归谁管：画布层，还是压在它上面的那一层。
//
// **从 stageMenu.ts 抽出来的，为的是能单测。** 原来这几条判定夹在
// stageMenuItems 里，而那个函数要 useStore 和一堆 DOM，node --test 加载不了 ——
// 于是「哪些地方右键不归画布」这件事**一条测试都没有**。
//
// 抽出来之后只依赖一个 `closest`，拿假节点就能测（见 menuOwnership.test.ts）。
//
// ── 这一层为什么值得单独保护 ────────────────────────────────────────
// 它的坏法是**静默的**：漏掉一个选择器，右键照样弹出一个菜单，
// 只是弹错了那个。2026-08-30 用户就撞上了 —— 在登录面板的
// 「点我去登录」上右键（那里的右键是「复制登录链接」），弹出来的却是画布的
// 「关闭终端」。想复制链接，差一点把整个节点关掉。
//
// 而且组件自己**挡不住**：画布菜单挂在 document 上，
// 组件里的 e.preventDefault() 只压系统菜单，压不住另一个监听器。
// 所以唯一的挡法就是这份名单 —— 它要是漏了，没有任何别的地方能补救。

/** 只要有 closest 就行。**不要求是真的 HTMLElement** —— 测试拿假节点喂进来。 */
export interface ClosestLike {
  closest(selector: string): unknown
}

/** 画布自己的三层。**都不在里面 = 右键落在画布之外**，让给系统菜单。
 *
 *  标记层（.canvas-shape-layer）是另外两层的**兄弟**，不在它俩里面 ——
 *  少了它，右键落在任何一个标记上都会被判成「画布之外」，
 *  图形的编辑/删除整体不可达，标记盖住终端时连「关闭终端」也一起没了。 */
export const CANVAS_LAYERS = ['.canvas-viewport', '.pane-layer', '.canvas-shape-layer'] as const

/** 表单控件：右键要的是复制/粘贴/拼写，不是「新建便签」。
 *  **按标签判**，才不会每冒出一个新输入框就漏一次 —— .term-input 和
 *  便签编辑态只是这条的两个特例。 */
export const FORM_SELECTOR =
  'input, textarea, [contenteditable="true"], [contenteditable=""], .term-input, .cshape.editing'

/**
 * 盖在画布上、自己就是一层的那些浮层。右键穿透到底下弹「关闭终端」是错的。
 *
 * **加新浮层时要往这里加。** 判断标准：它是不是渲染在画布内部、
 * 且自己对右键有别的定义（或者干脆不该有画布菜单）。
 * portal 到 body 的那些（灯箱、设置）不用加 —— CANVAS_LAYERS 那条已经挡住了。
 */
export const OVERLAY_SELECTOR = [
  '.canvas-drawer',
  '.wiki-drawer',
  '.cskill-panel',
  '.canvas-ctxmenu',
  '.cset-box',
  '.ctodo-lightbox',
  // 登录面板：它的「点我去登录」把右键定义成了「复制登录链接」
  '.ac-login',
  // 安装 / 首次设置面板：里面有命令原文和报错输出，右键要的是复制
  '.ac-setup'
].join(', ')

/** 模块最大化时，它的内容区不归画布管（.cfile-body / .pane-body）。
 *  只挡内容区，**不挡头部那条 chrome** —— 标题栏、关闭钮、缩放角仍然是画布的东西。 */
export const MAXIMIZED_BODY_SELECTOR = '.cfile-body, .pane-body'

/** 右键该归谁。**这是 stageMenuItems 入口那几条判定的全部。** */
export type MenuOwner =
  /** 落在画布之外 —— 让给系统菜单 */
  | 'outside'
  /** 内层自己认领了（表单 / 浮层 / 最大化模块的内容区）—— 画布不许抢 */
  | 'inner'
  /** 归画布，可以往下算菜单项了 */
  | 'canvas'

/**
 * @param t          右键落点
 * @param maximized  当前有没有模块处于最大化（liveMaximizedNode 的结果转成布尔）
 */
export function menuOwnerOf(t: ClosestLike, maximized: boolean): MenuOwner {
  if (!CANVAS_LAYERS.some((s) => t.closest(s))) return 'outside'
  if (t.closest(FORM_SELECTOR)) return 'inner'
  if (t.closest(OVERLAY_SELECTOR)) return 'inner'
  // 最大化后模块铺满屏幕、画布根本看不见，这时在内容区里弹画布的
  // 「复制 / 删除节点」等于对着一块看不见的东西操作（用户明确报过）。
  // **没最大化时不挡**：那时画布就在眼前，在模块上右键要节点操作不会让人意外。
  if (maximized && t.closest(MAXIMIZED_BODY_SELECTOR)) return 'inner'
  return 'canvas'
}
