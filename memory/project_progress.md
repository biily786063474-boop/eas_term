# Eas-Term 进度存档

> 更新：2026-09-01。本文件记跨会话进度，append 不覆盖历史。

> ## ⚠️ 这份文件在 2026-07-24 到 2026-08-31 之间停更了
>
> 中间五周的活一条没记（手机端两步 + 隧道、辞典改造、AI 对话面板、AI 导航图纸、
> 快捷键三期、一批画布与终端的修复）。**那段时间的真相源是 `git log` 和 `docs/`，
> 不是这里** —— 拿这份文件回答「现在做到哪了」会得到七月的答案。
>
> 按主题去这几处查，比翻这份文件快：
>
> | 想知道 | 去哪 |
> |---|---|
> | 整体架构、模块边界、跨文件同步清单 | `docs/architecture/`（改代码前必读 `10-模块领地图` 与 `03-agent角色边界`，别在这儿记份数）|
> | 手机端 / 隧道 | `docs/手机端-需求规格.html`、`docs/手机端-进度.html`、`docs/手机端-第二步进度.md` |
> | 快捷键 | `docs/快捷键盘点与规划-2026-08-31.md`（含「落实到哪一步了」）|
> | 画布缩放为什么是现在这样 | `docs/画布缩放-裁剪还是真缩放.html` |
> | 右键菜单搬家 / 文件路径边界 | 那两份 `-2026-08-31.md` 排期 |
> | 具体某次改动的根因与验证 | commit message —— 这仓库的 commit 写得比这份文件细 |

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

**⚠️ 事故教训（已记 [[工作规则-验证只在dev端-不擅自动release-app]]）**：我收尾用 `pkill -f "Eas-Term"` 太宽，误杀用户正在跑的**正式 release app** 进程→白屏。用户下铁律：①验证只在**隔离实例**上做（`npm run verify`，**不是** `npm run dev` —— dev 的 userData 与正式版同目录，见该篇更正块）；②不经明确指示不安装/打包/碰 release app；③kill 必须精确(按端口 9333/`node_modules/electron` 路径，绝不用名字宽匹配)。

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

### 2026-07-24 进展：修「思考/模型重启不记忆」bug（dev 眼验，待 commit）+ 浏览器/语音规划报告

**bug 根因(dev 实测确认)**：① 画布落盘是改动后 500ms 防抖，**改完就退/切走**时那次改动没落盘就被取消 → 丢失(实测:设值后立刻 reload,磁盘改动确实丢)；② 接 Codex 时 `NodeAgent.model/effort` 从字符串改成 `{[kind]:值}` 对象，**旧存档里的字符串**新代码 `agent.model?.[kind]` 读得 undefined → 回落默认。
**修法(已实现+dev 眼验)**：
- `main/canvas.ts` + `preload`：加 `canvas.saveSync`(`ipcRenderer.sendSync('canvas:save-sync')` 同步落盘)。
- `App.tsx`：落盘订阅加脏标记 + `flush(sync)`；**失焦(blur)异步 flush、退出/刷新(beforeunload)同步 flush**、卸载前也 flush。根治防抖丢失。
- `canvasSlice.ts`：`sanitizeNode` 加 `migrateAgent`——旧字符串 model/effort 按 `agent.kind` 转成 `{[kind]:值}`，让旧选择恢复。
- **dev CDP 眼验**：设 haiku + 立刻 beforeunload → 磁盘瞬间有 haiku(不等 500ms)✓；写旧字符串 `model:'sonnet'/effort:'xhigh'` + reload → store 迁移成 `{claude:'sonnet'}/{claude:'xhigh'}`、胶囊显示 Sonnet/超高 ✓。typecheck+build 通过。

**浏览器 + 语音输入功能规划报告**(用户要求,`docs/浏览器+语音输入-功能规划.html`,2 路并行调研)：
- **浏览器**：用 `<webview>`(唯一能跟随画布 CSS transform 的真 Chromium 内核;`WebContentsView` 原生层不跟手排除;iframe 留可信本地内容兜底)。开 `webviewTag:true`、`WebView.tsx` iframe→webview + chrome 条(地址栏/前进后退/刷新/加载态/错误页)、`CanvasStage.tsx:647` 加浏览器 icon、`.html` 路由已在 `CanvasDrawer.tsx:20`。**待验证第一条**:webview 在 transform 画布里是否单次缩放跟手。
- **语音**：provider 抽象层。Web Speech API 在 Electron 打包后不可用(排除)。默认建议**离线 sherpa-onnx + Paraformer 中文流式**(零 key/免费/隐私/真流式/中文一流),云档 OpenAI Realtime/火山(1元时)/讯飞 可切换(需 API key)。key 只在主进程、渲染层采麦、partial 回填输入框(committed/interim)。替换 `TerminalView.tsx` 的 `↓最新` 按钮为麦克风(「回到最新」建议挪位不删)。
- 用户已选:**先修这个持久化 bug**(已做完)。浏览器/语音待用户拍板顺序 + 语音默认档(离线 vs 云)。

### 2026-07-24 进展：Chrome 内核迷你浏览器 P1（webview，dev 眼验，待 commit）

按 `docs/浏览器+语音输入-功能规划.html` P1 做。**用 `<webview>`**（唯一能跟随画布 CSS transform 缩放的真 Chromium 内核；`WebContentsView` 原生层不跟手，iframe 挡站/无 chrome）。
- `main/index.ts`：`webPreferences.webviewTag: true`。
- `WebView.tsx`：iframe → **命令式 `<webview>`**（`document.createElement('webview')` 避开 React/TS 自定义元素类型坑，部分属性须 attach 前设）+ 浏览器 chrome：前进/后退(canGoBack/goBack)、刷新/停止(加载态切)、地址栏(normalizeUrl：补 https/转搜索，Enter→loadURL)、加载转圈、错误浮层(重试)、空态。`partition="persist:browser"` 共享会话、`allowpopups`。事件：did-start/stop-loading、did-navigate(-in-page)、did-fail-load(忽略 -3)。**go() 加 src 兜底**（dom-ready 前 loadURL 会抛）。
- `web.css`：重写 chrome 条/地址栏/转圈/错误页样式。
- `canvasSlice.ts`：加 `addBrowserNode(frameId)`（建 `{kind:'web',url:null}` 节点，placeNodeInFrame 自动堆叠）。
- `CanvasStage.tsx:647`：frame 头"新建终端"右侧加 **GlobeIcon 新建浏览器**按钮。
- `.html/.htm` 路由(`CanvasDrawer.tsx:20` → `{kind:'web',url:'file://'}`)自动改用 webview 打开。
- **dev CDP 眼验(铁证)**：命运呐 frame 新建浏览器节点 → 加载 **github.com**(iframe 被 X-Frame-Options 挡、webview 能开)完整渲染；画布缩放 **50%/85%/150% 三档 webview 都单次缩放跟随、清晰、布局不变、平移跟手**（报告 #1 待验证项——过！）。typecheck+build 通过。

**P1 未做(留 P2)**：标题/favicon 回填节点名、新窗口→新节点(主进程 did-attach-webview+setWindowOpenHandler)、url 持久化(did-navigate 回写→重开还原)、右键(devtools/复制链接)、多 webview 懒挂载/离屏治理、iframe feature-flag 兜底。**导航 back/forward 按钮已接 API 但未逐一 live 点验**（标准 webview API，低风险）。

### 2026-07-24 进展：浏览器 P2 + 链接同view/聚焦 + frame 去重叠 + 画布边缘死区修复（dev 眼验，待 commit）

**浏览器 P2**：
- url 持久化：`WebView` 加 `frameId/nodeId` prop，did-navigate → `setNodeUrl`(新 store action)回写 `node.pane.url` → 随 canvas.json 持久化,重开还原到上次页面。**关键**：画布 web 节点是 `CanvasFileNode` 渲染(不是 PaneView),frameId/nodeId 要在 `CanvasFileNode.tsx:177` 传(PaneView 也传了给 leaf 型 web 兜底)。
- favicon：page-favicon-updated → 地址栏左侧显示。
- **链接在同一内嵌浏览器导航(用户要求)**：主进程 `app.on('web-contents-created')`(比 did-attach-webview 对命令式 webview 更可靠)对 webview guest `setWindowOpenHandler`：`setImmediate(()=>guest.loadURL(url))`(handler 里同步 loadURL 会被忽略)+ `deny` + 广播 `browser:focus` IPC。**WebView 必须有 `allowpopups`**(P2 重写时丢了→window.open 被直接禁、拦不到 handler,加回才通)。
- **画布聚焦(用户要求)**：`focusCanvasNode(frameId,nodeId)` store action(保持缩放、pan 到节点居中,查 `.canvas-viewport` 尺寸算)。WebView 在 dom-ready 注册 `getWebContentsId()→聚焦回调` 到模块级 registry,`window.api.browser.onFocus` 单例监听按 guest id 分发。
- **dev CDP 眼验**：地址栏输入 example.com → 导航 + 节点 url 回写✓;`executeJavaScript('window.open',userGesture=true)` → webview 同 view 跳 github/features + 画布 pan 聚焦回节点✓。

**frame 去重叠(用户要求)**：`deoverlapFrames`(顶层 frame 按阅读顺序放置,重叠者下移到邻居下方 +GAP,连同后代一起移)+ `reflowSeparate=deoverlap(reflow)`。只在「加节点」actions(addBrowserNode/addTerminalNode/addFileNode/addComponentNode)用,**不介入手动拖拽 moveFrame**(避免拖动被弹开)。眼验:加浏览器后顶层 4 frame 无重叠。

**画布右侧空白死区修复(用户报 bug)**：根因 `.body { padding: 0 10px 10px; gap:10px }`(分屏给侧栏留边距),画布模式侧栏隐藏了这右/左/下 10px 就成无点阵死区暗带、画布边界内收。CDP 实测:tab-stack 右边界 1137 vs 窗口 1147 = 10px 隙。修:`canvas.css` 加 `.app.canvas .body { padding:0; gap:0 }` → 画布 edge-to-edge。眼验:tab-stack 右到 1147、点阵铺满、版本管理面板到边。

## ③ 环境坑（已修，已记 memory）

见 [[npm-install-会破坏electron和nodepty原生模块]]：这台机器 `npm install` 会因 allow-scripts 破坏 electron dist + node-pty spawn-helper，导致 dev 起不来。修法已记。眼验 Electron UI 用 [[CDP眼验法-破解多实例抢焦点]]（本会话靠它验花屏 + 原型）。

---

## 2026-09-01：一轮修复批（终端坐标 / 对话吸顶 / 灵动岛 / 处理中动画 / 快捷键）

五条，全部已 commit（`fcebbe3` → `2342159`），**都没打包上机** —— 用户跑的仍是
`/Applications/Eas-Term.app` 里的旧版，装不装由他定。

| commit | 事 | 根因一句话 |
|---|---|---|
| `fcebbe3` | 画布缩放下终端点击/选中偏行 | xterm 算行列用的 `rect` 含 CSS transform，`cellWidth` 不含 → 行列号被放大 scale 倍。**这 bug 复发过一次**（`d716139` 修过，`f46b573` 改真缩放时连同修复一起移除，因为那次只验了「糊不糊」没验「点得准不准」）|
| `cc6faf6` | 聊久了看不到自己的提问吸顶 | ① `beforeTurnCount` 记的是 `turns.length`，而归约器每轮把它砍回 60 上限 → 这个「绝对下标」到顶就不再增长，所有提问塌到 0；② 落盘 40 轮的预算是 user/assistant 共用的，而一次提问要 6–39 段回答 |
| `a1c06db` | 灵动岛在前台抢主体软件的交互 | `held` 靠渲染层回声来清（两跳 IPC，会丢）· 岛销毁时不清 `held`（活到下一次）· 岛能自己在前台把自己顶出来 · Dock 菜单「显示灵动岛」是死的（读的 `fgUntil` 早就没人读了）|
| `5735ced` | 「正在处理」换成 solving 点阵球 | 形态取自 orbs.jakubantalik.com；参考站 20px 那档照搬不行（只有 30 个点，看不出是球）|
| `2342159` | 补 `⌘,` 打开设置、`⌘J` 新建 AI 对话 | 盘点表里标「高」的四条最后两条 |

