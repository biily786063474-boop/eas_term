# 工具、文件与工作区图标：原型及代码接入图

状态：用户已审查并批准进入代码。22 类自有双色 SVG 已接入共享 FileTree、BranchBadge、位置、工具执行、压缩记录与 Worktree 菜单；深浅色复用主题 token。下文原型与接入建议保留设计过程，实施和验证记录见 docs/verification/agent-chat/README.md。

## 图标语言

沿用已审查的深浅色布局，新增自有折角轮廓与双色细节。24px 矢量网格，主要显示尺寸 16/18/20px；图形以 1.65px 线条构造，缩小后检查辨识度。蓝色用于读取与代码，青色用于终端和工作区，紫色用于集成、分支与压缩，琥珀色用于编辑、目录与提示。亮色用对应深色值，不直接把浅色图标搬到白底。

执行类型图标和执行状态分开：类型不因失败变成另一种图标；成功、运行、失败仍保留文字和状态标识，不能仅靠颜色。未知类型使用通用图标。集成品牌仅在可靠的插件身份与可信本地资源存在时使用，否则显示通用集成图标，不根据模型输出猜品牌或下载远端图标。

已创建 18 类深浅色可复用矢量组件（共 36 个）：终端、搜索、读取、编辑、集成、压缩、目录、worktree、分支、合并、重叠提醒、普通文件、TypeScript、Markdown、JSON、Git、图片、Agent 规则。刷新、语音、发送继续复用上一轮已审查的图标组件。

与 Figma 使用一致的矢量定义和色板保存在 `docs/design/eas-icon-prototype.json`，供审查后精确转换为共享 SVG 组件。

