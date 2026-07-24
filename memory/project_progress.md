# Eas-Term 进度存档

> 更新：2026-07-23。本文件记跨会话进度，append 不覆盖历史。

## ① 终端花屏修复（已完成 + 已眼验，未 commit）

**现象**：大量文本快速滚动时花屏（叠影/撕裂）。
**根因**（详见 `docs/终端花屏-渲染优化方案.html`）：
- 主因① 半透明背景(`allowTransparency:true` + 主题 `rgba(…,.45/.5)`) + WebGL 增量重绘 → 叠影。
- 主因② PTY 逐块直写 `term.write`、无批处理 → 撕裂/掉帧。
**已实施方案**（用户拍板走 Canvas 方案，保住毛玻璃）：
- `TerminalView.tsx`：`WebglAddon` → `CanvasAddon`（Canvas 正确合成半透明，根除叠影）。
- `TerminalView.tsx`：`onData` 逐块直写 → **rAF 写入合并**（一帧一次 `term.write`）+ cleanup `cancelAnimationFrame`。
- `terminal.css`：过时 WebGL 注释更新；`themes.ts`/毛玻璃**未动**（视觉零改变）。
- 新增依赖 `@xterm/addon-canvas@0.7.0`（package.json）。
**验证**：typecheck ✓、build ✓、CDP 眼验 `seq 1 2000000` 快速滚动两时刻截图干净、canvas 四层确认 Canvas 后端生效。
**状态**：改动未 commit。用户要求打包此版本安装到 mac（进行中）。

## ② 无限画布模式（设计阶段，未动应用源码）

用户要在现有分屏终端外加「无限画布」视图。经多轮原型迭代，形态敲定：
- **全局唯一无限画布**，每个项目 = 一个 **Frame**（Figma frame 概念，带边界/标题栏/折叠）。
- Frame 内自由摆放节点：终端 / 代码 / 图片 / md预览 / **HTML网页预览器**。
- **右侧资源抽屉**（项目列表+文件树）：整体可收起、分区可折叠、目录可折叠。
- **拖拽入画布**：拖项目→生成 Frame；拖文件→Frame 内预览节点 / 拖到终端→插路径；拖 `.html`→网页预览器。
- **HTML 预览器**：新 `PaneKind:'web'`，用 `<iframe sandbox>`（MVP）或 `<webview>`（进阶）；**不能用 BrowserView/WebContentsView**（原生叠加层，不受 CSS transform 控制，无法跟随画布缩放）。用途：预览 docs 里的 HTML 报告 + 嵌 dev server 实时预览。
- **画板 CRUD 齐全**：增（拖入/右键新建/工具栏）、删（节点×/Frame✕/Delete键）、改（类型切换/重命名/复制⌘D/resize）、右键菜单为统一入口。
**核心技术底座**（复用现有架构）：`layout.ts` 已是「绝对定位同容器、切布局只改坐标、xterm 永不重挂载」——画布与之同构。铁律：所有 `PaneView` 始终挂同一父容器、同一 `key={leaf.id}`，切模式只改 style → 终端不断连。所有操作复用现有 store action（`addProject`/`openTerminal`/`openFile`/`insertPathToTerminal`），不建平行逻辑。
**产出文档**：`docs/画布模式-实现规划.html`（规划，但数据模型还是旧的 tab级canvas+group，**待更新为**全局画布+Frame+抽屉+CRUD+web预览）、`docs/画布模式-原型.html`（原型，已迭代到含右侧可收起抽屉+HTML预览器+CRUD 的完整版）。
**下一步待用户定**：A) 把完整设计固化进规划文档 → 按 P0 动手实现；B) 继续调原型细节。

### 2026-07-22 进展：方案定稿 + P0 已实现并眼验 ✓

**定稿决策**（已问用户拍板）：① 终端「共享」——同一批终端两视图同源（同一 leaf/PaneView）；② 双层渲染——活终端常驻全局 pane-layer 永不换父，frame/图形是可缩放装饰层；③ 节点 × = 关闭终端（closeLeafSafely），保活走右键「仅移出画布」。规划文档 `docs/画布模式-实现规划.html` 已升级为 v2。

**P0 已实现**（未 commit，typecheck+build+CDP 眼验全过）：
- 新增 `store/canvasSlice.ts`：全局 `viewMode:'split'|'canvas'` + CanvasScene + seedCanvas/moveFrame/moveNode/toggleCollapse/setViewport。
- 新增 `features/workspace/PaneLayer.tsx`：**全局活内容层**，取代原「每 tab 一个 TabContent」。所有 leaf 挂同一容器、key=leaf.id；split 用 computeLayout 百分比 rect，canvas 用 worldToScreen 像素 rect。**TabContent.tsx 已删**。
- 新增 `features/canvas/CanvasStage.tsx` + `canvas.css`：装饰层（点阵 world + Frame 卡片 + 平移/缩放/适应 + Frame 拖动 + 缩放条）。
- 改 `PaneView.tsx`：加 hidden + canvasRect（像素定位+transform scale 位图缩放）+ canvas 模式头部拖动（moveNode）。
- 改 `App.tsx`：titlebar 分段控件 [终端|画布]；canvas 隐藏 TabBar、渲染 CanvasStage（底）+PaneLayer（顶）。Icons 加 CanvasIcon。
- **眼验铁证**：DOM 标记 PROBE-42 全程（split→canvas→缩放152%→拖Frame）存活 → xterm 永不重挂载、终端不断连；seed 出「命运呐·1面板」Frame，终端精确嵌入、缩放拖动对齐不散。