**这一轮里值得记住的方法论**（都吃过亏才得出的）：

- **只量数字不看画面会得出反结论。** 判断字体缩放方案时，输入框占比 9.3% 看着正常，
  截图一看布局已经塌了（标题竖着断行、控制条被切）。同一天栽了两次。
- **统计口径会被脏数据污染。** 算「一次提问几段回答」时先得到 54 段，那是被 21 份
  「修复前存的、根本不含 user 轮次」的历史拉的；只算含提问的 4 份是 11.3 段。
- **瞬时快照量不了「岛在不在」**（用户在用机器，焦点一直被抢）。改成对整段日志查
  不变量：41 条判定快照里，主体在前台的 12 条 `show` 全为 false，零例外。
- **临时补丁要有还原的仪式。** 验处理中动画时把 `busy` 临时固定为真，看完当场还原 +
  全仓 grep 标记 = 0 + 重新构建干净产物。

**这次顺手修的过期文档**：`CLAUDE.md` 的 8443 安全组提示（实测已放行）、
`docs/手机端-第二步进度.md` 的「第三步隧道整个没开始」（服务端已上线、主进程客户端已接，
差的是界面）、`13-所有权矩阵` 里会漂移的快捷键条数。


## 2026-09-05 → 09-06：角色卡三 harness 绑定层（三阶段，已发版）+ 角色工作流 P1（进行中，挂起）

**已完成并在 main 上**（0.4.81 已发布，`chore: 0.4.81` = `544442f`，站点回填 `4d2c088`，补验记录 `82f3e32`）：

- 角色卡改 `caps`（write / shell / imageGen / mcp）+ `raw` 逃生口，`shared/roleBinding.ts` 一处翻译三家参数并出报告；`roles.json` v1→v2 自动迁移（**v2 被 0.4.80 及更早读到会静默丢 caps**）。
- Codex 接上只读沙箱、`--disable shell_tool`、MCP 名按本机清单过滤；omp 白名单减法 + MCP 通配不连。
- 阶段二：编辑器三列矩阵（文案全部从报告派生）、工具栏降级徽标、`team_spawn` 加 `role_id`（真机打通）。
- 阶段三第一项：Codex 内置生图 **实测从未进过工具清单**，模型说的「imagegen」是系统 skill，可用 `-c 'skills.config=[{path="<CODEX_HOME>/skills/.system/imagegen/SKILL.md",enabled=false}]'` 摘掉（路径必须是 SKILL.md）。**用户当日决定画师不再默认勾「不许生图」**（保留 Codex 原生能力），开关只给自建角色。
- spec：`docs/superpowers/specs/2026-09-05-角色卡片三harness绑定层-design.md`（十一至十四节有全部探针与真机记录）。

**进行中 · 角色工作流 P1（分支隔离 + 协同板）**，spec `docs/superpowers/specs/2026-09-05-角色工作流-分支合并官协同板-design.md` 第六、八节：

- worktree：`/Users/biily/Biily/Projects/vibe coding/terminal-wt/roles-workflow-p1`，分支 `feat/roles-workflow-p1`，自 main `82f3e32` 分出，**尚未合并**。
- 计划：`docs/superpowers/plans/2026-09-05-角色工作流-P1-分支隔离与协同板.md`（在该分支上，7 个任务）。SDD 台账与简报在 worktree 的 `.superpowers/sdd/2026-09-05-角色工作流-P1-分支隔离与协同板/progress.md`（git-ignored）。
- 做到哪：Task 1（`AgentRole.isolation`、三个写码角色默认 worktree、`shared/roleWorktree.ts` 命名纯函数）`be08a85` ✅ 评审通过；Task 2（`shared/board.ts` 协同板纯渲染）`4011f36` ✅ 评审通过；**Task 3（`main/board.ts`、`role:worktreeAdd` IPC、session.ts 注入与刷板、preload）未开始** —— 派过两次 agent 都在读代码阶段停摆，worktree 干净在 `4011f36`。
- 下一步：重派 Task 3（简报 `task-3-brief.md` 完整可直接用；注意 `board.ts` 与 `session.ts` 用 `setSessionSource` 注入，别互相 import）→ Task 4 三家系统提示附板文 + `board_read` → Task 5 渲染层首发前建树/非 git 确认 → Task 6 分支徽标 + 编辑器隔离开关 → Task 7 图纸 + 隔离实例真机验证（用 /tmp 临时 git 项目）。
- **2026-09-06 已完成并合入 main（`af3ee16`）**：Task 3-7 全部做完，整分支评审 1C 4I 修完复审通过，隔离实例真机 8 条过 7 条（删 worktree「删不掉」失败弹窗没造出来）。冲突两处（session.ts import、adapters.test.ts 末尾测试）已解，合并后 2403 测试全过。
- 留下的：`uiSlice.requestConfirm` 单槽覆盖（另立任务）；对话态工具栏 455px 以下换行；Windows 恢复路径拼接未实测；P2（合并官 + 两个工具 + testCmd）与 P3（章程 + 台账）未开始。
- 阶段三第二三项（Codex disabled_tools、Claude 写守卫）同日合入 main（`da5e121`）。0.4.81 不含这些，要下一版。
- **2026-09-06 P2 已完成并合入 main（`02ce65e`，16 个提交，无冲突，合后 2426 测试全过）**：内置 `merger` 合并官卡；只读工具 `merge_preflight`（`src/main/mergeTools.ts` + `src/shared/mergePreflight.ts`，merge-tree 算冲突、协同板交集、`main{branch,dirty}`、testCmd 三级来源）与 `repo_impact`（`src/shared/repoImpact.ts`，二级反向依赖 + 循环分量 + 同目录测试建议，图缓存 5 分钟且 preflight 清缓存）；`Project.testCmd` + 侧栏「回归命令…」；pane `draft` 预填（不落盘、不自动发）+ 徽标菜单「合并到主干」。真机 8 场景记录在 spec 第十五节。`gitExecCode` 归到 `gitExec.ts`（带退出码）。两个工具进了 `LONG_WAITS`（mcpBridge + eas-mcp 两处）。
- P2 留下的：没真跑一整轮合并（含解冲突与回滚）；Windows 未测。
- **2026-09-07 P3 已完成并合入 main（`d5edf2c`，12 个提交，无冲突）**：章程 `docs/roles/<roleId>.md`（`src/shared/roleDocs.ts` 模板 + `src/main/roleCharter.ts` 首次生成、透传绑定 ctx、只写当前 harness 的硬约束、项目根无 `.git` 不写）；台账 `.eas/board/<branch>.md`（`src/main/branchLedger.ts` 一条链，头部随协同板刷新 upsert，会话被移除后 `markGoneAsStopped` 标已停，`readLedgers` 扫目录靠首行反推分支）；MCP `board_note`（按 cwd 向上找仓库根，主工作区必须带 branch）、`board_read` 可选 `ledgers`；起会话附「你的角色文档」绝对路径指针段（`StartOpts.roleDocs` 三家同步，放在写守卫之后）；首次生成章程 `requestConfirm` 提示。真机 8 场景记录在 spec 第十六节。
- P3 留下的：Codex / omp 指针段只有单测；`team_spawn` 多角色同时首次生成时提示只剩最后一条（requestConfirm 单槽老留项）。**0.4.81 不含阶段三、P1、P2、P3，要下一版。**
- 同期另一个 agent 在 `codex/agent-chat-codex` 分支（worktree `/private/tmp/eas-agent-chat-codex`）干活，主树里有它的未跟踪文件（`.agents/`、`.codex/`、`docs/AGENT_ACTIVITY_LOG.md`、一份 09-07 计划）与 `AGENTS.md` 改动，未合。

**这轮的方法论教训**（已写进 ~/.claude 项目记忆 `eas-term-角色绑定层.md` / `eas-term-cdp-验证方法.md`）：
- 判断 CLI 有没有某个工具，看**发给模型的请求体**（假端点或 trace 回显），别问模型。
- 隔离实例里给对话 pane 发消息要用 `[data-leaf-id=…] textarea.ac-input` + ⌘Enter，挑「第一个可见输入框」会把指令发进用户真实的历史会话。
- 清临时目录别用 `ps` 抓路径做排除，路径带空格会抓错，正在跑的实例目录会被一起删。

## 2026-09-07：AI 对话 Codex 修复分支

实现位于 `/private/tmp/eas-agent-chat-codex` 的 `codex/agent-chat-codex`。用户要求不同 CLI/harness 兼容，前端新增行为按公共能力/事件处理。续聊参数、模型目录与每模型档位、资源/插件展示和局部排版已实现；全量 2452 通过/1 跳过，隔离三种事件回放通过。check 的既有 cframe-sweep 规则失败未改。审查入口 docs/architecture/16-AI对话公共协议.md、docs/verification/agent-chat/README.md；真实服务验证边界见后者。尚未合并/发布。

2026-09-07 补充：用户要求模型读取与选择放在正式对话开始前。新增 StartupModelPicker 与无 session 的 modelCatalog IPC，共用原探测/缓存；首轮和 resume 重试都带用户选择。全量 2454 通过/1 跳过，真实目录与启动参数 UI 验证通过。

## 2026-09-13 对话归档 UI
用户指出“UI没过去”，本轮已在 .worktrees/voice-regression 实际接入 HistoryPanel 与主进程目录/置顶，不是原型。源码清单与边界见 docs/superpowers/plans/2026-09-12-conversation-archive.md 的 2026-09-13 节。25项测试/typecheck/build通过，隔离真机验证搜索、置顶、预览、窄屏返回、另一分屏外点关闭、新建确认。完整增量存储/运行中收尾/分屏独立ID未完成，不能发版称完全防丢。用户旧开发实例和草稿未重启/覆盖。新验收使用独立 bundle /tmp/eas-history-ui-review/Eas-History-Dev.app，防止 getApp 选中同名旧Electron。

