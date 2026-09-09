# 浏览器收藏体系 + 词典蓝图悬停修复 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans，单会话逐项执行；不自动启用子代理。Steps use checkbox syntax.

**Goal:** 将已确认浏览器视觉稿接入真实收藏/导航/本机会话，同时修复蓝图词条hover预览不关闭。
**Architecture:** 浏览器UI拆为目录、收藏面板、海报卡与OGL画廊；主进程负责受保护的持久化/当前guest截图，preload仅暴露窄接口。沿用persist:browser。词典独立最小修复，独立回归后合并验收。
**Tech Stack:** Electron、React18、TypeScript、OGL、现有测试与打包验证脚本。
**Spec:** docs/superpowers/specs/2026-09-08-browser-favorites-and-dict.md

## 全局约束与范围
- 先读AGENTS、memory、架构03/10/13；执行时建立隔离worktree，保留主目录已有脏改动。
- 不改whenReady注册顺序，不绕过guardPath/guardDir，不弱化沙箱。
- 只新增必需ogl依赖，正式构建不用原型中的绝对路径或手工内联bundle。
- 不包含私测日志上传、不宣称原始Windows闪退/Computer Use残留修复。
- 本计划不自动commit其他人的文件、不自动部署；发版另按最终授权和发布验收执行。

## 多维评审结论
- 完整性：从当前网页收藏到自定义目录、重启恢复、实际打开，必须闭环；原型不能当成产品完成。
- 体验：保留贴纸/海报/圆弧视觉，但导航精确性由列表和明确按钮保证；悬停预览不做黏住式弹窗。
- 性能/成本：本地缓存缩略图，不新增付费API；真实页面预览不发第三方；离屏不持续渲染。
- 风险：WebGL、Cookie共享与截图隐私分别测试，不能用“能显示”替代验收。

## Task 1：蓝图hover独立修复
Files: 修改 src/renderer/src/features/dict/BlueprintPanel.tsx，必要时 DictView.tsx；新增脚本 scripts/verify-dict-blueprint-hover.mjs 与回归测试（跟随现有测试约定）。
- [ ] 真实应用打开词典→蓝图→展开区块→悬停词条→移到同一面板空白，录下失败。
- [ ] 全局检查相关hover来源、Portal、鼠标离开、点击、滚动/卸载清理，确认是否有重复或冲突旧逻辑。
- [ ] 写失败回归：离开词条但未离开bp-view应关闭；相邻词条切换不残留。
- [ ] 添加最小局部leave与必要的状态清理；不添加会覆盖新hover的遗留计时器。
- [ ] 回归折叠区块、切换蓝图/Tab、关闭词典、滚动、Esc与点击选词；确认视频不继续后台播放。
- [ ] 在用户所述位置亲眼验收截图，更新架构图纸，独立提交。

## Task 2：收藏数据与窄IPC
Proposed new files: src/shared/browserFavorites.ts、src/main/browserFavorites.ts及对应测试。
Modify: src/preload/index.ts及实际API声明位置、src/main/index.ts（只接现有注册点，不重排）。
- [ ] 定义versioned schema：稳定folderId/siteId、目录顺序/贴纸/预置标识、网址/标题/简介、preview本地引用。
- [ ] 写红测试：首次默认目录、旧数据迁移、重名目录、非法网址、重复收藏策略、损坏数据不覆盖原件。
- [ ] 实现读写、原子保存/迁移；复用已有app数据目录与写路径白名单，所有调用校验sender与载荷。
- [ ] 升级只补缺失预置项，不重置用户重命名/排序/自定义；并发浏览器节点状态同步。
- [ ] 跑定向测试与typecheck，更新架构13跨文件清单，独立提交。