**P0 未做（留后续）**：右侧资源抽屉、拖项目/文件入画布、web 预览器（P1）；图形/便签/多选/右键CRUD（P2）；持久化/聚焦真渲（P3）。当前画布模式左侧仍是原 Sidebar（抽屉是 P1）。

**⚠️ commit 注意**：git 里 package.json/TerminalView.tsx/terminal.css 的改动是上个会话的**花屏修复**（progress ①，独立工作），与 P0 无关；单独提交 P0 时只 add 画布相关文件（canvasSlice/PaneLayer/CanvasStage/canvas.css/PaneView/App/Icons/types/index + 删 TabContent）。P0 已 commit：分支 `feat/canvas-p0` @9c02b64。

### 2026-07-22 进展：P1 已实现并眼验 ✓（web 预览器 + 右侧抽屉 + 拖拽入画布）

在分支 `feat/canvas-p0` 上继续（P1 尚未 commit）。定稿决策：文件预览节点**只在画布不进分屏**（终端仍共享）。

- 新增 `PaneKind:'web'` + `features/web/WebView.tsx`（iframe sandbox；layout/PaneView/tabsSlice 接入）。
- 新增 `features/canvas/CanvasDrawer.tsx`：右侧资源抽屉（项目+复用 FileTree，整体收起/分区折叠，"画布中"标记）。画布模式隐藏左 Sidebar。
- 新增 `features/canvas/CanvasFileNode.tsx`：**画布独有**文件预览节点，放装饰层 world 内矢量缩放，复用 CodeView/ImageView/WebView，可拖/resize/删。
- canvasSlice：CanvasNode 加可选 pane（leafId 型=终端共享；pane 型=文件画布独有）+ addProjectFrame/addFileNode/removeNode/resizeNode/resizeFrame。
- CanvasStage：Frame resize 手柄 + 渲染文件节点。
- 拖拽（手动 mousedown+ghost）：拖项目→Frame（无终端自动开）、拖文件→Frame 文件节点/.html→web、拖文件→终端节点插路径（pty.write，带 shellQuote）。
- 眼验：抽屉分区正常（修了 filetree-body absolute 逃逸导致的重叠 bug）；拖数字艺术软件生成第2个Frame；拖 deploy.sh 到终端插带引号路径；放大Frame拖 .md 生成代码预览节点。

**P1 未做（留 P2/P3）**：图形/箭头/便签、框选多选、右键菜单统一CRUD、画布节点类型切换/终端节点删除UI、持久化、聚焦真渲。左抽屉当前用 refreshKey=0（文件树刷新按钮未接）。

### 2026-07-23 进展：终端优化 + 组件系统 + P2 全套 + 打包替换 ✓（无限画布全线走完）

**终端优化**（眼验过）：画布终端默认尺寸 240→**380 高（≥20 行）**、宽 360→440；画布终端节点加**右下角 resize 手柄**（resizeNode + ResizeObserver 自动 fit）；滚动调慢 `scrollSensitivity` 3→2、altscreen 放大 3×→2×。commit `6ca864b`（尺寸+resize，画布文件）；**滚动改在 `TerminalView.tsx`，和花屏一起仍未 commit**。

**画布组件系统**（协议 + 首个组件，眼验过）：
- 协议 `features/canvas/components/registry.tsx`：`CanvasComponentDef`（id/name/Icon/defaultSize/needsProject/render(ctx)）+ `CANVAS_COMPONENTS` 注册表。**加组件 = 写一个 def 并注册，不动其它文件**。规范文档 `docs/画布组件协议.html`。
- `CanvasNode` 加 `component` 型（画布独有，与 leafId/pane 并列）；`CanvasComponentNode.tsx` 查表渲染；抽屉「组件」分区（文件下方）拖入。
- 首个组件「**版本管理**」= Git **分支图**（复用 `HistoryView`，不是变更列表）；`render(ctx)` 靠 Frame 注入的 `ctx.cwd` 绑定各自项目仓库（多项目并置不串）。
- 拖组件入 Frame：落终端上也能回溯所属 Frame；`placeNodeInFrame` 让新节点纵向堆叠、**Frame 自动扩大**容纳。
- 滚轮修复：光标在节点可滚动内容区时让内容滚动，不误判为画板缩放（CanvasStage onWheel 先查 `.cfile-body`）。

**P2 全套**（图形/便签 + 抽屉可调分区 + 右键 CRUD + 框选多选，眼验过）：
- P2a 左侧工具栏（矩形/箭头/便签）+ 绘制 + 便签双击编辑 + 图形拖动；shapes CRUD（addShape/updateShape/removeShape）。图形在 world 装饰层 → **渲染在终端之下**（可选 z 层调整未做）。
- 抽屉三分区（项目/文件/组件）间加**分隔线拖拽调高度**，文件区自适应。
- P2b 右键菜单统一 CRUD：Frame（重命名/折叠/删除，删除杀成员终端）、节点（复制/删除）、终端（关闭）、图形（删除/编辑）、空白（新建便签）；Frame 双击/右键 inline 重命名；新增 renameFrame/removeFrame/duplicateNode。
- P2c 框选多选：选择集（图形/Frame/文件·组件节点）+ 橡皮筋框选（空格+拖仍平移）+ ⇧点选 + 选中高亮 + Delete 删除 + ⌘D 复制；App 里画布模式屏蔽分屏快捷键让 ⌘D 归画布。

