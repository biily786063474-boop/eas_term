# Chat UI 原型接入

用户已批准进入代码，Figma 边缘/间距以真实应用舒适观感校正。工作树 /private/tmp/eas-agent-chat-codex，禁止安装依赖、改原目录或发布。规格为 startup-install-audit 和 icon-worktree-prototype。

## Task 1: 安装和切换
复用安装、登录、服务商设置后端；选择未安装项也更新当前选择；切换清理旧提示和认证归属，完成后重查清单及认证；未知、内置缺失、无方案、仅终端分别表达；草稿不丢，不自动发送。针对快速切换和晚响应写状态测试与隔离 Electron 流程。

## Task 2: 语义图标和 Worktree
按 docs/design/eas-icon-prototype.json 实现共享语义 SVG，深浅主题色；FileTree（侧栏/抽屉共用）、BranchBadge、位置、worktree 菜单 leadingIcon、执行类型及压缩均接入。执行分类来自 adapter 真实事件，不猜自然语言；贯通 optional type 和历史。保留所有旧回调/权限。

## Task 3: 提问导航
复用 MessageList 的真实 user turns 和消息滚动容器，刻度/悬停摘要/点击定位/当前高亮；可以悬浮 Frame 外侧，边缘不足内收，分屏和缩放位置正确，减弱动画支持；不改吸顶零 padding，也不 memo mutable turns。

## Task 4: 整体验证
类型检查、针对性回归、隔离 Electron 启动状态/导航/图标/640px/分屏/旧功能入口，检查实际截图和控制台。更新图纸和验证记录，打开真实开发实例；真实远端、录音及安装操作的未覆盖边界明确标注。

## Ledger
Task 1: implemented; Electron 安装/登录/失败重试/切换/草稿验证通过
Task 2: implemented; 图标任务交付，root 完成聊天集成；181 项定向测试通过
Task 3: implemented; 最大化/还原/缩放/点击/预览已验证，用户追加抽屉层级约束已接入
Task 4: passed; integration 14、default 16、compat Codex/Claude/omp、width、startup 全部 exit 0；181 单测、类型、CSS、恢复构建通过。真实安装/录音/远端/Worktree 变更边界见验证 README。

| 交界 | 决定 |
|---|---|
| 1/2 AgentChatView | root 集成位置图标，图标任务仅交付接口 |
| 2/3 MessageList | root 集成 ExecRow 图标；图标任务修改 shared/translators/reducer |
| 1/3 agentChat.css | root 维护，新增图标独立 CSS |
| 各任务测试 | node 单测可独立跑，Electron 构建/临时 preload 串行由 root 跑 |

Ruling: 不提交现有混合改动，不删除用户或此前任务文件；本轮以工作区差异审查及实际验证交付。

审查修复：重复选择 CLI 不绕过登录；空清单重查选择可用项；分屏裁剪与隐藏；去除空闲轮询，FLIP 动画有界跟随（含极小首次帧）。截图修复：最大化刻度遮挡、跳转避开吸顶条、预览实色背景、导航不盖抽屉。用户最新要求：普通导航 40 < 抽屉 45，最大化时才随 pane 提升。