## 2026-09-13 · 资源闸门 P0 启动
- 用户 ok 同意按运行资源计划开始。只做首轮清查与本机轻量只读探针，未改运行代码。
- 新架构文档 `docs/architecture/17-运行资源与服务所有权.md`：20类入口/生命周期、内存统计陷阱、平台能力及 P0 剩余。
- 本机 M5 Pro / 15逻辑核 / 48GiB；CPU ticks 采样可读。freemem 不能直接等同真实内存压力。
- P0 未完成：进程树隔离探针、启动停止全量去重、内存压力/电源事件/硬限额能力仍需验证；P1 尚未开始。
- P0第二轮：已跑隔离父子进程探针，两种模式父退出后子PID仍存在（不区分僵尸，不能外推生产泄漏）；证据 JSON 与脚本已落盘。补查 VAD 32帧背压、CLI安装/契约exec包装、statusline shell。P0仍在进行，未接P1。
- P0第三轮：probe-v2补ps状态/PPID/启动时间及自退出后消失断言，两种子进程均真存活非僵尸、随后消失，脚本退出0。AST扩查157候选非服务计数。memory_pressure -Q=93%不能当可分配内存百分比；on-battery不能当系统节能模式。发现同步CLI校验最多每次8秒，停止接口多为发起而非确认退出。详见17号图纸。
- 00:45 P1前置纯函数已落代码（不是生产接入）：runtime/cpuMetrics.ts +5测试。红灯缺模块→绿灯；连HostRegistry回归共11通过，typecheck通过。P0仍未完成，未启动后台采样/闸门/服务UI；下一步有界采样器及快照协议。
- 00:54 CPU采样器已落：sampler.ts、shared/runtimeResources.ts、6项新测试；单循环/冻结快照/异常清基线/迟到代次防护，合计17定向测试与typecheck通过。未接生产，未覆盖内存/GPU/队列/UI。下一步采样适配及策略，P0未决不能隐去。
- 用户要求连续完成、只报最终结果，不再小步等“继续”。本批加policy/scheduler/serviceRegistry纯核心及测试：40定向通过，typecheck/build通过。未接生产/内存/UI；成本预留、父子额度、公平老化仍缺，详17号图纸末尾，不能称完整交付。npm test全量正在核对。
- 全量 npm test 完成：2956项，2943通过、13跳过、0失败（35.2秒）。仅证明现有测试通过，不代表未接入的产品功能已验收。证据在docs/verification/runtime-governor/。
- 用户要求验收：2026-09-13重新typecheck/build退出0；npm test 2956项/2943通过/13跳过/0失败。实际查看隔离dev设置→性能与诊断，仅旧图形/日志功能；新core全局搜索无生产调用。产品验收不通过。合成复现新增B1：stop后回调前setProjects新增共享归属仍执行停止；B2：75%快照可准入4任务无成本预留（不宣称真实超线）。未改业务源码；报告docs/verification/runtime-governor/acceptance/report.html。
- 01:40用户同意整改后：R1登记层B1修复，stop布尔改prepareStop实例/归属版本/30秒一次性对象；复现竞态、旧版本、同ID重建、伪造和执行前过期4新测试红→绿。44定向测试、typecheck/build通过。R1宿主真实租约draining/IPC仍缺，不能宣称整体安全接入；R2未改。
- 01:43续完整流程要求：新增resourceLedger并接scheduler.acquire（合成75%/3百分点只准入1任务）；HostRegistry版本/drain/acquire互斥，drop支持expected实例；pluginHost.onExit防旧实例回调误摘新host。51定向测试通过。完整UI/指标/入口/嵌套/e2e未完成，不得称全流程完成。
- 01:48续：runtime/manager.ts接policy+ledger+scheduler统一模式/快照/成本准入/取消；5项集成测试，56项定向及typecheck通过。未接whenReady/真实平台指标/服务桥接/UI，完整流程仍未完成。
- 01:52续平台真实读数：新增platformMetrics/readPlatformMetrics；macOS vm_stat1秒超时、64KiB、并发合并，本机48GiB/15核/内存估计约33.2GiB。memoryAdmissionVerified=false，不能直接用来启用生产阈值。59定向+typecheck通过；UI/入口仍未完成。
- 01:55真实UI链路：runtime/monitor+ipc接index/preload，SettingsPanel新增RuntimeMonitorPanel，仅监测。隔离dev安全重启pid27922，实际看见15核/33.0GB of48.0GB、限流未启用。60定向+typecheck/build通过。核心限流/服务清单依旧未接。
- 02:00续：实际pluginHost只读服务清单接runtime:monitor和性能页，带名称/时长/项目，shim未知归属显式标记；无关闭接口。62定向/typecheck/build通过，新服务行与真实插件e2e未验证。总体限流仍未生产接入。
- 资源服务手动停止已接实际pluginHost：原生确认/窗口引用检查/确认后租约复核/drain/退出移除，stopGate防重复确认。65定向测试+typecheck/build通过；重启专用隔离dev pid31993，性能页实际读数及插件空态通过。真实插件停止e2e未验证，自动80/50限流和任务入口仍未接，不可称整体完成；无提交发版。
- 02:23续：生产stopObservedPlugin复用runtime/stopHost事务；新增取消/归属变更/旧实例/权限变更及真实McpClient子进程ping→关闭→exit移除5测试，70定向通过，typecheck/build通过。仅进程级链路验收，不冒充原生确认UI e2e；自动限流仍未接。
- 02:44续：队列预算匹配修复，大任务不再挡住可准入小任务；全不匹配有界退出；真实manager/ledger验证余量恢复后大任务只执行一次。73定向测试、typecheck通过。仍未生产接入自动排队，不能把核心测试当完整功能验收。
- 03:03续：manager新增每新采样最多启动1项，任务完成/tick/切模式/重复采样不重置额度；匹配失败不消耗。74定向通过；仍未接生产自动限流，不能宣称整体完成。
- 03:26续：runtime/driver显式采样/维护双循环，串行采样不阻塞队列超时、停止后忽略迟到结果并清timer，异常不逸出。78定向通过；未接bootstrap/生产任务，自动限流仍未完成。验收证据driver-tests.log。
- 03:51续：非空插件服务UI真实验收（隔离main44844，测试子45906）：取消保留PID、确认后退出且列表消失；修复残留等待退出提示，重建+UI复验已显示服务已关闭。80定向/typecheck/build通过。测试节点关闭、fixture移到docs不分发。新缺陷：Cmd+R导致已手停的插件节点重新挂载并自动起服务，尚未修。自动80/50与全入口仍未接。
- 03:59续：修复手停插件Cmd+R自动复活，main manualStop latch拦所有acquire；重试需原生确认+版本校验。隔离main48853已实测刷新仍停止、取消不启动、确认才启动子49948。82定向/typecheck/build通过。应用重启持久化仍缺，80/50生产入口仍未接；无提交发版。
- 04:08续：服务列表/确认改插件显示名，项目名+ID共享格式化，缺失/损坏名称兜底；index注入只读loadProjects不改顺序。83定向通过，显示文案未UI复验。跨应用停止持久化与生产80/50入口仍未实现；未提交发版。
- 04:37续：policy新增可区分拒绝原因，allow复用同一逻辑，manager快照带policyDecision。84定向通过；仍未生产接入，不能当完整限流或完整队列原因。
- 05:17续：scheduler/manager增加冻结任务明细（ID/项目/状态/提交后时长），取消未退出仍保留占用；85定向通过。未接IPC/UI/生产入口，完整目标仍未完成。
- 05:22续：同池嵌套父占槽await子改为明确拒绝防死锁；按实际Entry核对，父完成后的异步后续任务仍可执行。87定向通过。不是完整park/transfer，不能直接包agent生命周期，实际80/50入口仍未接。
- 05:36续：采样失败立即invalidate准入，不再等旧快照5秒过期；保留运行预算、维护取消超时，旧样本/切模式不可恢复。89定向通过，仍未接生产任务入口。
- 06:17续：修复未来采样时间戳污染latest导致正常采样永久被忽略，异常立即关准入且不更新latest。90定向通过；非完整唤醒e2e，实际80/50任务接入仍未完成。

## 2026-09-13 · 手动停止跨应用重启持久化（真机验收）

- runtime/stateStore + persistentState：固定 userData/runtime-state.json，fsGuard.guardRuntimeStateFile 不接收外部路径、不扩大通用文件 IPC 白名单；拒绝符号链接。0600 临时文件、fsync、rename；坏文件失败关闭，不静默清空停止意图。
- manualStop 延迟加载；停止/恢复先持久化成功再改变内存。stopHost 最终归属复核后、drain 之前同步保存；保存失败不会误关闭或留下 drain。plugin:panelOpen 将持久化错误返回可见 error，不留加载悬挂。
- 真机隔离开发实例主 PID 79069 -> 80355，测试服务重启前关闭后无 PID；应用重启后节点显示「服务已由用户关闭；请在插件面板点击重试并确认重新启动」，未自行拉起。点击重试弹原生确认；确认后服务 PID 80629、面板正文恢复、停止名单清空。关闭测试节点后正常 idle 回收，已核对无残留；临时插件移回 docs fixtures，不进入打包。
- 项目显示名「历史 UI 验收（p-verify）」和插件显示名已在真实关闭弹窗复核。
- typecheck/build 通过；定向 94/94。全量首次 3010：2995 通过、2 失败、13 跳过（codexCapabilityLauncher 配置探测等待5秒未观察到PID）；单文件重跑6/6，全量重跑2997通过、0失败、13跳过。保留原失败日志，不将重跑通过称为根因修复。
- 证据：docs/verification/runtime-governor/acceptance/persistence/。没有提交或发版。
- **完整资源治理仍未完成**：manager/driver 没有生产 bootstrap/工具入口接线；80/50 自动限流未启用，设置页诚实显示仅监测。AI/PTY/其他后台服务未统一接管；mac 内存估计未校准，Windows/Linux 未真机验证。不得用94个单测或服务停止验收冒充全软件资源上限验收。
- 下一实现必须处理 MCP request 超时只是调用方放弃等待、并不等于插件停止计算；否则将 run promise reject 当作释放预算会超发。需要独立实际完成/退出生命周期，再接首个真实 tools/call 切片，不能直接包整个 agent 生命周期。

## 2026-09-13 · MCP真实完成生命周期与调度适配

新增 McpClient.requestTracked：result 供调用方接收结果/超时，completed 只在有效响应（含错误）、真实进程退出、未派发时结束。超时后保留有界 ID/完成回调，不保存参数；最多128个未完成跟踪请求，拒绝超额而不发送。取消仅通知，不伪造退出、不自动重试。旧 request 行为保留。

runtime/managedMcp 将调用方 Promise 与 scheduler.run 生命周期拆开：调用方先收到超时，资源 lease 仍由 completed 持有；真实结束才释放。队列取消不派发。真实 Node 子进程测试覆盖迟到响应、取消后不退出、实际退出释放、序列化失败、128上限及队列取消。

类型检查、构建通过；运行资源/宿主/共享文案/真实MCP生命周期定向100项全部通过。日志 /tmp/eas-mcp-lifecycle-build.log、/tmp/eas-mcp-lifecycle-tests.log。**本轮未打开应用复核；生产pluginHost两条tools/call尚未切换到该适配器，80/50仍未启用。** 不把真实子进程测试叫产品端到端验收。

下一步仍是生产 RuntimeManager 单例/指标校准、pluginHost真实入口接线与模式/队列UI。当前没有提交、发版。用户明确不希望按小函数停步；后续必须以真实入口端到端交付为单位，不能再以100个测试冒充主需求已完成。

## 2026-09-13 · 插件真实入口接入跟踪生命周期
pluginHost 的面板和 shim 两条 tools/call 已改用 McpClient.requestTracked(...).result；不再走旧 request 的超时丢弃生命周期路径。RPC控制通道保持原样，不抢资源槽。真实生产路径现会执行128个未完成跟踪请求上限，并给超时调用明确“不自动重试”的结果；迟到响应/退出仍由McpClient收尾。
注意：这里只接入了生命周期跟踪，不是runManagedMcp预算调度。manager仍未实例化、80/50仍未启用。源码接线回归+真实子进程等101定向通过，typecheck/build通过；本轮未做应用内真实工具调用验收，不称完整修复。无提交/发版。日志/tmp/eas-tracked-entry-build.log与/tmp/eas-tracked-entry-tests.log。

## 2026-09-13 07:02 · 内存校对未通过
已实际打开Activity Monitor并读vm_stat/top。现有估计约34.2GiB、系统UI约35.5GB（非严格同步）；tag-storage 1.5GiB不能未经确认整块相加，SDK包含non-tag pageable/wired/free。没有改公式/启用verified；证据docs/verification/runtime-governor/acceptance/memory-calibration/findings.md。下一步校准而非再堆纯函数。未修改业务代码、未提交发版。

## 07:05 续：有界连续采样
新增可复跑只读 collect.mjs，采5次、每次vm_stat最长1秒、每次间隔1秒，输出UTC采样前后时间、总字节、页大小及全部相关分项。不加负载、不purge、不停止任何用户进程。series.jsonl 实测估计范围34.3627–34.8995GiB。随后Activity Monitor显示已使用35.46GB、App30.91GB/wired3.12GB/compressed342.3MB；仍不是同一瞬间，不能宣布精确校准通过。
保留现有估计公式及未验证标记，未做任何经验常数补偿。内存准入和80/50生产调度仍未启用。