**git 现状**：分支 `feat/canvas-p0` 完整可编译，commit 链：
`6736255`(P2c) ← `6b870a8`(补 registry+文档) ← `0725b71`(P2 主体) ← `6ca864b`(终端尺寸/resize) ← `eb264ff`(P1) ← `9c02b64`(P0)。
⚠️ 组件系统**没能独立成一个 commit**（散在 0725b71+6b870a8——上上次那个「8d5c2ff 组件系统 commit」其实是我误报、从未真落库，registry+文档后来补 6b870a8）。想重整成独立 commit 需 `git reset`，被 auto 模式安全分类器拦截；**用户选择保持现状不重整**（历史功能完整正确，只是分组不漂亮）。花屏+滚动（`TerminalView.tsx`/`terminal.css`/`package.json`）仍有意留在工作区未 commit。

**打包替换（用户要求，已做）**：`npm run dist` → 产物 `~/Eas-Term-release/`（.app 在 `mac-arm64/Eas-Term.app` + 新 dmg/zip），**用户直接从这个 release 文件夹运行**（不在 /Applications）。打包内容 = **画布全套 + 花屏修复 + 滚动调慢**（当前工作区）。ad-hoc 签名（本机无证书）。已验 node-pty spawn-helper 三个都 `-rwxr-xr-x`（+x）→ 新 app 能开终端。**旧 app 打包时在跑（旧 inode），Cmd-Tab 过去还是旧进程；要退出正在跑的 Eas-Term 或重启后再从 release 文件夹启动才是新版**。我未替用户启动（避免多开抢焦点 + 用户说重启后再启）。

**仍待办（可选）**：标注图形浮到终端之上（z 层调整）；花屏+滚动入库；P3（画布持久化重开还原 / 聚焦真渲清晰度）；组件系统可继续扩组件（待办/看板等，照协议文档写 def 注册）。

### 2026-07-23 进展：画布交互精修批（呼吸/聚焦/滚轮 + A~H，全 CDP 眼验，待 commit）

一批画布 UI/交互精修，**全部 typecheck+build+CDP 眼验过，只 commit 不打包**（用户指示）：

- **呼吸提醒**：项目终端触发 bell（final answer/待审批等需用户操作）→ 抽屉该项目条目呼吸高亮。`uiSlice` 加 `attentionPtys`+`flagAttention`/`clearAttention`；`TerminalView` 用 `term.onBell` 在失焦时 flag、聚焦时 clear；`CanvasDrawer` 项目条目 `projectHasAttention` → `.breathing`。眼验：`printf '\a'` + 失焦 → 命运呐呼吸，聚焦清除。
- **点项目→聚焦 Frame**：抽屉点项目 = focusFrame（视口居中该 Frame）。眼验过。
- **滚轮修正**：触控板捏合(ctrlKey)=缩放；双指滑动=平移（原先竖滑被误判缩放）。`CanvasStage` onWheel 重写。
- **Req A 标题栏**：画布模式隐藏项目名/路径 pill（`App.tsx` 只在 split 显示，画布显示 "Eas-Term"）。眼验过。
- **Req B/C frame 头**：去掉"N 面板"计数；加 **新建终端**（`addTerminalNode`：openTerminal+挂 Frame 自动堆叠）、**单击复制路径**（icon+tooltip）两按钮 + 折叠。眼验：新建终端 2→3 节点、frame 自增高。
- **Req D 重命名**：每个节点可双击重命名。`CanvasNode` 加 `name?`；文件/组件节点(`CanvasFileNode`/`CanvasComponentNode`)双击头部 inline 改名；终端节点在 `PaneView` 画布头显示 `name||'未命名'` 可双击改（经 `CanvasPlacement.name` 从 `PaneLayer` 传入）。`renameNode` action。眼验：终端改名"我的调试终端"实时生效。
- **Req E 选中 + F 聚焦**：**选择态提到 store**（`canvasSel`+`setCanvasSel`/`toggleCanvasSel`/`clearCanvasSel`）——原来 sel 是 CanvasStage 本地 state、且框选把终端过滤掉了，**终端根本选不中**。现改为：框选纳入终端节点、终端点选（`PaneView` 头 mousedown 调 toggle）、终端选中高亮（`.pane-layer.canvas-mode .pane.sel`）、按 F 视口 fit+居中到选中包围盒。眼验：终端点选高亮 ✓、F 后视口 {0,0,1}→{203,-57,1.14} ✓。
- **Req F 节点命名精简**：文件节点只显示 basename + 两个 icon（复制绝对路径 / 复制相对路径，rel 按钮带小圆点区分）。`CanvasFileNode` 算 absPath/relPath（相对 Frame 项目根）。
- **Req G frame 自动裹住内容**：加 `fitFrameToNodes` 纯函数（右/下裹住所有节点+PAD，可增可缩），`moveNode`（左/上钳制 ≥PAD/≥HEAD+PAD）/`resizeNode`/`removeNode`/`duplicateNode`/`placeNodeInFrame` 全过一遍；手动 `resizeFrame` 加内容下限。眼验：下移 y=1200→h1596、移回 y=50→h446、放大→772×846，精确=内容+PAD，模块不溢出。
- **Req H 自定义 tooltip**：全局 `ui/Tooltip.tsx`（portal 到 body、读 `[data-tip]`、360ms 延迟、下方空间不足翻上方），替代原生 title；`base.css` 加 `--tooltip-bg`（比画布背景更暗的近黑，黑蓝/黑粉两主题各一）+ `.app-tooltip` 样式；**全 renderer `title=`→`data-tip=`**（65 处，find+xargs perl 批量，已确认无组件 title prop 冲突）。眼验：hover 新建终端 → `.app-tooltip` 文字对、bg `rgba(3,4,7,.97)`、position fixed。

