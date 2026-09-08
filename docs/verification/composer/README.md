# Review 02 输入框实现与回归

已实现启动/对话两处输入框共享的 @ 八分类、辞典预载与引用、词条全文预览、发送内容预览、通用与 adapter 声明的斜杠命令。适用于 Codex、Claude、omp。

## 验证结果

- `npm run check`：2535 项，2534 通过、0 失败、1 跳过；包含 TypeScript、hooks、主题对比度、CSS、动画和全量测试。
- `node scripts/verify-agent-chat-ui.mjs --composer`：120 项通过，覆盖三端 × 启动/对话、浅深主题、640px、实际键盘鼠标、IME、选项滚动、光标后缀保留、发送失败恢复、成功清理、来源失败与重试。
- `node scripts/verify-agent-chat-ui.mjs --composer --faults-only`：26 项通过，含按住重试等待另一来源完成的竞态，以及自建辞典身份和英文回退。
- 原有 `--compat`、`--integration` 和默认对话 UI 回归通过；对应原始结果见本目录 JSON。默认回归包括审批 IPC、消息、通知与布局。
- 生产构建通过；隔离夹具已还原，生产 preload 无测试入口。

界面验证使用真实 Electron/React 与内置辞典数据；CLI 启动/发送和来源故障由隔离夹具模拟。没有实际模型推理或外部插件连接测试。独立代码审阅发现的自建辞典身份冲突、启动页原生命令遗漏均已修复。

新增回归覆盖选词后快速发送的焦点竞态、来源错误到达时重试按钮移位、Esc 关闭候选同时退出画布最大化的问题。发送预览使用独立浮层，避免撑高底部操作区。

## 边界

- 候选读取复用既有只读 API；不增加 IPC、不新增网络请求、不修改会话传输、审批、启动注册顺序、fsGuard 或持久化格式。
- 跨进程仅新增可选 `CliCapabilities.nativeSlash`；当前仅 Claude 声明已有 headless 命令。model/effort/mention/compact 使用现有本地控件，技能以 SKILL.md 路径引用。
- 插件/应用仅本会话已绑定项可引用；选择名称不建立连接。网页候选限 Eas-Term 已有 HTTP(S) 页面节点，不包含外部浏览器标签，不隐式读取正文。
- 项目文件扫描沿用 20,000 条目、8 层和目录排除预算；最多渲染 200 个候选，继续输入可筛选。
- 辞典保持既有语义：正文显式引用时原位展开；没有显式引用时附带全部备选。预览显示实际展开文本。
- CanvasStage 仅对展开候选的输入框让出捕获阶段 Esc；第二次 Esc 仍正常退出最大化。
- 实现对照获批 Review 02 稿件；未宣称已经核对 Codex @ 的全部原生行为。

## 截图与原始结果

[交互报告](index.html) · [三端检查](results.json) · [故障专项](faults-results.json) · [既有兼容](compatibility.json) · [既有集成](integration.json) · [既有对话](interaction.json)

[Codex 启动 · 浅色](codex-startup-light.png) · [Claude 对话 · 深色](claude-active-dark.png) · [omp 对话 · 深色](omp-active-dark.png)

补充生产构建实测：从主目录启动隔离实例，确认 `__composerTestSetup` 不存在；真实 @防抖 搜索返回辞典候选，无加载错误。见 [生产构建截图](production.png)。未发送消息。