## 2026-09-13 07:18 · 应用资源控制器正式接入启动/退出
新增 runtime/controller.ts 将唯一manager与driver、平台采样组合。runtime/ipc.ts 注册时显式start，before-quit dispose；runtime:monitor改读同一控制器缓存，不再独立创建monitor采样口径。无模块导入计时器，重复start不重入，未校准内存不送准入策略，过期>5s快照读失败而非伪装实时。没有改变index既有注册顺序。
类型检查/构建和定向集合通过（随后新增过期快照红绿回归2/2；最新小修需重新构建）。仍未在隔离应用重启验证新主进程。80/50生产任务准入未启用，controller目前只统一采样/生命周期；不要把它叫全部完成。下一动作：重新构建、隔离实例确认缓存监测运行，再补任务入口与运行中心。目标保持active，用户无需再喊继续。

## 2026-09-13 · 真机控制器/模式验证与内存差额定位
隔离main97804实际设置读CPU13.4%、15核、内存36.3/48；控制器缓存链路运行。随后新构建main98860，普通80/节能50模式按钮实测切换成功，隔离runtime-state.json为eco，未触及真实用户数据。104定向+typecheck/build通过；跨整个app重启的模式回显尚未复验（停止名单此前已验）。
运行模式主进程IPC仅主窗口主frame可改；持久化成功才切manager，不清停止名单；坏文件不覆盖。UI明确“目标阈值，不代表限流已启用”。
内存新证据：sysctl hw.memsize=51539607552、hw.memsize_usable=50583420928，差额956186624字节。Apple XNU bsd/kern/kern_mib.c 974-984解释macOS实际物理内存与扣除carveouts的max_mem不同。旧公式只加VM匿名/锁定/压缩，遗漏物理保留容量。parseMacMemory新增usable校验并加total-usable（测量值不是经验常数，不盲加tag-storage全部区域）；reader读取固定sysctl键。新增红绿测试4/4，真实reader输出36.5998GiB，memoryAdmissionVerified仍false。该最新修正未构建/应用内复验，不宣布全面校准通过。
下一步：重建并校对修正后的读数，完成同一控制器的真实任务准入和队列UI；不要停在模式设置。Goal保持active，无需用户再喊继续。

## 2026-09-13 · 真实面板工具活动与取消（开发实例验收）
本轮不再停在未接线纯函数：pluginHost两条tools/call接入toolActivity真实生命周期投影，窄IPC runtime:cancelTask 校验主frame/实际窗口归属；UI展示面板任务名称/项目/耗时，取消只发通知，完成前保留，未知shim不冒认窗口。测试覆盖调用方超时仍保留、跨窗口拒绝、取消幂等、实际完成移除、启动失败无孤儿。生产80/50预算仍未接，明确仅监测。
隔离实例主PID5908，重新构建打开；节能50跨应用重启回显通过。真实本地verify_wait：界面显示执行中15秒与历史UI验收项目；点击取消显示等待取消确认21秒；随后任务消失，托管服务仍运行，测试面板显示已结束。已关闭测试节点，fixture移回docs不进包，等待既有30秒idle自然回收。没有碰生产实例。
本轮改动前全量3021项：3008通过、0失败、13跳过；改动后定向95通过、typecheck/build通过（/tmp/eas-tool-center-*）。此全量不能冒充本轮新改动全量；正在继续主需求，不提交发版。设计router指向的旧visual-router技能路径不存在，UI复用项目既有cset样式未另换设计系统。
本轮新增工具中心后全量3023项：3010通过、0失败、13跳过（/tmp/eas-tool-center-full.log）。fixture已移回docs，ps确认测试服务无残留。
继续推进内存准入前置：XNU压力协议确认是dispatch1/2/4，已写parseMacPressure及红绿测试、生产reader固定sysctl并发1秒有界读取，controller接收warning/critical。最新91运行资源单测、typecheck/build通过；真实reader压力normal。新压力构建尚未重启隔离app（当前5908仍工具中心构建），该分支未称UI验证。校准修正后同采样窗口35.729–36.335GiB，对照系统36.07GB，证据存carveout-idle-series.jsonl；公式仍标签估计/verifiedfalse。不要继续对比无意义的异时单点阻塞全部工程；下一步需要明确受测平台软准入口径与保守预算，然后接runManagedMcp、真实队列/取消、未覆盖入口，完整目标未完成。

## 2026-09-13 · 排队终于接入真实插件入口（应用内验收）
pluginHost两条tools/call → toolActivity → bootstrap唯一controller.manager → scheduler/ledger → 真正requestTracked。队列取消不派发，运行取消只通知，实际completed才释放。start前重查原panel/shim/host，防节点关闭后执行旧请求。未知成本暂单探索槽，预留>=5%CPU/1核、512MiB；控制面和整个agent生命周期不进池。Darwin25arm64估计口径软准入开启、未知压力/采样失败和其他平台失败关闭，不宣称硬上限。
隔离main16928，节能50实测内存36.3/48，真实verify_wait显示“内存超过当前阈值 / 排队中7秒”；取消后面板返回cancelled，未执行。切普通80后仍等待持续恢复，因旧拥塞恢复要求低于70%，是既有滞回，未伪称切模式立即放行。
正常取消后重启隔离main18067（普通模式持久化）；手动提交两项新任务，UI实测第一执行中7秒、第二排队中6秒；取消第一，实际插件完成响应后第一移除、第二自动变执行中24秒，证明真实排队放行非单测。第二取消后面板已结束，测试节点关闭，fixture移回docs。未碰生产、未提交发版。
94定向通过、typecheck/build通过，当前全量在/tmp/eas-queue-full.log（exec41637）需检查最终结果。开发实例18067保留。整体还没完成：AI/PTY/后台入口、shim窗口归属可见取消、跨进程嵌套park/transfer、成本学习和平台范围等仍缺。UI排队取消提示目前复用“已通知取消”不够准确，需区分未派发直接取消；60秒超时英文错误需完善，但不再是“排队没接”。

## 2026-09-13 · 队列来源关闭清理
在已通过真实排队验收基础上，补齐panelClose/pluginBye→toolActivity.closeSource：源节点/租约关闭立即取消本来源排队，不再占到60秒；不同来源同项目不受影响。运行中仍只通知，不能假释放。红绿回归6项通过、typecheck/build通过（/tmp/eas-source-close-*），最新来源关闭行为未在应用内复验，不能声称已验收；当前隔离18067仍上个queue构建。
下一域已定位：AI deliverMessage→restartAndDeliver(717)→spawn(855)，首次start(1490)有会话ID和wc归属；PTY pty:create(381)目前同步spawn。不可直接拿单探索工具槽包整个agent/终端寿命，否则子工具死锁；须设计/接启动许可与真实会话内存持有分离，再接各入口及UI。全软件目标仍active，不提交发版。

## 2026-09-13 · 长会话启动准入与PTY真实接线（待应用验收）
新增manager.submitService：启动放行后释放探索计算槽，保留资源预算直到真实completed；observer reject不能假释放。11个manager测试含父服务启动完后子工具可运行，服务预算仍保留。sessionStartup主进程装配/窗口取消/队列投影已加入runtimeIPC；pty:create已改为await该启动闸门后spawn，onExit结束预算；不包整个终端寿命计算槽。97运行资源测试通过、typecheck/build通过；之后修改了UI范围文案，需要重建，**新PTY准入还没打开app验收**。隔离实例仍18067旧queue构建，重启前确认空闲。
需继续：PTY归属projectId目前null（不能凭cwd伪授权）；终端创建异步取消的前端反馈/节点关闭竞态需检查；AI restartAndDeliver/ACP尚未接启动服务；真实服务清单全覆盖、成本学习、跨平台、完整报告未完成。未提交发版，目标active。

## 2026-09-13 · 中断恢复与窗口关闭启动清理
上轮/tmp/eas-pty-final-build.log无完成标记，exec45396句柄已不存在，ps确认无electron-vite/tsc进程；按“中断未验证”处理，没有误报成功。补sessionStartup.cancelSessionStartsForWindow接killPtysForWebContents，窗口关闭立即取消待启动项；spawn前仍检查window/abort。红绿测试确认不创建进程、不跨窗口取消。重新运行97运行资源测试、typecheck、完整build成功（/tmp/eas-window-start-*，exec47830 exit0），git diff --check干净。应用内PTY准入复验仍未做，当前开发实例须重新加载本次构建；完整目标仍未完成。

### 2026-09-13 续接：监测失败不应堵住取消
- 上轮有代码/测试进展；旧全量日志 /tmp/eas-window-start-full.log 没有结束统计，当前无对应测试进程，不能算通过。
- 新增 controller.readForControl，主监测 IPC 改用控制快照；首次/过期/异常仍能列任务服务，隐藏旧占用值，准入继续关闭。
- controller 测试先红后绿 4/4；typecheck 会话25466待核对；UI 尚未亲眼验收，不宣称完成。
- 全目标仍未完成：AI/后台入口及服务统一登记、PTY实际实例验收等继续。

### 2026-09-13 可见实例续验
- 原构建句柄39287丢失且日志无结束，不计通过；确认无构建进程后重跑30071，exit0，/tmp/eas-control-build-retry.log renderer built3.24s。
- CUA正常退出隔离旧实例18067，启动新构建40433，隔离userData不变。亲眼打开设置→性能与诊断，显示CPU约9%、内存36.8/48GB、普通80%及任务启动队列；异常采样分支仍仅单测覆盖。
- 画布Frame标题终端按钮创建真实PTY成功；放大新终端，执行echo runtime-pty-accept-ok，肉眼确认输出和shell提示符。第一次typeText特殊字符不准，随后paste超时但实际已粘贴，经截图核对后只按一次Return，未重复提交。
- 无提交/发版，正式实例未动。下一步继续PTY排队/取消及AI入口覆盖，不能把正常启动成功当作全资源治理交付。

### 2026-09-13 终端加入运行服务中心（代码，待实例验收）
- ownedSessions登记真实PTY，列表同窗口可见，运行时长从spawn计算，确认后重验对象身份，只在onExit移除；新增2测试通过。
- projectAttribution基于主进程项目表最长目录祖先，仅显示、不授予权限；新增1测试。
- 当前运行资源测试101/101通过。typecheck+build句柄75108，日志/tmp/eas-owned-typecheck2.log及/tmp/eas-owned-build.log待核对。
- 新代码未加载进实例40433，不宣称UI已通过。实例中仅验收终端闲置、无生产任务。
- 75108 typecheck/build均exit0；新隔离实例47873已加载。CUA实测终端显示项目历史UI验收(p-verify)、运行状态和时长；关闭→取消保留运行，再关闭→确认后显示服务已关闭且列表消失。此正常PTY服务关闭路径已实际通过；全进程树/AI仍未覆盖。
- 全量41576 exit1：2项 capabilityPtyTransport.test.ts 失败，均ReferenceError completedResolve is not defined。测试抽取真实onExit回调在VM执行，新增完成回调后测试沙箱未注入；补回调并断言确实调用。定向6/6通过。全量重跑35710，/tmp/eas-owned-full-retest.log，需跟踪最终退出。
- 全量重跑35710 exit0：3034 tests,0fail（/tmp/eas-owned-full-retest.log），这是AI服务投影新增前的快照，不涵盖随后改动。
- 接入wireProc直连AI进程服务投影，真实close事件移除，generation-local stop捕获proc，ACP与AI准入尚未接。source wiring测试先红后绿1/1；类型检查73320待核对。必须下一步继续实际构建与实例测试，不能宣称AI治理完成。
- 直连AI启动接入startManagedSession（非ACP）：保留同步收件但实际spawn在回调；唯一runtimeStartupId防重复，窗口/会话/abort复核；close释放预算；interrupt/stop/window teardown取消排队。无proc interrupt也发turn.done。当前只接启动，不接活跃stdin消息和内部工具。
- 新接线测试2/2，69112类型检查日志无错误（需核对句柄最终状态）；上述取消收尾修改之后仍需重跑。所有AI新增行为尚未实例验收，下一步不能绕过。最新运行实例47873还是仅终端服务版本，out已构建AI投影但未含最新AI准入。
- 运行资源测试103/103通过，git diff --check干净；构建/类型检查22813正在执行，/tmp/eas-agent-admission-build.log。UI范围文案刚补直连AI启动，如构建已读入renderer前则包含，否则需重建。下一次先核对该句柄、再继续隔离验收，不能重复启动未知状态任务。