**注意**：本批 commit 会**不可避免带上** `TerminalView.tsx`（仍含花屏 CanvasAddon + rAF + 滚动调慢）；那部分之前就一直留工作区。`src/main/index.ts` 的临时调试端口 9333 **验证后已移除**，不入库。
**小遗留**：选中终端节点按 Delete 走 `removeNode`（仅移除画布占位，pty 不关），和终端节点 × 按钮"关闭终端(两边都没)"语义不同——边角 case，未统一。

### 2026-07-23 进展：画布持久化 + 打包替换 + 光标（已 commit 7955b4c，已打包）

- **打包替换**（上一批 414e2e9 那版）：`npm run dist` → `~/Eas-Term-release/`（.app/dmg/zip 全刷新 06:23），spawn-helper 三个都 +x。**旧实例还在跑（旧 inode）**，用户需退掉旧 Eas-Term 再从 release 文件夹重开才是新版；我没替他强退（怕丢会话）。
- **画布持久化**（commit `7955b4c`，CDP 眼验过）：存 `userData/canvas.json`（在 .app 外，升级/关机不丢）。
  - `main/canvas.ts`（load/save，照 projects.ts）+ preload `canvas` api（unknown 透传边界）。
  - `canvasSlice`：`loadCanvas`（启动恢复 frames/shapes/viewport/viewMode）、`materializeCanvas`（终端占位节点=无 leafId/pane/component → 重开新终端绑 leafId，模块级 `materializing` 防重入、跳过已删项目）、`serializeCanvas`（落盘前 `delete copy.leafId`）。
  - `App`：启动先 loadProjects → loadCanvas，**恢复完成后才挂订阅**（`useStore.subscribe` 引用比较 `s.canvas!==prev.canvas`，防抖 500ms 落盘）——避免空画布覆盖存档。
  - **终端策略（用户拍板）**：原位重开新终端（布局/名称全还原，shell 全新——活进程无法跨重启保留）。文件/组件/图形节点原样恢复。
  - 眼验：建 2 终端+便签"记住我"→ `canvas.load()` 确认 leafId 已剥离 → `location.reload()` 模拟重开 → viewMode/frame/便签全回来、2 终端各重开绑新 leafId（leaf-1/leaf-3）、tabs=2。
- **光标**：画板默认箭头（`cursor:default`），抓手仅按住空格（`.space-pan` 类，空格 keydown/keyup 在 viewportRef 上 toggle）时出现。

### 2026-07-23 进展：画布拖拽增强（commit 07e7847，CDP 眼验过）

- **嵌套子 Frame**（用户选「真嵌套」）：`CanvasFrame` 加 `parentId`/`folderPath`。拖**文件夹**入某 Frame → `addSubFrame` 在其内建空子 Frame（世界坐标、堆叠在现有内容下方）。
- **帧尺寸全面改由 `reflowFrames`**：删掉旧 `fitFrameToNodes`，改为全场景重排——每帧裹住「自身节点 + 子 Frame」，**由深到浅**处理（先定子尺寸父再裹）。所有结构变更（move/resize/add/remove/dup node、addSubFrame）末尾都 `reflowFrames`。效果：父自动裹住子、**拖父带子**（`moveFrame` 位移后代 `collectDescendants`）、**删父连子**（`removeFrame` 级联删后代 + 杀各自终端）。**帧手动 resize 手柄已移除**（自动裹紧后无意义，`startFrameResize`/`cframe-rz` 删掉）。子 Frame 复制路径复制 `folderPath`；className 带 `sub`。
- **拖拽回归修复**：上一 tooltip sweep 把 `title=`→`data-tip=`，但 CanvasDrawer 文件拖拽读的是 `getAttribute('title')` → 断了。修法：FileTree 加 `data-path`/`data-dir`，handler 改读 `data-path` 并分流 `startFileDrag`/`startFolderDrag`。
- **图片节点支持动图 + 视频**：gif/webp `<img>` 原生动；视频（mp4/m4v/webm/mov/mkv/ogv）在 `CanvasFileNode` 按扩展名渲染 `<video controls loop>`。`paneForFile` 把视频也归 `image` kind（节点内分流）。新增 **`easfile://` privileged 媒体协议**（`main/canvas.ts`，仿 bizone-media，白名单扩展名流式返回 + 正确 Content-Type，`registerMediaScheme` 在 app.ready 前注册）。**CSP**（`src/renderer/index.html`）`img-src`/`media-src` 放行 `easfile:`。
- **`easfileUrl`**（CanvasFileNode）：base64url 编码绝对路径，避开 URL 转义坑。
- 眼验：拖文件夹→子帧(name/parentId/folderPath/位于父内)✓、子帧加文件→子长大 h286 父跟着裹到 h1156 ✓、reload 后子帧+文件节点+2 父终端全还原 ✓、easfile 服务 gif 经 `<img>` 解码成功(175×49)✓、mp4 节点渲染 `<video controls>`+easfile src ✓、文件树 37 项/11 目录都有 data-path ✓。

### 2026-07-23 进展：画布图片节点 → 文件夹图集（commit e4bcb9c，CDP 眼验过）