## Task 3：真实浏览器收藏与一级目录
Modify: src/renderer/src/features/web/WebView.tsx、web.css。
Proposed new: FavoritesHome.tsx、BookmarkDialog.tsx、FolderCard.tsx、favorites.css（同目录）。
- [ ] 红测试：☆读取当前guest标题/URL，而非原型React Bits常量。
- [ ] 实现选择文件夹→新建命名选贴纸→自动选中→保存→成功提示→进入目录。
- [ ] 实现自定义点击进入、右键编辑；取消不保存，空状态能收藏，表单错误就地提示；键盘焦点/Esc可用。
- [ ] 一级贴纸文件夹沿用已定稿效果，清理原型迭代冲突CSS；禁止3D+背景模糊旧bug组合。
- [ ] 内部目录导航与外部网页导航明确区分，返回/前进/刷新/新窗口不破坏收藏状态。
- [ ] 重启后自定义目录/贴纸/网站仍在；多浏览器节点同步验证。

## Task 4：真实预览与海报卡片
Proposed new: src/main/browserPreview.ts及测试；renderer/features/web/SiteCard.tsx。
- [ ] 先测授权guest归属、截图关闭选项、过期guest/加载失败/大页面/缓存失败。
- [ ] 本机capturePage取用户当前页面，限制缩略图尺寸与缓存预算；不将用户URL交给外部截图服务。
- [ ] 收藏面板明确截图隐私提示；关闭预览时不截图，失败仍能收藏并显示占位。
- [ ] 网站卡保持上图下文与域名，不把示意图标当真实截图；内置公共预览可独立核验补齐。
- [ ] 删除/替换预览清理孤立缓存；不得扫描或清理任意用户文件。
- [ ] 实际公开网站与本地fixture验证；私人网站无需替用户登录。

## Task 5：二级OGL圆弧画廊
Proposed new: renderer/features/web/SiteGallery.tsx、siteGallery.ts及测试。
Modify: package.json/package-lock.json，保持React18兼容。
- [ ] 先写挂载/卸载、模式切换、空/1/2/大量项、WebGL失效回退测试。
- [ ] 将原型适配为生产模块，正规import ogl；检查许可证并保留声明。
- [ ] 弧形排布、两侧倾斜、无限横滚、仅画廊范围内滚轮/指针监听；拖拽阈值防误开。
- [ ] 保留精确打开按钮、列表模式、键盘操作；少图重复仅视觉副本，不重复数据。
- [ ] 纹理按可见窗口复用、DPR上限1.5、尺寸上限/缓存预算；切目录销毁，离屏/后台暂停。
- [ ] reduced-motion默认列表；上下文丢失后无泄漏回退；连续切换20次检查资源释放。
- [ ] 实测滚轮/拖拽前后截图不同、无限循环不卡边，非画廊滚轮仍滚页面。

## Task 6：登录状态保留（先验后改）
Existing: WebView.tsx:180 已使用 persist:browser；核对主进程会话与新窗口处理。
- [ ] 用本地Cookie fixture记录：刷新/关节点重开/离屏回收/完整退出重启后状态。
- [ ] 只有失败才修改现有会话链路；不得更换partition导致用户现有登录失效。
- [ ] 多节点共享、主应用隔离、新窗口继承验证；不把登录数据拷入收藏文件。
- [ ] 若保留设置开关，说明作用时机；关闭不能静默清空已有数据，清站点数据独立确认。
- [ ] 明确网站自身会话到期/风控可能要求重新登录。

## Task 7：联合验收与交付
- [ ] 定向测试→完整npm run check→构建；失败原样报告，不能删测试绕过。
- [ ] 用open-app-verify构建并打开真实应用，验证一级目录→收藏→自定义→二级画廊→真实网站→重启恢复。
- [ ] 同位置验证蓝图hover离开关闭；暗/亮、窄节点、最大化、画布缩放、窗口失焦都覆盖。
- [ ] Mac/Windows打包验收；Windows构建跟踪Actions到结束，未验证平台明确列出。
- [ ] 更新docs/architecture/10、03相关历史修复区、13与memory/活动日志。
- [ ] 交付验证记录及尚未完成项；获得发布指令后才纳入下一版，不修改既有0.4.87安装包。

## 待核对而不阻塞基础实现
Motion Sites准确URL；真实公共缩略图来源与许可；预览缓存容量根据实测定数。上述未定事项用明确占位，不猜测。