### 2026-09-13 AI排队真实验收
- 新隔离实例58987，节能50%，整机内存31.9/48GB。提交只回复OK且不调用工具的验收消息；运行中心显示claude启动排队23秒、内存超阈值、项目p-verify、无托管服务。
- 运行中心取消后对话停止处理、输入框恢复，显示对话启动未完成cancelled，0输入/输出；没有启动AI服务。发现取消文案误标致命且队列乐观留“等待确认”。已改startupFailure分类取消/超时为非致命，并取消后立即刷新主进程真实快照；新增测试1/1。
- 类型检查+build13138（/tmp/eas-ai-notice-types.log、/tmp/eas-ai-notice-build.log）待核对；当前实例仍是文案修改前版本。正常AI启动/回应/停止仍需验收。没有提交/发版，全目标未完成。
- 58987普通80%切换后内存约32/48GB低于70%恢复线；手动发送新的Reply only READY（非重试旧任务），真实claude子进程60304启动并回复READY，无工具调用。服务中心显示claude对话、项目p-verify。随后确认关闭服务，等待真实退出清单更新。
- 13138类型检查与构建exit0；最新runtime tests104/104通过。正常回应实测用的仍是取消文案修复前实例，最新构建尚未重启加载。UI记录显示费用$0.86，来自既有用量显示，未额外开启任何付费生成。
- AI服务确认关闭完成：CUA显示服务已关闭、无运行服务；60304 pid已消失。正常回应/关闭实际通过，取消新中文文案待加载复验。
- 全量95159 exit1，processHandoff测试VM缺cancelRuntimeStartup/ownedSessions等新依赖，以及旧同步restart测试入口已改为异步包装。补主进程依赖沙箱，原spawn失败/角色MCP限制仍测试真实restartAndDeliverNow，并保持原断言，10/10通过。
- 新agentStartupLifecycle.test.ts抽取实际restartAndDeliver包装函数，使用真实RuntimeManager+sessionStartup：等资源不dispatch、重复拒绝、取消零dispatch、手动新消息启动、计算槽释放但预算到真实close才释放；1/1通过。
- 全量重跑49881正在执行，/tmp/eas-ai-full-retest.log。下一步先跟踪该句柄，不用窄测试冒充全量。
- 全量49881 exit1，仅ownedLauncherControl.test.mjs测试VM缺cancelRuntimeStartup。补该依赖并断言窗口清理确实取消对应会话；定向4/4。全量重跑95996，/tmp/eas-ai-complete-regression.log。
- 已加载最新取消文案构建，隔离实例65518，节能模式。手动发送CANCELTEST后立刻在对话点停止生成：恢复空闲/发送按钮、0输入输出，没有模型回应。这条对话自身取消排队路径实际通过；主运行中心新文案尚未重复操作验证。
- 95996全量回归最终exit0（/tmp/eas-ai-complete-regression.log）；之后未改生产源码。接下来继续ACP/后台入口治理与平台能力，不可将当前插件+终端+直连AI的切片宣称全服务治理完成。当前没有必须用户解决的阻断。