拖图片进画布后，图片节点自动读同文件夹全部图片：
- 单图视图（`CanvasImageViewer`）：hover 出左右箭头循环切换 + 底栏（宫格按钮 / N|总数 / 当前文件名）
- 宫格视图：本文件夹所有图片缩略图阵列，当前张高亮，点击回单图，× 返回
- 图片经 `easfile://` 由 `<img>` 直接加载（gif/webp 动图原生播放、不受 50MB base64 限制）
- 抽 `features/canvas/media.ts` 共享工具（`easfileUrl`/`isImagePath`/`isVideoPath`/扩展名集），`CanvasFileNode` 图片分支改用 `CanvasImageViewer`（不再走 ImageView）
- 眼验：blue.png 节点读到同目录 5 图、计数 3/5、右切换 blue→green(4/5)、宫格 5 缩略图全加载+当前高亮+×关闭。

### 2026-07-23 进展：标题栏层级 + 画布终端鼠标点偏根治（commit 9ef865a / d716139）

- **标题栏在最前**（`9ef865a`）：画布终端浮层滚到顶会盖住标题栏 → `.titlebar` 加 `z-index:100`、`.tab-stack` 加 `overflow:hidden`（画布内容裁在画布区内）。眼验：终端滚到顶被裁、标题栏完整露出。
- **画布终端鼠标点偏根治**（`d716139`，用户选「字体缩放重做」）：**根因**——画布缩放用 CSS transform，xterm 上报鼠标格子坐标是「缩放后像素 ÷ 未缩放字符宽度」（读源码确认 `getCoords: (clientX-rect.left)/cellWidth`）→ 非 100% 缩放时终端所有鼠标点击/选字点偏，**Claude Code 的选项/审批/Jump-to-bottom 点不中**（画布核心用途受损）。**改为字体缩放**：画布终端 pane 用实际像素尺寸（w×scale，无 transform），字号=13×scale（TerminalView 新增 `canvasScale` prop + fitRef + 缩放变化重 fit），头部用 `zoom` 缩放（布局感知、按钮可点）。行列数不变、文字清晰、rect 与字符尺寸同步 → 鼠标精准。分屏 scale=1 不受影响。眼验：scale 1.6 下 pane transform=none、字体清晰放大、拖拽选字精准覆盖 "biily@BiilydeMacBook-Pro"。
  - 我那个右下角"↓ 最新"药丸是 DOM 按钮、不受缩放影响（实测缩放态可点），和 Claude Code 自己的 jump 是两回事。

### 2026-07-23 进展：滚轮按选中态 + 名词词典气泡 + 选中Frame抽屉高亮（commit a4d9e9f，CDP 眼验）

- **滚轮按选中态分流**：只有「选中」的模块才把滚轮交给模块内滚动区，未选中保持画板 pan/zoom。① `CanvasStage.onWheel`（文件/组件节点）命中 `.cfile-body` 时先查该节点是否在 `canvasSel`；② `PaneView` 画布 pane 加原生捕获滚轮监听（`passive:false`，终端浮在 pane-layer 滚轮不经 canvas-viewport，故就近拦截），未选中→setViewport 平移/缩放，选中→放行给终端/预览。眼验：未选中终端滚→画板 pan(y-398→-518)、选中→视口不变。
- **名词词典改悬浮气泡**：切换画布节点为 dict 会崩溃 → ① `PaneKindSelect` 画布模式过滤掉 dict 选项；② 新增 `CanvasDictBubble`（可拖动小圆钮，点击弹小面板承载 `DictView`，× 或再点收起，fixed 定位不受画布变换影响，App 里 `viewMode==='canvas'` 渲染）。眼验：气泡展开 DictView 无崩溃、再点收起。
- **选中项目 Frame → 抽屉对应项高亮**：`CanvasDrawer` 加 `projectFrameSelected`（查 `canvasSel` 含 `f:frameId` 且该 frame.projectId===p.id）→ `.cd-proj.framesel`（accent 描边环）。眼验：选中命运呐 Frame → 抽屉"命运呐"高亮。

### 2026-07-23 进展：拖模块进子帧 + 点任意处选中 + 终端弹网页在帧内 + 宫格修复（commit 1d6ae3b，CDP 眼验）

- **拖模块进子 Frame**（悬停 1s + 弹一下）：store `moveNodeToFrame`（跨帧移动节点 + reflow）；`subframeDrop.ts` tracker（拖拽时 `elementsFromPoint` 找底下子 Frame，悬停满 1s→移入，虚线高亮 `cframe-drop-pending` + 到 1s 缩放弹 `cframe-drop-pop`）；接入 `CanvasFileNode`/`CanvasComponentNode`/`PaneView` 三处拖拽。眼验：拖终端到子帧「收纳盒」悬停 1s→终端移入并在其中渲染。
- **点模块任意部分即选中**：三类节点根部加 `onMouseDownCapture`（捕获阶段、不 preventDefault 故内容仍可交互）统一选中；原 startDrag/onCanvasHeadDown 的选中改由它处理。眼验：点终端 body→选中高亮。（配合「选中才滚」很关键）
- **终端弹网页优先在 Frame 内渲染**：`TerminalView` 的 `WebLinksAddon`，画布模式下 Cmd/Ctrl 点 URL→在该终端所在 Frame 建 web 预览节点（`addFileNode kind:web`），非弹外部浏览器。
- **图片宫格纵向重叠修复**：`civ-grid` 固定 `grid-auto-rows:84px` + 明确 cell 高度→缩略图不被自然高度顶开、不重叠、溢出滚动；宫格是显式浏览视图，滚轮始终可滚（不受「选中才滚」限制，CanvasStage onWheel 加 `.civ-grid-scroll` 例外）。眼验：cell 均 84px。

### 2026-07-23 进展：文件/组件节点点任意处可选中 + 图片模块重开不变终端（commit 81e7205，CDP 眼验）