外部方案已核对：[Lucide](https://lucide.dev/) 为 ISC，[Catppuccin 文件图标](https://github.com/catppuccin/vscode-icons) 为 MIT。当前原型图形为自绘，未复制上述资源、未添加依赖；若实施时选用外部 SVG，须保留对应许可并以原型轮廓和色彩统一处理。

## Figma 画板

文件：https://www.figma.com/design/xgXySVpD0pfr0eBw2738Zq

| 画板 | 节点 | 内容 |
|---|---|---|
| 26 · 彩色图标 / 规范 | 7:829 | 18 类图标的深浅色组件 |
| 27 · 工具执行与文件类型图标 | 7:1143 | 文件树及搜索、读取、终端、集成、修改、压缩、错误记录 |
| 28 · Worktree / 已隔离 | 7:1316 | 位置徽标、真实目录与分支 |
| 29 · Worktree / 操作菜单 | 7:1368 | 打开终端、合并入口、使用中禁止删除 |
| 30 · Worktree / 文件重叠提醒 | 7:1425 | 重叠提示，明确不等于 Git 合并冲突 |
| 31 · 启动位置 / 待创建 Worktree | 7:1464 | 本地位置与角色要求的待创建状态 |
| 32 · Worktree / 亮色窄面板 | 7:1511 | 480px 宽下路径与徽标布局 |

工作区徽标连接“已隔离 → 菜单 → 已隔离”。操作菜单只演示已有操作的视觉，不执行真实终端、合并或删除。

已在 Figma 目视检查执行行、文件图标和已隔离工作区详情。其余场景已创建；菜单连线已设置，尚未完成点击验收。原型采用示例目录和分支，不代表用户实际创建了该 worktree。

## 真实代码接入位置

| 原型内容 | 现有接入点 | 实施约束 |
|---|---|---|
| 共享双色矢量 | `src/renderer/src/ui/Icons.tsx`（建议独立 `SemanticIcons.tsx`）及 `styles/base.css` | 沿用 SVG props；新增深浅色语义 token，不更换所有现有动作图标 |
| 执行行类型图标 | `features/agentChat/MessageList.tsx` 的 `ExecRow` | 目前仅状态圆点；类型图标和 `item.state` 分开，详情、资源、失败可见性不变 |
| 类型来源 | `src/shared/agentChat.ts` 的 exec 事件、`src/main/agentChat/{codex,claude,omp}Events.ts` | 新增可选公共动作类型，在翻译器按真实事件分类；不在前端按 CLI 名称或自然语言标签猜类型 |
| 历史兼容 | `features/agentChat/reduce.ts` 的 `ExecItem`、`history.ts` | 可选字段贯通 reducer 和历史，旧数据缺失时通用降级 |
| 上下文压缩图标 | `MessageList.tsx` 的 `CompactDivider` | 当前只有压缩结果分隔；没有真实开始事件时不能凭图标伪造“正在压缩” |
| 文件树类型 | `features/files/FileTree.tsx` 的文件行、创建行和目录行 | 当前复用 FileIcon/FolderIcon；新增纯文件名/扩展名映射，未知格式通用降级，复用现有条目点击和重命名 |
| 位置与 worktree 徽标 | `features/agentChat/BranchBadge.tsx`；`AgentChatView.tsx` 的 `effectiveCwd` 与启动上下文；`ChatToolbar.tsx` | 本地目录、待创建和已创建分别表达；真实路径来自 `cwd + relPath`，真实分支来自 pane.worktree |
| worktree 操作菜单 | `AgentChatView.tsx` 的 `branchMenuItems`；`ui/CanvasContextMenu.tsx` | 现有 icon 字段在右侧且与 hint 二选一；左侧图标应新增可选 leadingIcon，不能覆盖提示。保留活跃会话禁删、确认和脏工作区保护 |
| 重叠提醒 | `BranchBadge` 的 `overlap` 与已有协同板查询 | 表达“其他分支改同一文件”，不能伪称 Git 冲突；不新增自动合并行为 |

上述 renderer 路径均相对于 `src/renderer/src/`。代码位于当前隔离工作树 `/private/tmp/eas-agent-chat-codex`。

## 审查后实施顺序

1. 固定图标语义和主题 token，导出原型 SVG；保持已有刷新、语音、发送、停止组件。
2. 文件类型与位置徽标先接现有数据，保持 worktree 生命周期不变。
3. 三个翻译器增加可选公共动作类型，贯通历史，执行行按类型渲染；对未知与旧记录使用通用图标。
4. 验证深浅色、窄 Frame、长路径、执行失败、缺失类型、worktree 创建前后与活跃会话禁删。复用隔离 Electron 测试，更新架构图纸。

## 左侧抽屉与分屏补充

用户追加要求：左侧抽屉内的文件也要使用新图标，分屏模式中的 worktree 同步设计。新增原型 33「左侧抽屉 / 文件类型图标」、34「分屏 / 每个面板的工作位置」，以及 JavaScript、配置文件、矢量图片、展开目录四类补充图标。

Figma 节点：左侧抽屉 `11:1726`，分屏位置 `11:1910`，文件类型补充 `11:1694`。补充矢量定义已保存到 `docs/design/eas-icon-prototype.json` 的 supplementalGlyphs，当前补充画板为深色。

- `features/canvas/CanvasDrawer.tsx:611` 和 `features/workspace/Sidebar.tsx:74` 都使用共享 `FileTree`。文件行、创建行、目录开合应共用类型映射，不能仅改聊天里的文件示例。
- 抽屉示例覆盖截图中的 `afterPack.js`、PNG、SVG、ICNS、plist 和展开后的 build 目录。SVG 使用矢量图标，PNG/ICNS 使用图片图标，plist 使用配置图标；未知格式保留通用文件图标。
- `features/workspace/PaneView.tsx:531` 渲染同一个 `AgentChatView`；分屏中的 worktree 徽标继续从该 leaf 的 pane.worktree、effectiveCwd 读取，复用 `BranchBadge`，不能取全局选中 Frame 的工作区。
- 左侧项目文件树的根目录不因另一面板的 worktree 徽标而暗中切换。原型明确显示侧栏根目录及每个面板各自的位置。
- `SidebarGit.tsx` 的 worktree 分组表示未暂存工作区改动，不等同于独立 Git worktree，不应仅因这个字符串替换成隔离工作区图标。
- 验收增加：画布抽屉、分屏侧栏、目录展开/折叠、选择/重命名、不同面板本地/隔离目录同时存在及切换焦点后归属不串。

后续用户批准实施，左侧抽屉与分屏侧栏已通过共享 FileTree 同步图标；各面板 Worktree 徽标来自各自 pane.worktree。