### 2026-09-13 ACP续接
- 接回 ACP openAsync 泛型推断失败，以 openOmpProcess 返回联合显式参数修复，第一次类型检查38675 exit0。
- 补取消/设置拒绝/关闭晚到进程测试，先红后绿；ACP专项194项193过1跳。随后加入真实连接close和旧握手隔离、ACP ownedSessions投影、窗口/空闲/退出对称close，最新11766（/tmp/eas-acp-lifecycle-green.log、types.log）仍需核对。
- 新ACP生命周期没有构建进隔离65518，不宣称应用验收。全目标仍未完成；继续测试与实例验证，不提交发版。
- ACP真实二进制+隔离localhost零费用模型验收29402 exit0（/tmp/eas-acp-real.log）：等待时零spawn、取消零请求、手动新消息后真正启动并回应、计算槽释放但512MiB预算持有到child close；关闭预算归零。此为实际进程协议测试，不冒充UI验收。
- 全量7512 exit1，唯一ownedLauncherControl原断言仅窗口取消1次，现在应用软/硬退出也取消，应为3次；已同步断言并额外检查ACP三处close。重跑26076（types/tests/build，/tmp/eas-acp-delivery-*），必须核对最终结果。
- 26076最终types+全量+build exit0：3045tests，3031pass，14skip，0fail。隔离已重启80426。尝试ACP UI首发进入账号引导（隔离柜未登录），没有迁移生产凭证；关闭引导。ACP UI未验收，真实本地模型协议验收已过。
- 继续补PTY分屏/切换等待竞态：源pane关闭/替换则释放晚到PTY，创建失败不提前杀旧pane；5条新增用例加4条旧split通过。严格controller.read采样失败不再返回5秒内旧样本，先红后绿。最新源码尚未构建进80426，后续需跟进。
- 84462全量types/tests/build exit0：3051tests3037pass14skip。隔离重启85017，当前分屏视图；创建空闲终端、切节能、请求分屏、关闭原终端，UI回到AI面板；当时源关闭还不会撤销排队，已继续修。
- pendingPaneStarts+startupRequestId 已接分屏/切换与closeTab/closeLeaf：关闭立即走主进程所有权校验取消，晚到成功清理保留。11定向tests/types65828待核对，另补实际slice取消接线测试。新源码未构建进85017，必须继续构建验收。
- 36248全量+build exit0：3054tests3040pass14skip，之后继续发现真实关闭残留，不能拿此构建覆盖新补丁。
- 隔离85017源终端关闭后zsh85326仍为子进程Ss+；服务中心显示5分钟运行属实。killTree仅SIGTERM，交互式shell可能忽略。补所持PTY默认SIGHUP，保留后代清理，单测先红后绿；Electron真实node-pty+zsh-f-i探针exit0确认退出。生产未碰。
- 原85326已通过隔离服务中心确认关闭（默认pty.kill路径）；需核对实际消失。新killTree补丁仍待build/UI复验。
- 本地报告新增 docs/verification/runtime-governor/acceptance/current-delivery.html，沿用旧报告内联样式（指定report-preset路径不存在），清楚列已通过/未验证/尚未覆盖。尚未在画布打开，不当整体最终交付。
- 9597 types+全量+build exit0：3055tests3041pass14skip，日志/tmp/eas-pty-hangup-*。当前隔离93060已加载。
- 重要纠正：早先坐标点击分屏按钮时工具栏未显露，不能算真实排队。93060显露工具栏后用AX239按钮发起，运行中心明确显示“终端启动 排队中5秒 / 内存超过阈值 / p-verify”，才继续关闭原终端。
- 93060实际验收：节能50%，内存33.0/48GB，确认排队后关闭源终端；几秒后运行中心“当前没有执行或等待中的任务 / 当前没有运行中的托管服务”，源取消与PTY挂断联动通过。没有等60秒，不是手工点运行中心取消。当前仍节能、分屏、设置→性能打开，只有空闲AI视图，无终端或AI子进程。
- current-delivery.html 已更新最新3055统计和此实际路径；仍明确全软件覆盖未完成。接下来应继续Frame新建/恢复取消反馈以及后台入口治理，不要最终回复宣称完工。
- 继续Frame链：openTerminal现在返回自身leafId；Frame新增/恢复与prefillTerminal使用精确ID，不扫描并发新增的第一个tab，避免命令落错终端。sourceFrameId关联pendingPaneStarts，removeFrame连后代撤销等待；Frame已删除/换项目时释放晚到PTY。3新增动作测试通过，87037类型检查exit0。
- 93060仍是PTY挂断构建，尚不含新Frame关联；全量/构建待继续。恢复中单个无leaf占位节点删除、终端创建失败反馈和后台入口尚缺。
- 65563 全量+build exit0：3058tests3044pass14skip；最新隔离97739已加载Frame关联。实测Frame终端启动排队7秒（节能、33.9/48GB），右键删除测试Frame后队列和服务均清空。撤销恢复Frame；原空闲AI节点未随撤销回来，手动点Claude恢复空闲视图，无消息发送、生产未动。
- 开始顶部运行中心：RuntimeCenter原生dialog右侧抽屉+标题栏计数，复用现有RuntimeMonitorPanel；外部点击/Esc和焦点返回，隐藏页不轮询。runtimeCounts先红后绿1/1，类型检查40691待核对。尚未build/UI，不宣称完成。
- 运行中心构建13656通过：3059tests3045pass14skip；隔离2935实际验证暗色、外点/Esc关闭及焦点返回，真实Frame终端等待计数与中心取消通过。新增ACP实际makeAcpLive接线测试后47693全量3060tests3046pass14skip、types通过。
- 本轮继续在隔离2935切亮色，亲眼确认运行中心正文/按钮/遮罩显示正常；窄窗口drag参数失败，未改变窗口，窄窗仍未验证。没有触碰生产。
- 延迟预填发现700ms内面板关闭/替换仍会写旧PTY，动作测试先红2项后绿4/4；补执行时pane身份/PTY复核。不实际执行安装。最新types+全量+build82176执行中，日志/tmp/eas-prefill-*；必须核对结果并重载实例，不能将未构建代码算完成。
- 82176最终exit0：typecheck、3063tests3049pass14skip、build全部通过；git diff --check干净。通过CUA正常退出隔离2935，启动最新构建。全目标仍active，后台入口未覆盖，不提交发版。
- 最新隔离PID9207已确认打开、亮色、运行0。之后继续LSP前置：握手失败原来会遗留进程；新增真实隔离stdio子进程测试先红后绿1/1，LspClient增加实际close完成信号、单次启动、握手失败stop。8608类型检查待核对，新LSP源码尚未build。共享LSP缓存归属/准入未接，不能报已覆盖。
- LSP类型检查8608 exit0。全量+build87479正在执行（/tmp/eas-lsp-full.log、/tmp/eas-lsp-build.log），需核对。下一步代码定位：lspProvider.ts的clients按root+NUL+bin全局共享，clientFor直到await start后才入缓存（并发会重复启动）；codeGraph:neighborhood当前丢弃_e，缺窗口所有权。不可直接归属首个窗口后允许跨窗口关闭，需共享引用/窗口生命周期或显式隔离设计。现有窗口9207不含LSP补丁。
- 上轮属于实质进展：LSP真实失败退出测试和全量构建87479已完成（3064tests3050pass14skip）。本轮确认日志后继续LSP并发缓存；2条动作测试先红（重复spawn、失效仍成功）后绿，连真实进程生命周期共3/3通过。缓存先登记初始化Promise，失效/失败按对象代次清理。37431类型检查正在执行，最新缓存源码未构建进实例9207；仍未完成窗口共享引用/软准入。
- 37431类型检查exit0；52198全量+build仍在运行已复核句柄，日志/tmp/eas-lsp-cache-full.log和build.log。后续接入口定位runtime/ipc.ts（stop按pty:/agent:路由，monitor拼ownedSessions和插件），codeGraph.ts neighborhood需传真实event.sender作用域；LSP共享缓存不能仅用首窗口所有权。
- 52198最终exit0：全量3066tests3052pass14skip、build通过。最新LSP缓存仍未加载进隔离9207，UI路径未验收，不将单测/构建当应用验收。目标保持active，继续共享服务归属和准入接线。
- 本轮新增sharedServices引用登记，最后窗口释放才关闭、实际close才移除、确认期间新引用阻止关闭；2测试通过。接codeGraph真实sender生命周期、lsp缓存共享引用及runtime IPC列表/stop路由。60632类型检查待核对；新增实际缓存引用接线测试待结果。尚未接LSP准入，也尚未build/UI；重新解析dropLspClients全项目失效仍需收紧共享作用域。
- 60632类型检查通过。实际LSP缓存共享引用接线通过；补共享重解析防护先红后绿，避免symbols→dropLspClients绕过共享服务保护。6项定向通过。45342执行types/full/build（/tmp/eas-shared-lsp-*），必须跟踪。服务列表文案补LSP仅登记未准入；新UI未验收，当前9207仍旧构建。
- 45342全量+types+build exit0：3070tests3056pass14skip。随后加共享服务will-quit幂等关闭（不用可取消before-quit），测试先红后绿3/3；新生命周期需再build。当前没有运行中的测试句柄。下一步继续LSP准入、实例验收，不能把共享登记当准入已接。
- 最新类型检查/构建61381仍在执行，日志/tmp/eas-shared-final-types.log和build.log；不要重复启动，先核对原句柄。运行实例9207尚未加载共享服务。sharedServices目前独占可stop、共享只读；计划里“释放当前项目引用”的用户操作尚未做。
- 61381 types+build最终exit0。最新共享登记已构建，仍未加载UI。发现窗口页级生命周期也需处理：index.ts did-navigate会清PTY/AI，但LSP当前仅destroyed释放，下一步补同样导航/崩溃释放，避免reload后旧页面引用残留。
- 本轮加sharedWindowLifecycle（重复导航/崩溃/destroyed去旧引用）1测试；sessionStartup支持主进程共享窗口Set，关闭一个不撤销其他，最后引用才取消，测试通过。
- LSP clientFor已接startManagedSession共享准入，只有实际spawn时登记服务，预算到close释放；缓存+真实manager接线5测试通过。旧34844类型检查失败：WebContents on签名过宽、测试opts隐式any；已修窄事件接口和测试入参。25411正在types/full/build（/tmp/eas-lsp-admission-*），后续先跟踪。最新UI文案已补启动准入但存量索引不可抢占。尚未加载9207，未宣称实例通过。
- 25411 types/full/build exit0：3073tests3059pass14skip。额外真实/usr/bin/clangd隔离验收31660通过：排队零spawn、取消零spawn、新请求真正握手、计算槽释放/预算到child close释放；无网络账号费用。该新增测试默认跳过，未含在3073快照。已通过CUA正常退出9207并启动最新构建，需确认新实例UI。
- 新隔离PID25603已加载并通过CUA确认最新LSP范围文案；窗口拖至实际最小860×659，运行中心亮色可读、关闭按钮可用、关闭后焦点回顶部。该项是抽屉UI通过，不是LSP完整UI路径验收。current-delivery.html追加最新证据与剩余缺口。接下来应做隔离C项目的应用内LSP路径，并继续后台入口，整体未完。
- 纠正：上条HTML写入Python因编码报错未执行；已改用Node补入实际最新证据段，未用失败命令冒充交付。
- 应用内LSP验收准备：在/tmp/eas-runtime-lsp-ui创建仅main.c与compile_commands.json的测试目录，通过隔离25603项目抽屉添加成功，当前激活eas-runtime-lsp-ui（历史UI验收项目未删）。画布仍显示原历史Frame。代码地图组件位于左抽屉下部，点击和拖到空白画布未创建节点；当前未触发LSP，不当通过。下一步定位实际组件drop目标/现有代码地图入口，避免分析整个worktree冒充小型隔离测试。
- 应用内推进：已把测试项目拖入独立Frame，并把代码地图拖入该Frame（组件必须落Frame，空白不接）。模块页正确只扫描1个C文件、1ms；符号页显示“无tsconfig，暂只支持TS/JS”，clangd就绪但没有C符号查询入口。源码确认neighborhood调用仅SymbolView.tsx的TS符号按钮能触发，因此C项目UI无法走到LSP调用，这是既有入口限制，不是准入验证通过。LSP真实clangd协议与主接线测试已过，应用LSP整链仍未验证；不能为验收造成功。
- 本轮语音前置：发现transcribeAsync超时删除pending导致8任务上限失效、旧worker错误会清空新worker。新增workerRequests结果/完成分离与身份隔离，stt接实际result/exit；2单测先红后绿+实际源码VM接线1/1。26999类型检查通过。76946全量+build执行中（/tmp/eas-voice-lifecycle-*），需跟踪；当前隔离25603仍不含语音补丁，UI未验收，语音准入/服务登记仍未接。
- 76946最终exit0：3077tests3062pass15skip，build通过。新增加的真实LSP测试默认跳过导致skip从14变15，如实保留。语音worker修改仍未加载隔离25603、没有录制用户音频，未宣称UI验收。计划头部旧“待评审未实现”更正为用户确认/实施验收中，未缩小目标。下一步语音准入应使用workerRequests.completed，不得按result超时释放预算；VAD也需实际exit完成信号。
- 本轮VAD生命周期前置：VadSession.completed绑定真实worker exit，stop幂等，源码行为测试先红后绿1/1。61077正在types/tests/build（/tmp/eas-vad-completion-*）；需核对后再加载。当前开发实例25603仍是LSP构建，不含ASR/VAD最近代码。语音准入/服务登记仍未接，不宣称完成。
- 61077 types/full/build exit0：3078tests3063pass15skip。之后补VAD初始化前exit立即拒绝（不再白等15s），新测试先红后绿，VAD专项2/2。最新types/build86006执行中（/tmp/eas-vad-exit-*），需核对。当前无实际麦克风采集，语音统一准入仍未接，不能称整体验收成功。
- 86006以及70964类型检查已确认exit0。runManagedTask新增结果/实际完成分离接口，运行中取消只触发signal，预算待completed；专项6/6。额外真实Worker线程测试2/2通过，不启麦克风、不读音频文件。
- 最新61367 types/full/build在执行，日志/tmp/eas-managed-task-final-*；全量已3080tests3065pass15skip0fail，构建仍需确认。新增真实Worker两测试是在全量枚举之后加入，需另计，不把它混入3080统计。一次Node编辑脚本语法错误未写入，之后修正并专项通过。
- 语音真正接入调度及驻留模型服务还未做，当前25603仍旧LSP构建。整体目标保持active，不提交/发版，不把基础接口当完整交付。
- 61367最终exit0：types、3080tests3065pass15skip、build均通过。真实Worker补充2/2单独通过。已CUA正常退出25603，再用同一隔离userData启动最新PID58990，AX确认最新应用打开、原两个Frame和空闲AI保留。没有录音，语音真实UI路径仍未验收；后续继续ASR驻留服务+解码调度接线，不要重复重启旧实例。
- 用户要求先继续原任务，暂不扩展事件流显示；之前“不同事件流”的口头根因未经查证，不可当事实。最新继续ASR真实接线：transcribeAsync三个入口传实际sender，经runManagedTask排队才创建/投递worker；窗口生命周期取消等待。共享worker不单任务强杀，实际完成才释放。源码VM改用真实manager测试通过1/1；41669类型检查需核对，新代码尚未构建/实例验证。
- 77409旧类型检查句柄已不存在，仅日志无错误，不能据此报exit0。当前开发实例58990还没有本次ASR准入代码。仍缺驻留服务预算、VAD和流式准入；未触碰生产，未提交发版。
- 41669实际exit2：旧测试stub的opts隐式any（TS7006）；后改真实manager去掉stub已消除。17406最新类型检查已过，正在全量测试/随后构建（/tmp/eas-voice-admission-final-*），下轮先轮询原句柄，不重复启动。git diff --check干净。
- 用户明确排期：先完成运行资源闸门原任务，再修AI对话工具执行可见性/等待状态/结束续接。本轮只初查，不抢占原任务。shell实际PPID=69226(codex)，子code-mode-host路径为Eas-Term/cli-versions/codex/0.154.0；可确认本次命令是Codex CLI链，不是Claude。未采集原始协议，根因仍未确认，不能再宣称“不同事件流”已证实。
- 用户选择第1项：查上一轮未收尾测试。确认旧句柄17406和日志末尾PID68362不存在；旧日志没有汇总，不能追认通过，也不能从最后一行断言隧道是根因。单独重跑hub.test.ts（30秒上限）9/9、8.4秒、exit0。随后58206原npm test全量复跑3082tests3067pass15skip0fail、28.9秒、exit0；日志/tmp/eas-voice-recheck-full.log含EXIT_CODE=0。未复现测试挂死，旧执行中止原因仍无证据，不能归咎测试代码。当前最新ASR接线全量通过，构建与实例语音验证仍未做。
- 继续查证发现ASR接线新缺口：stt.ts transcribeAsync末尾catch(()=>null)，stt:transcribeChunk再转为空字符串；wiki/transcribe.ts第100行收到空文本仍递增进度并最终ok:true。因此取消/排队失败可能静默遗漏片段，后续必须区分失败与无声，停止文件转录并保留已有结果，不自动重放。未修，不能整体验收。最新构建50830执行中，日志/tmp/eas-voice-admission-build-verified.log，需跟踪原句柄。
- 用户要求交接，停止功能修改。已生成docs/handoff/2026-09-13-runtime-governor/index.html与file-manifest.json，枚举169个当前改动文件（45 tracked、124 untracked，混合历史改动不冒认作者），附3份验证摘要。50830构建exit0已核对，最新语音UI未验收。接手先修取消/准入失败静默空文本，再补完整治理；不提交/发版。


### 2026-09-13 11:40 PDT · 从 runtime-governor 交接继续：转录失败传播
- 交接目录169个文件哈希、分支、HEAD全一致；只在voice-regression改动，未回滚历史、未commit/release。
- 修复文件转录失败→空串成功、worker error被忽略、部分逐字稿丢失、保存失败误报done；运行中取消拒绝调用方但预算等真实完成；中文IPC错误归一化。9个源码/测试文件范围详见docs/verification/runtime-governor/acceptance/transcription-handoff/changed-files.json。
- 最新types→全量tests→build句柄7421已exit0；3090 tests / 3075 pass / 15 skip / 0 fail，日志/tmp/eas-handoff-transcription-ui-{types,tests,build}.log。此前3089版本也通过，不代替最新快照。
- 真实UI PID90413，/tmp/eas-history-ui-review/Eas-History-Dev.app，原隔离profile未变。旧58990已正常退出；90041额外sandbox-exec启动失败退出，失败原因及后续直接标准启动记录在本地HTML。未使用--no-sandbox，未改应用安全代码。
- 临时知识库/var/folders/7s/29s7qf5s7w778xnb_txz3_q00000gn/T/eas-runtime-transcription-wiki-80any_28，只含官方模型测试样本easgovernor.wav/easverify.wav，不是用户音频。节能内存约32.1/48GB，真实语音解码排队6秒→运行中心取消→知识库红条“第1/1段转录中止：已取消；未自动重试”截图亲眼确认。没有采麦、没有发送模型消息。多段部分保存、运行中取消仅行为测试，勿夸大。
- 当前仍节能、知识库抽屉打开、无排队和托管服务，PID后续重核。全任务仍未完成：模型驻留/VAD/流式准入、其余入口、共享项目释放/进程树、父子额度/成本、运行中心筛选/近期结束、压力/跨平台。没有必须用户解决的代码阻断；继续原计划，不能停在本切片宣称全部完成。工具可观测性后续任务未动。

### 2026-09-13 12:52 PDT · 检查点确认
用户要求继续并询问大功能开始前能否一键回退。检查HEAD/log/reflog/stash/tag：未找到资源治理专属的开始前检查点；2d884c2是0.4.94基线，未提交区混杂其他功能，不能reset/clean冒充仅撤资源治理。原交接manifest只有哈希，不是内容备份。
已创建当前源码检查点：/Users/biily/Biily/Projects/vibe coding/terminal/.checkpoints/runtime-governor-20260913-125147；2970文件，source.tar.gz 138190968字节，逐文件SHA256读回验证通过，history.bundle verify通过，附tracked.patch/status/head/manifest/README。不含ignored依赖、构建、运行时数据或凭证；并非整个磁盘备份。未做恢复演练，不能宣称可一键精确回到功能开始前；未commit/release，工作树未回退。后续继续功能前已有这一当前状态保护点。