- **点文件/组件节点(如版本管理)任意处选中**：根因——这类节点在世界层(canvas-viewport 内)，点 body 时 `onMouseDownCapture` 已选中，但事件冒泡到 viewport 触发框选、其 onUp `clearCanvasSel` 又把选中清掉(终端在 pane-layer 不冒泡故无此问题)。修：`CanvasFileNode`/`CanvasComponentNode` 根加冒泡阶段 `onMouseDown` stopPropagation 挡住 viewport 框选。眼验：点版本管理组件 body→选中高亮。
- **被切成图片/代码/网页的模块重开变回终端（真 bug）**：根因——leaf 节点的 kind 存在 leaf 上(未持久化)，`serializeCanvas` 只剥 leafId 落成占位→重开当终端 spawn。修：`serializeCanvas` 增 `leafPaneOf`(App 从 tabs 注入)，非终端 leaf 节点(code/image/web)落成带 pane 的文件节点。眼验：终端切成 image→落盘 `pane:image` 无 leafId→reload 后仍是图片节点、非终端。

### 2026-07-23 进展：呼吸强化/待处理/抽屉圆角 + Agent 控制台 P0（多 commit，CDP 眼验）

- **呼吸提示**：`d37f688` 强化动画(外发光+圆点脉动)；`2881154` 加**输出静止检测**(输出后 5s 无新输出+失焦+>16字节+启动3s宽限→标记，比 BEL 可靠不依赖响铃)、抽屉「待处理」徽标、选中终端/Frame 即 clearAttention 消除呼吸；`a609c82` 抽屉改浮动圆角卡片(内缩8px+全边框+radius-lg)+静止窗口 1.2s→5s。
- **Agent 控制台 P0**（`5f6e4c9`，设计评审见 `docs/Agent控制台-设计评审.html`，三决策=控制条+启动器/先不做额度/先 Claude Code）：`CanvasNode.agent`(kind/model/effort/permission/cont)+`setNodeAgent`(随画布持久化)；`CanvasAgentBar` 组件(切换段控件+模型下拉+effort段控件+权限下拉+继续会话+启动)；启动=拼 `claude [-c] --model --effort [--permission-mode|--dangerously-skip-permissions]` 写真实终端；`PaneView` 仅画布终端头部下渲染、zoom 随缩放、分屏不渲染。眼验：设 Sonnet/极限/跳过全部→启动→终端真出 Bypass Permissions 页(参数全对)→Ctrl-C 退出；配置落 canvas.json；分屏无控制条。
  - **Claude CLI 参数**(本机核对)：`--model opus|sonnet|haiku|fable`、`--effort low|medium|high|xhigh|max`、`--permission-mode`、`-c/--continue`、`--dangerously-skip-permissions`。
  - **额度**：CLI 拿不到订阅剩余(只有 `/cost` 会话用量)，P0 不做。**Codex 占位待接**(P1，本机未装 codex，需装机核对 `-m/--model`、`-c model_reasoning_effort=`、`--ask-for-approval`、`--sandbox`)。

### 2026-07-23 进展：呼吸判定重做 + 防碰撞 + 抽屉边缘唤出（commit a072886 / 22f8302 / 0c848fe，CDP 眼验）

- **呼吸判定改「终端标题跃迁」**（`a072886`）：摸清 Claude Code 真实信号——完成/等待时**不发独立 BEL**，而是改**终端标题**：工作中 `<盲文 spinner> 名字`(⠋⠙⠹ U+2800-28FF)，一轮跑完/出选项/需审批 `✳ 名字`(非 spinner)。（用 `script` 录真实会话确认：8 个 BEL 全是 OSC 标题终止符、无独立响铃、无 OSC9/777。）去掉噪声大的输出静止检测，改 `TerminalView.onTitleChange` 检测**标题 spinner→非spinner 且失焦**→标记；纯 shell 标题是 cwd 无 spinner→永不误报、每轮只触发一次→可消除不乱闪。消除标准（用户指定）：**点抽屉高亮项目一次** → `clearAttention` 该项目所有终端（CanvasDrawer 项目点击处）。眼验：OSC ⠋→✳ 触发、`ls` 不触发、点项目即清。
- **模块防碰撞 + 拖入插最近处**（`22f8302`）：`findFreePos`(螺旋外扩找离首选点最近不重叠空位) + `placeNodeAtPoint` + `settleNode`(拖动后重叠则挪开)。`addFileNode/addComponentNode` 落在鼠标点+防重叠；三处拖拽 onUp settleNode。眼验：两节点同落点→自动错开、避开终端。
- **抽屉改边缘悬停唤出**（`0c848fe`）：默认收起(滑出屏外)。右缘悬停(`.cd-edge`)→辉光条+中部左箭头；单击→弹簧滑入(cubic-bezier(0.34,1.56,0.64,1))；打开时抽屉外点击(捕获 mousedown)→收起；收起态右上角「待处理」气泡(呼吸项目数,pop+脉动),点击展开、展开后 `!open` 自然消失。眼验全过。

**注意 · 打包落后**：本机 `~/Eas-Term-release` 那版是 **2881154**（10:31）。之后 a609c82 抽屉圆角/5s、5f6e4c9 Agent控制台P0、bbf4a43 评审文档、a072886 呼吸标题跃迁、22f8302 防碰撞、0c848fe 抽屉边缘唤出 **均未打包**。要上机需重新 `npm run dist`。
（历史：414e2e9→7955b4c 持久化→07e7847 子帧/视频→e4bcb9c 图集→9ef865a 标题栏→d716139 字体缩放→a4d9e9f。d716139 已打包上机。）
**小遗留**：① 选中终端节点按 Delete 只移画布占位不关 pty（与 × 语义不同）；② 子 Frame 的「新建终端」开在项目根、非该文件夹（openTerminal 只吃 projectId 无 cwd）——边角，未做。