## 追加 Task 5A：二级卡片放大与可读性（2026-09-08 23:00）
- [ ] 测量现稿在普通模块/最大化中的中心卡片实际CSS像素，截图建立基线。
- [ ] 调整OGL相机/卡片比例/间距，按容器尺寸决定可见数量，不仅放大canvas高度。桌面中心宽300–360 CSS px作为首轮目标，两侧保留部分卡片。
- [ ] 上方预览仍占主体，下方标题/简介/域名在常规视距可读；同步列表卡片尺寸，避免文字纹理放大模糊。
- [ ] 验证窄模块、最大化、缩回、画布缩放与DPR1/2；无裁掉中心卡/按钮、无横向页面溢出。
- [ ] 放大导致的纹理开销纳入Task5预算，与下方性能修复联合复测。

## 追加 Task 6A：Frame内模块从全屏收回卡顿（发布前必验）
Initial investigation: src/renderer/src/features/canvas/CanvasStage.tsx、实际最大化宿主/状态action/CSS所在文件（执行时全局搜索liveMaximizedNode/maximizedNode/hidden-by-max）；WebView.tsx及新增SiteGallery只作为关联模块，不提前认定根因。
- [ ] 在真实应用同一Frame复现全屏→收回；先区分应用原生全屏与模块最大化，按用户实际操作走，不混成一个状态。
- [ ] 对照空Frame/多模块Frame，浏览器静态页/OGL画廊/词典/AI/终端，记录哪些类型受影响。
- [ ] 采集前后Performance trace、长任务/布局绘制、React提交、WebGL分配、webview resize与zoom调用；连续收回10次，记录耗时和丢帧基线。
- [ ] 全局检查重复或冲突恢复逻辑：隐藏画布一次性显现、全树订阅、webview重建、尺寸observer反馈循环、动画布局属性、GPU上下文重建。先给有证据的根因再写修复。
- [ ] 写能复现根因的失败测试/性能脚本，再做最小修复；禁止恢复CanvasStage对canvas.shapes的整体订阅，禁止为了顺滑销毁活会话或丢失网页/终端状态。
- [ ] 避免每帧重新创建纹理/重排整个Frame；若需延后非关键恢复，不隐藏交互错误或吞掉状态更新。
- [ ] 同设备同场景前后对比：记录p50/p95收回耗时、>50ms长任务与>100ms停顿；目标动画内无新增>100ms主线程停顿，60Hz环境尽量贴近16.7ms帧预算，达不到明确报告。
- [ ] 连续20次展开/收回后检查CPU/GPU/内存无持续增长、滚动/焦点/会话不丢，多个模块并行状态正常。
- [ ] 实际构建应用肉眼验收并保存trace和录像/截图；Mac/Windows分别记录，未验平台不得标已修复。

Task7联合验收同时包含5A/6A；不只交付新视觉而遗漏既有卡顿。

## 2026-09-08 23:16 范围覆盖（优先于Task5/5A）
- [ ] 取消扇形、圆弧、倾斜及OGL方案，不安装ogl；用DOM/CSS水平单排大卡。
- [ ] 卡片直立，上方网页预览、下方标题/简介/域名；横向滚动，首轮宽300–360 CSS px并适配窄模块。
- [ ] 默认不自动移动；若支持拖拽，跨阈值后不触发链接，键盘和明确打开入口保留。
- [ ] 原型移除圆弧运行时与内联OGL bundle；不要把作废原型误接进正式软件。
- [ ] 其余收藏闭环、真实预览、登录保持、蓝图hover、全屏收回性能任务不变。

## Task 0（已授权开始）：agent可发现路由
- [ ] 建立src/shared/browserRoutes.json单一内置路由源，稳定id/分类/意图/官方入口/待确认状态。
- [ ] 回归发布小红书/哔哩哔哩入口、非法URL、重复id、待确认不得导航。
- [ ] 同源生成docs/browser/index.html与routes.json，让agent直接读取/打开；HTML对外链显式点击，不自动执行发布。
- [ ] 在agent可发现说明中登记路由表位置和使用规则，不批量改用户全局指令；正式安装包路径经MCP可发现（后续接线测试）。
- [ ] 本地HTML可按分类/收藏表单路由打开，所有外部输入校验，未实现持久化不得宣称可恢复。