### 2026-09-13 12:54 PDT · 用户指定灾难回退基线
用户明确同意将提交2d884c284b4456b4eeef532857f2b5a45fcfe1d8作为大功能改坏导致项目无法使用时的回退点，并要求继续开发。已建本地annotated tag：checkpoint/runtime-governor-baseline-20260913，rev-parse核对一致。未新提交、未push、未回退当前代码。执行灾难恢复前仍保全届时完整工作区；该回退会撤掉基线后所有代码改动，不仅资源治理；不自动替换正式应用或清除用户数据。当前源码备份仍保留在.checkpoints/runtime-governor-20260913-125147。

### 2026-09-13 · VAD 准入续接验证
- 已实现managedVad：排队不创建线程，启动后释放计算槽、实际worker exit才释放驻留预算；voice所有权登记，取消、窗口导航/崩溃/销毁释放等待，录音按钮初始化取消/卸载通知主进程。原始VAD初始化失败等待真实退出，避免提前放行。
- 最新types/full/build均exit0；全量3098测试、3083通过、15跳过、0失败，日志/tmp/eas-vad-final-{types,tests,build}.log。真实模型Worker测试通过，未采集麦克风。git diff --check干净。
- CUA正常退出旧隔离90413，最新开发实例PID36241，实例信息/tmp/eas-vad-instance.json。亲眼查看运行中心截图：最新ASR/VAD覆盖及未覆盖说明可读，节能模式，暂无任务/服务。仅证明运行中心加载与显示；实际录音按钮→VAD排队/取消整链仍未做应用验收，勿宣称通过。生产应用未动。
- 下一步继续ASR共享模型驻留、主线程流式准入等原计划；完整资源治理未完成。检查点tag已建立且再次核对commit一致，没有执行回退、提交或发布。VAD启动中取消在raw worker就绪后停止，仍可能等既有15秒初始化超时；不宣称立即终止初始化线程。

### 2026-09-13 13:16 PDT · ASR 驻留模型接入与实际文件验证
- 新managedAsr+asrWorkerLifecycle：共享模型加载先准入，ready释放启动槽、真实exit释放驻留预算；解码在模型准入后单独提交，避免父子槽死锁。模型保守10%CPU/512MiB，解码10%CPU/64MiB，未标硬上限/实测。窗口引用由主进程建立；最后窗口离开停止，旧线程错误不清新代次。sharedServices voice类型与voice-asr停止路由接入。
- 新增生命周期、共享准入、真实SenseVoice、停止路由测试；真实stt接线测试更新覆盖驻留、超时、旧代次。首次全量46778 types/tests/build exit0：3102tests/3087pass/15skip/0fail。保留Node模块类型警告，无新增依赖。
- 正常退出旧36241，隔离新PID46704，/tmp/eas-asr-instance.json。CUA实测：官方样本/tmp/eas-asr-resident.wav（179646字节）导入隔离知识库；节能50%、32.5/48GB时显示“语音识别模型 排队中”，无服务；切普通80%后经历“等待资源持续恢复”再准入，解码结束后任务清空，ASR模型仍显示运行。完整逐字稿00-inbox/.transcripts/eas-asr-resident.wav.txt实际101字节，非空。没有采麦或发送AI消息。
- 点击ASR关闭服务，经系统确认，再看到“服务已关闭”且服务列表为空；恢复隔离实例节能模式。此为真正文件→模型准入→解码→空闲驻留→关闭的UI闭环，不代表流式录音或跨窗口/平台已验收。
- UI发现确认框把未知项目说成“无活动项目引用”；已定位唯一runtime/ipc.ts文案并先红后绿改为“项目归属未识别，可能仍有活动操作”。这处最后补丁尚未加载46704；38359正在最终types/full/build，日志/tmp/eas-asr-verified-*，先核对原句柄，不重复跑。前一版UI闭环有效，最新确认文案尚待亲眼检查。
- 整体原目标仍未完成：主线程流式准入、其余启动入口全量清单/接入、父子工具预算/成本学习、按项目共享释放/进程树、运行中心筛选/近期任务与压力跨平台。tag/checkpoint原样，未回退/提交/发版，生产未动。
- 38359最终types/full/build exit0，仍3102/3087pass/15skip/0fail。已正常退出46704并加载最终PID51113（/tmp/eas-asr-verified-instance.json）。再次通过UI导入官方测试副本eas-asr-confirm.wav，模型驻留正常；亲眼确认修正后的系统关闭弹窗显示“项目归属未识别，可能仍有活动操作”，执行关闭后服务清空，恢复节能。最后补丁应用验收已补齐，无正在执行验证进程。
- 已更新acceptance/transcription-handoff.html最新ASR段，asr-resident/存types/tests/build摘要、实例和触及11文件哈希（含混合历史改动，非作者归属证明）。后续从主线程流式识别准入接续，整体仍未完。

### 2026-09-13 19:18 PDT 续接 · 流式模型加载准入
- 新voicePreviewAdmission经runManagedTask管stt:start加载阶段，绑定录音AbortSignal及页面生命周期；已开始的异步加载即使调用方取消也等实际settle才放加载额度。ensureRecognizer新增单一loading Promise合并重叠初始化。仅加载预算10%CPU/512MiB估算，不代表主线程模型驻留或decode已纳管。
- 新voicePreviewAdmission、voicePreviewWiring、voicePreviewLoading先红后绿；既有VAD取消测试只在其加载前置提供透传，真实加载接线由新VM测试使用真实manager覆盖。额外“准入同轮取消”用例直接通过，无对应额外生产修改。
- 73972 types/full/build exit0：3105tests/3090pass/15skip/0fail，日志/tmp/eas-preview-{types,tests,build}.log。git diff --check干净。没有未收尾测试进程。
- CUA正常退出旧51113（首次动作遇用户窗口变化提示，重新读取状态后才退出），最新隔离43056，/tmp/eas-preview-instance.json，原profile不变。真UI：节能，内存31.6/48GB起始；点击语音输入→“取消语音初始化”；运行中心显示“流式语音模型加载 排队中7秒”，CPU73.7%、内存36.1/48GB，无托管服务；取消队列清空，按钮回“语音输入”。未开始采麦，无新增麦克风授权，无AI消息发送。未测试实际流式录音。
- docs/architecture/17及acceptance/transcription-handoff.html已记范围与实测，preview-admission/存摘要实例。下一步应将流式recognizer/实时decode迁至可确认退出的Worker并做有界音频背压，不可把加载准入当全语音完成。整体其它入口/共享项目释放/父子预算/压力跨平台等仍未完成。checkpoint原样，未回退/提交/发布，生产未動。

- 记录纠正：首次Python报告写入因stdin编码SyntaxError未执行；后改Node实际写入报告与preview-admission摘要，已补齐，不将失败命令记为成功。

### 2026-09-13 20:07 PDT · 流式 Worker 驻留续接
- 在voice-regression接回19:28–19:30已有未接线的voicePreviewWorker/Session与测试；先跑4/4（含真实模型）。本轮没有另建平行实现。
- 实际stt主线程recognizer/load/decode移入单录音Worker；openManagedPreview替换并删除loadVoicePreview旧分配-only路径，ready释放启动槽，10%CPU/512MiB保守驻留预算等真实exit释放。取消加载立即请求terminate、失败等exit；不是硬上限/实测成本。
- 音频ACK上限32768样本、64请求；复制后转移以保住SenseVoice音频。FIFO take切句，partialBoundary拦住同编辑器上一句迟到预览。stt sender/epoch、跨编辑器归属、窗口导航、VAD迟到取消守卫保留；voice-preview停止走ownedSessions原生确认。
- 新生命周期、stt接线、partial迟到、runtime停止路由先红后绿。17项专项通过；真实官方WAV+真实manager/Worker准入、非空文本、第二次take为空、心跳、退出预算归零通过。首轮3114 tests/3099pass/15skip/0fail，随后最新全量有失败，不能沿用首轮标绿。
- 最终全量两次失败：第一次packages.test.ts的假CLI --version 8s ETIMEDOUT（3098pass/1fail/15skip）；第二次codexCapabilityLauncher.test.mjs的3项config阶段5s等待断言失败（3096pass/3fail/15skip）。单文件原样复跑分别1/1与6/6通过，未改代码/断言/超时；未确认根因，不冒称环境原因。最新全量未通过，需后续排查。原日志/摘要在acceptance/preview-resident/。
- 类型检查+build最终exit0（62650），git diff --check干净。原43056经CUA Cmd+Q正常退出，最新隔离84898加载final构建，原profile不变。生产未动，无提交/发版/回退，checkpoint仍2d884c2。
- 真UI：节能50%、33.1/48GB，点击语音输入→取消初始化；运行中心流式模型加载排队7秒且无服务→取消任务→队列清空/语音按钮恢复。另切普通模式，经DevTools显式window.api.stt.start('basic')只初始化模型（不调用getUserMedia、不送音频），实际流式服务驻留→原生确认关闭→服务已关闭/列表空，恢复节能。真实模型解码是Node Worker测试，不冒充采麦UI全链。
- 控制台首轮paste超时无输入，typeText漏标点导致SyntaxError未执行；后AX setValue核对完整命令再Return，仅一次成功启动。DevTools Autofill协议警告保留；非产品STT异常。未新增权限/未采麦/未发送模型消息。
- 架构03/10/17与transcription-handoff.html已更新；后续优先查全量启动测试不稳定，再补实际录音、标准/强VAD整链，以及其余入口/共享项目释放/父子预算/压力跨平台。全资源治理任务仍未完成，工具可观测性后续任务不抢占。

### 2026-09-13 20:25 PDT · 详细交接存档
- 交接主入口：docs/handoff/2026-09-13-runtime-governor-2013/index.html，已由MCP打开在terminal Frame，CUA确认页面内容加载；截图确认画布内渲染，未做整页/移动端视觉验收。
- 包含背景、覆盖矩阵、关键代码契约、失败证据、隔离实例、3类恢复材料及下一轮顺序；9份/tmp原始验证日志已复制到evidence，附tracked.patch、状态、工作树和SHA256清单。不是完整源码备份，untracked内容不在patch内。
- 实际工作树仍voice-regression，分支fix/background-render-budget，HEAD/tag仍2d884c2。最新全量3096通过/3失败/15跳过，根因未确认；专项17/17、types/build通过，实麦未验，整体未完。
- 本轮只写交接文档，无业务改动、无commit/push/发布/恢复。12:51检查点不含晚间新增源码；恢复前必须保全混合脏树，优先新目录，不reset/clean。下一轮先查全量launcher失败，再补录音及全入口覆盖。

### 2026-09-13 20:45 PDT · 接手复查全量 launcher 失败 + 移植会话崩溃修复
- 接手核对：HEAD/tag 仍 2d884c2，交接 file-manifest 229 条指纹 0 漂移、0 缺失。未动 /tmp/eas-history-ui-review 隔离实例（84898）与生产。
- 全量复跑（并发 4，逐行时间戳 + 每秒采样器）：3114 项 3099 通过/0 失败/15 跳过，39.3 秒。最小并发组合（4 真模型文件 + 7 起进程文件）三轮 54/54，launcher config 阶段 0.77–1.47 秒。**未复现** 5 秒等待失败。证据与结论边界见 docs/verification/runtime-governor/acceptance/flaky-launcher-20260913/README.md。
- 可查差异：失败两次全量各 55.6/60.4 秒 vs 本轮 39.3 秒；同组探测测试当时慢 2–3 倍；当时本机另跑「美颜」项目 beauty_server（19:38 起，观测 311% CPU）、两个 Codex 会话、CUA 隔离实例。**不据此断言根因是机器忙**——没有失败那一刻的采样。未改超时/断言/跳过。
- 给 codexCapabilityLauncher.test.mjs 两个等待循环加失败诊断（elapsed、launcher pid/exitCode/signal、stderr 尾、夹具行、loadavg、freemem），1ms 期限临时验证文案会出现；正式 6/6。
- 从根目录移植另一件实拍 bug 的修复：CLI 半路报错退出（Codex "Selected model is at capacity" code=1）后对话面板停不下、发不出——wireProc exit 回调在 busy=true 非自杀退出时先推零用量 turn.done（保住 retries、先 endSilence）再报 fatal；工作树 interrupt 已有无进程分支，不重复改。processHandoff.test.ts 新增 1 条先红后绿（根目录已真机验证：杀掉隔离实例的 codex 后界面解锁、续发成功）；本工作树只跑了单测与 typecheck，未在本工作树构建眼验。架构 10 已补。
- 未做：实麦整链（需用户在场/麦克风授权）、P0/P3 入口清点、共享释放、父子预算。未 commit/push/发版/回退。