### 2026-07-23 进展：Codex 接入(段控件方案，dev 眼验) + 白屏隐患系统审查 + P0 血止(未 commit)

**Codex 接入完成并 dev 眼验**（工作区未 commit）：
- 本机 `brew install codex`（0.145.0）核对真实参数：`-m/--model`、`-c model_reasoning_effort=<v>`、回溯 `codex resume --last`；approval 只有 `untrusted/on-request/never`(记忆里 `on-failure` 是错的，但权限已取消不拼，无影响)。Codex 模型/effort **不经 `--help` 暴露**（服务端 catalog 驱动，需登录），故给静态默认 models `[gpt-5-codex,gpt-5]` + efforts `[minimal,low,medium,high,xhigh]`(二进制 strings 挖到)，前端留「自定义」兜底。
- `main/agent.ts`：`agent:probe` 探测 claude(`--help` 真实解析 models/efforts)+codex(installed+静态默认)，补 homebrew PATH。`AgentProbe.codex` 加 models/efforts。
- **控制条改「段控件方案」**(用户拍板)：`[Claude|Codex]` 段控件选 agent → 模型/思考胶囊选项随之切换 → ▶启动(弹「是否回溯」)。`CanvasAgentBar.tsx` 重写(删原 ✦抽屉+双启动器)。`NodeAgent.model/effort` 从 `string` 改 `Partial<Record<'claude'|'codex',string>>`(按 agent 各存一套，切 agent 互不覆盖；rec() 守卫老字符串数据)。默认 pickModel 优先 Opus/gpt-5-codex(不再默认到 fable)。
- CSS：`.ab-drawer/.ab-run` → `.ab-seg/.ab-launch/.ab-brand`。
- **dev 眼验(CDP)**：probe 返回 claude[fable,opus,sonnet]+codex[gpt-5-codex,gpt-5]；段控件切 Codex→胶囊翻 gpt-5-codex/中；切回 Claude→Opus/高(记忆保留)；模型菜单/effort滑块(minimal→xhigh)定位准；**点启动真把 `codex -m gpt-5-codex -c model_reasoning_effort=medium` 写进终端→codex 真启动到登录页**(参数被接受)。

**⚠️ 事故教训（已记 [[工作规则-验证只在dev端-不擅自动release-app]]）**：我收尾用 `pkill -f "Eas-Term"` 太宽，误杀用户正在跑的**正式 release app** 进程→白屏。用户下铁律：①验证只在 dev 端(`npm run dev` 独立实例)；②不经明确指示不安装/打包/碰 release app；③kill 必须精确(按端口 9333/`node_modules/electron` 路径，绝不用名字宽匹配)。

**白屏隐患系统审查**（用户要求，报告 `docs/白屏隐患-系统级代码审查.html`）：4 路并行 agent 审查(主进程恢复力/渲染崩溃面/画布内存/持久化)。**根因=三道安全网全缺**：零 React Error Boundary(`main.tsx`)、零主进程 uncaughtException 兜底、零渲染/GPU 崩溃自愈 → 任一局部异常放大成永久白屏。实据：DiagnosticReports 零崩溃报告→JS 层卸载 React 树而非原生崩溃。用户在跑的是**旧构建**(canvas.json 里 agent 仍旧字符串)，白屏是它本就有的老 bug、与 Codex 改动无关。三条扳机：①`pty:write` 裸写已死终端 EPIPE；②多终端连续缩放 fit 风暴 GPU OOM；③畸形 canvas.json 渲染期 `f.nodes.length` 抛错(启动即进画布→每次开机白+订阅未挂覆盖不了坏档→永久打不开)。

**P0 血止已实现并 dev 眼验**（工作区未 commit）：
- `ui/ErrorBoundary.tsx`(新)+ `main.tsx`：根 Error Boundary 包 `<App/>` + 全局 error/unhandledrejection 监听。兜底 UI 两按钮(重新加载/重置画布并重载=存空 canvas.json 再 reload)。`base.css` 加自包含深色样式。
- `main/index.ts`：`process.on('uncaughtException'/'unhandledRejection')` 只记录不退出；`render-process-gone`(reason≠clean-exit)→`reloadWindowThrottled`(3s 节流防崩溃循环)；`app.on('child-process-gone')` GPU 崩→重载；`unresponsive` 记录。
- `main/pty.ts`：`pty:write` 补 try/catch(原来只有 resize/kill 有)。
- **dev 眼验(CDP)**：注入缺 nodes 的坏 frame→果然崩 `Cannot read properties of undefined (reading 'forEach')`(正是 PaneLayer.tsx:46-48)→**Error Boundary 兜住显示可用兜底页而非白屏**(截图确认)。验证前备份 canvas.json、验证后原样恢复(frames:4)，release app 全程未碰。
- typecheck+build 通过，调试端口已删。**未 commit**。

**P0 未 live 崩溃测试项**(代码已加、标准 API、启动正常)：主进程 uncaughtException 兜底、render-process-gone 自愈、pty:write EPIPE——难确定性触发，靠代码正确性。

**P1 根治坏档已实现并 dev 眼验**（工作区未 commit）：
- `canvasSlice.ts`：加 `sanitizeCanvas`(逐 frame/node/shape/viewport 规范化，坏项丢弃而非整档，数值兜有限值，scale 钳 0.2~2.2)；`loadCanvas` 改用 sanitize + try/catch(读盘失败/坏档不崩)；`materializeCanvas` 逐 frame/node try/catch(一个坏节点不中断整轮)；`setViewport` 钳 scale + 兜 NaN(堵死 scale=0/NaN)；`PersistedCanvas` 加 `version`，`serializeCanvas` 写 `version:1`。
- `App.tsx`：启动 IIFE 包 try/catch，loadProjects/loadCanvas 失败也保证保存订阅挂上(不再整会话不落盘)。
- **dev 眼验(CDP)**：造畸形 canvas.json(null 帧/缺 nodes 帧/坐标 null/scale=null/含 null shape)→ 加载**零崩溃、无 Error Boundary**：null 帧+null shape 丢弃、缺 nodes 补 []、坏坐标补 0、viewport 缺 y 补 0+scale 钳 1，app 正常渲染。验证前备份、验证后恢复真实档(frames:4)，release app 全程未碰。
- typecheck+build 通过，调试端口已删。**未 commit**。

**P2 内存/性能已实现并 dev 眼验**（待 commit）：
- `TerminalView.tsx`：`scrollback` 100000→**20000**(每终端省数十 MB)；**去抖 fit**——新增 `scheduleFit`(trailing 100ms)，`canvasScale` effect 与 ResizeObserver 都改走它(原来双触发每帧 fit)，`doFit` 合并「改字号+fit」+ 隐藏终端(offset=0)跳过 + cleanup 取消 fitTimer + 加 `canvasScaleRef`/`scheduleFitRef`。消除连续缩放每帧重建 4 张 GPU canvas/字形图集的显存暴涨崩溃。
- `pty.ts`：主进程输出**合批背压**——按 pty 累积，~16ms 或积到 64KB 再合并成一条 `wc.send`(原逐块发)，onExit 先 flush 再发 exit。刷屏不再用海量小 IPC 灌垮渲染。
- **dev CDP 眼验**：给 pty 灌 4 万行 → **零崩溃**、输出完整顺序正确(结束于 40000+BATCH_MARKER_END)；短命令正常显示；6 终端 42% 缩放下正确 re-fit。验证前后备份/恢复 canvas.json，release app 未碰。

**Codex 接入 + P0 + P1 已 commit**(`4875bb8`/`cb4978a`/`ca12fdb`)，P2 待 commit。**均未打包上机**——打包/发只在用户指示时做。
**P2 未做(留后续，见报告)**：viewport 更新 rAF 节流(H2 wheel→全 PaneView 重渲，纯性能)、头部 zoom→transform、图片宫格虚拟化、长时隐藏终端 dispose CanvasAddon(LRU)。
**工作区仍有非本次改动**：`CanvasDrawer.tsx`(上个会话抽屉边缘箭头 polish，未提)、几个上个会话遗留未跟踪文件。

### 2026-07-24 进展：修 P2 缩放回归 —— 画布终端缩放 transform 预览(方案 A，dev 眼验)

**问题**(用户报)：画布缩放时 Claude/Codex CLI 全屏 TUI 不实时跟随。**根因**(4 路并行诊断+真机复现)：画布终端故意用「字号缩放」而非 CSS transform(为鼠标坐标精准)；而 P2(`5a92b42`)为修白屏把「改字号」也塞进 100ms 去抖 → 缩放中字号根本不变、只外框在长大,松手才 snap。全屏 TUI 满屏网格 + alt-screen 需 SIGWINCH 整屏重绘,最明显。
**方案 A(用户选)**：画布终端里一切(字号/头部/agentbar)都按 **`canvasCommittedScale`**(落定缩放)渲染；缩放**手势中**由 pane 一层 `transform: scale(cs/committed)` 做实时视觉预览(丝滑、不重建 GPU)；手势停 **160ms** 后 committed 落到当前 scale,此刻才真正落字号+fit(鼠标恢复精准)。手势中不点终端→不影响精准。
- `canvasSlice.ts`：加 `canvasCommittedScale`(初始 1，loadCanvas 落到存档 scale)；`setViewport` 里 scale 变则重置 160ms 计时器,停手落 committed(纯平移不触发)。
- `PaneView.tsx`：终端 pane 尺寸/头部 zoom/agentbar zoom/TerminalView canvasScale 全改用 `committedScale`；缩放中(`zoomPreview=|cs-committed|>0.0005`)加 `transform: scale(cs/committed)` + willChange。文件/图形节点本就用 transform,不动。
- `TerminalView.tsx`：canvasScale(=committed) 只在停手变一次 → 那次 fit 改用 **useLayoutEffect 立即 fit**(paint 前落字号,消除 snap 闪烁)；加 fitNowRef,删无用 scheduleFitRef;ResizeObserver 仍用去抖 scheduleFit(窗口/节点 resize)。
- **dev CDP 眼验**：跑 top,连续缩放 mid-gesture(committed 0.837/live 1.42)→ 内容跟 transform 实时放大填满框(对比修复前冻结在角落);settled(committed=live=1.87)→ 字号真实重渲清晰、cols/rows 重 fit;静止时终端 pane `transform:none` → 鼠标精准。typecheck+build 通过。

## ③ 环境坑（已修，已记 memory）

见 [[npm-install-会破坏electron和nodepty原生模块]]：这台机器 `npm install` 会因 allow-scripts 破坏 electron dist + node-pty spawn-helper，导致 dev 起不来。修法已记。眼验 Electron UI 用 [[CDP眼验法-破解多实例抢焦点]]（本会话靠它验花屏 + 原型）。