### 2026-09-13 21:05 PDT · P0/P3 启动点清点与评审闸门
- 新增 `src/main/runtime/launchCoverage.test.ts`：扫 6 个目录的 spawn/fork/exec 族/Worker/pty.spawn/BrowserWindow，按文件×原语计数与清单比对；36 文件 58 处全部登记。先空清单跑红（列出全部 58 处）→ 填清单跑绿 → 临时加假 spawn 文件验证再红。它是评审触发器不是覆盖证明。
- 覆盖矩阵写入架构 17 末节：managed 6（pty/agent/ACP/LSP/stt 两 Worker/VAD）、bounded-probe 13、window 2、external-app 4、launcher-child 7、dev-hook 2、**gap 4**：mcpClient 插件 MCP 服务器进程启动未准入（只有工具调用准入）、packages.verifyBinary 同步 8s×2 阻塞主线程且未接任务层、cliAuth install 长任务未登记、cliAuth 登录进程未登记。闸门外的非进程消耗（tsSymbols 主进程符号提取、wiki/scan、updater 下载、8 处定时器、webview）已列出未接。
- 全量 3117 项 3102 通过/0 失败/15 跳过（39.4s），typecheck 通过，git diff --check 干净。日志归档 acceptance/flaky-launcher-20260913/eas-handoff-fullrun-2.log。
- P0 门槛仍未通过（4 缺口 + 非进程消耗 + Windows/Linux 未实测）。建议下一步按 packages.verifyBinary 移出阻塞路径 → 插件 MCP 服务器启动准入（复用 HostRegistry 引用）→ install/login 登记 的顺序接。未 commit/push/发版/回退，生产与隔离实例未动。

### 2026-09-13 21:15 PDT · 缺口 2 收口：CLI 更新下载/校验接应用级任务
- `packages.ts`：verifyBinary 异步化（timeout 翻译成中文超时错误），`verifyVersionAsync` 供 stage；同步 `verifyVersion` 只留 boot()/rollback()。测试：假 CLI sleep 5 + 300ms 超时，拒绝期间事件循环 ticks≥5（先红后绿）。
- `sessionStartup.runAppTask`（windowId=null 应用级任务，全窗口可见 scope:'app'、窗口不可取消、窗口关闭不带走）；`cliUpdates/managedStage.ts` 把下载+解包+校验作为一个任务提交（5% CPU/256MiB 估算），排队取消不发起下载，调度器 'wait timeout' 翻译成资源紧张文案。`cliUpdates/index.ts` stage 依赖改走它。运行中心对 scope:'app' 任务不给取消按钮。
- 隔离实例（9470，独立 userData）验收：节能 50%/内存 35GB 时开启 Codex 更新→任务排队（memory-threshold）、无取消按钮、未下载；60s 超时文案第一版误说网络，已修并重建复现。证据 acceptance/cli-update-admission-20260913/。未验普通模式真实放行下载全链与 boot 同步路径的应用行为。
- 全量 3121 项 3106 通过/0 失败/15 跳过（38.5s），typecheck 两套通过，git diff --check 干净。launchCoverage 清单 packages.ts 改 managed。架构 10/17 已记。未 commit/push/发版/回退，生产未动。
- 剩余缺口：mcpClient 插件 MCP 服务器进程启动准入（复用 HostRegistry 引用）、cliAuth install 长任务登记、cliAuth 登录进程登记；非进程消耗（tsSymbols/wiki scan/定时器）未接。

### 2026-09-13 21:50 PDT · 缺口 1 收口：插件 MCP 服务器进程启动准入
- `McpClient.exited`（真实退出/起不来落定）；`pluginHost.acquire` 在 registry 无该插件时先 `startManagedSession`（应用级 windowId null，`startingPlugins` 合并并发，回调里才 `registry.acquire`→spawn，completed=exited，5%CPU/256MiB 估算，wait timeout 翻译成资源文案）。`startManagedSession.windowId` 放开 `number|null`。运行中心范围说明加"插件服务器进程启动"。
- 测试先红后绿：`pluginHostAdmission.test.ts`（AST 抽 acquire 进 VM，真 HostRegistry + 真调度器：排队零 spawn/并发合并/refs=2/复用不准入/预算等 exited/超时文案）、`mcpClientLifecycle` exited 两例。坑：测试采样 totalMemoryBytes 必须真实量级，否则 256MiB 永远排队，表现为进程级挂死（node --test 整个文件无输出）；另 macOS 没有 `timeout` 命令，限时用 `perl -e 'alarm N; exec @ARGV'`。
- 隔离实例验收（9470）：节能下 panelOpen 看板插件→`plugin-start:board` 应用级排队、无进程无服务、面板无取消按钮；60s 超时返回资源文案；切普通再开 ok、`plugin:board:1` running、进程出现。证据 acceptance/plugin-start-admission-20260913/。
- 全量 3124 项 3109 通过/0 失败/15 跳过（42.2s），typecheck 两套通过，git diff --check 干净。架构 10/17 已记。未 commit/push/发版/回退。
- 剩余缺口：bizoneHosted 的 builtin-bizone 连接器（同一 mcpClient spawn，未准入）、cliAuth install 长任务登记、cliAuth 登录进程登记；非进程消耗未接；实麦整链待用户在场。

### 2026-09-13 22:05 PDT · 缺口 3/4 收口：安装/登录进程登记为可停自有服务
- 用户定"给停止单确认"。新 `cliAuth/ownedProcess.ts`：spawn 后登记 ownedSessions（kind cli、归属发起窗口、completed 只认 close/无 pid 的 error），stop=既有 cancelLogin/cancelInstall；id 带代次防重试撞名。IPC 处理器传 `e.sender.id`。`runtime:stopPlugin` 路由加 `cli-login:`/`cli-install:`。shared/ownedSessions kind 加 'cli'。launchCoverage 新状态 registered。
- 测试先红后绿：ownedProcess.test.ts 3 例 + ownedWiring.test.ts 结构守卫。隔离验收（sleep 100 当安装命令）：服务列出 canStop、面板"关闭服务"按钮、停止闭包后随真实退出消失。登录路径未真机验（凭证）。证据 acceptance/cli-setup-owned-20260913/。
- 剩余：launchCoverage 唯一 gap = bizoneHosted 的 builtin-bizone 连接器；非进程消耗（tsSymbols/wiki scan/定时器）未接；实麦整链待用户在场；原生确认框点击未自动化。

### 2026-09-13 22:30 PDT · 笔纵连接器客户端进程准入（闸门 0 gap）
- `bizoneConnector.clientFor` 在 createClient 前经 `deps.admit`（必填）排队，start 回调里才创建，completed=client.exited，wait timeout→资源文案；`BizoneClient.exited` 必填；`bizoneHosted` 默认注入应用级 startManagedSession，测试可注入。新测试 1 例先红后绿，既有夹具补 admit/exited。
- 未真机验（无渲染层入口，只走能力桥）；运行中不作为服务投影。launchCoverage 现 0 gap（mcpClient.ts 改 managed）。
- 全量与 typecheck 见下条。未 commit/push/发版/回退。

### 2026-09-13 22:55 PDT · 符号索引 Worker 化 + 窗口归属准入
- 新 tsSymbolsWorker.ts（?nodeWorker 独立产物）、tsSymbolsHost.ts（唯一工厂）、managedSymbols.ts（runManagedTask：排队不建线程、结果/完成分离、取消 terminate、超时与取消中文）。codeGraph:symbols 改走它，cost max(7,100/核)%/768MiB。launchCoverage 加 `?nodeWorker` 原语并登记。面板范围说明加"代码地图的符号索引"。
- 测试先红后绿 5 例；tsSymbols 20 例不变。隔离验收：排队、窗口可取消、文案 OK；普通模式仍未放行——内存 72% > 70% 恢复线（迟滞），非本改动问题；打包 worker 用 node 独立加载跑通。证据 acceptance/symbols-worker-20260913/。
- 坑：假准入要模仿真 runManagedTask 的中止语义（abort→reject 'cancelled'），否则拒绝来源是线程 exit，测不到取消文案。

### 2026-09-13 23:20 PDT · 知识库扫描 Worker 化 + 共用编排
- 新 runtime/oneShotWorker.ts（一次性 Worker 经 runManagedTask 的共用编排），managedSymbols 改薄包装；wiki/scanWorker.ts + scanHost.ts + managedScan.ts；wiki:graph/wiki:lint 异步、窗口归属。paths.ts 的 walkNotes 等搬到零 electron 的 wiki/walk.ts 并转出口（切分脚本曾把参数默认值的花括号当函数体截断，已修）；Worker 链相对导入补 .ts。
- 测试先红后绿 3 例；隔离验收：排队/取消 OK；同实例节能→普通 60s 不放行（恢复迟滞）；新实例普通模式直接放行回图 3 节点、lint 正常——真实链路跑通。打包 scanWorker 独立跑通。证据 acceptance/wiki-scan-worker-20260913/。

### 2026-09-13 23:45 PDT · 更新包下载接任务准入（可取消）
- 新 updateDownload.ts（零 electron、request 注入、AbortSignal：abort+删 .part）；update:download 经 runManagedTask（窗口归属，3%/64MiB）；面板范围说明加"你点下的更新包下载"。测试先红后绿 3+1 例。
- 隔离验收（假更新源 /tmp/eas-update-server.mjs + EAS_UPDATE_URL）：节能排队/取消无残留；普通模式下载 15MB 后运行中心取消，.part 清掉。证据 acceptance/update-download-20260913/。openPath 收尾未跑。
- 非进程消耗只剩定时器（控制面，方案不排队），留 P5 压测按数据定降频。

### 2026-09-14 00:30 PDT · 策略迟滞刻画 + 运行中心最近结束/项目筛选
- 迟滞是设计：拥塞不随模式切换清除，恢复需连续 10s 低于阈值-10 且采样间隔 ≤5s；policy.test.ts 加刻画测试钉住。
- 新 runtime/recentActivity.ts（有界脱敏记录），runManagedTask 四结局 + ownedSessions 退出落记录；monitor 快照加 recent；面板加「最近结束」与「按项目筛选」（视图过滤，不改权限；下拉复用 .cset-row select 令牌）。测试先红后绿 2 例；隔离验收：取消后记录出现、筛选生效、样式与暗色面板一致。证据 acceptance/runtime-center-recent-filter-20260914/。
- 未接：toolActivity 与 sharedServices 的结束记录。
- 00:45 补：toolActivity 与 sharedServices 的结束也落「最近结束」（先红后绿 2 例）。

### 2026-09-14 00:55 PDT · 共享服务按项目释放（首刀）
- sharedServices.releaseProject 挂 projects:remove；单测先红后绿；未真机验（需真 LSP）。缺运行中心手动"释放本项目"与插件宿主按项目释放。

### 2026-09-14 01:20 PDT · 对话完整归档落地
- seq 稳定序号（shared/historyArchive）+ 主进程按序号并集保存（agentHistoryArchive，v2）+ 读取只回最近 100 条 + 列表 mtime 缓存。渲染层 trimForSave 只是窗口。测试先红后绿 11 例；隔离实例真实 IPC 合并验证通过。已裁掉的旧开头不可恢复；缺"加载更早"翻页 UI。

