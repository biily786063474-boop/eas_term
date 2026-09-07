# AI 对话模块改进计划（基于源码调查）

> 执行者：使用 superpowers:executing-plans 逐项实施。本文是待评审计划；本轮不改业务代码。

**Goal:** 修复 Codex 多轮续聊与模型选择，再完善回复样式、链接和插件状态展示，沿用三家 CLI 的公共协议。

**Architecture:** 保留 adapter → session → 固定 IPC 事件 → reducer → React 的现有分层。扩展 shared/agentChat.ts 的能力与事件，不在 UI 中按 CLI 名字散落分支；本轮不直接切换会话传输到 app-server。

**Tech Stack:** Electron 37、React 18、TypeScript、Zustand、electron-vite、Node 原生 test runner。

**Spec / 需求来源:** 用户的「改进AI对话模块与Codex差距」任务及本任务确认：多轮截断、动态模型、回复 CSS、链接与插件读取展示、通用协议、共享日志。视觉细节需在实现前形成可审阅样例。

## 1. 仓库基线与规范

- 调查基线 main / 62f993f，package.json 版本 0.4.82；未核验已安装应用是否同版本。
- 原有改动：AGENTS.md 已修改，.agents/ 与 .codex/ 未跟踪，保持原状。
- 另有 roles-workflow-p3 worktree，分支 feat/roles-workflow-p3 / e8f31f6；不进入该工作树改动，执行时重新检查主干及共享文件是否变化。
- 最近 main 已合入角色工作流 P1/P2。memory/project_progress.md 保留早期“未完成”段落，后续追加记录已注明合并；不能只读早期状态作判断。
- 改代码前读 docs/architecture/10-模块领地图.md、03-agent角色边界.md；涉及共享协议再读 13-所有权矩阵.md。
- 写文件 IPC 必须保留 guardPath/guardDir；不调换 whenReady 注册顺序；固定事件频道与 preload 加载期监听不变。
- 保留角色约束、resume 所有权检查、工作树绑定、历史存档兼容性。Codex exec 无逐次审批，不显示虚假的审批支持。
- 执行时使用独立 codex/ 分支与隔离工作树；验证只用 npm run verify 的隔离实例，不替换或关闭 /Applications/Eas-Term.app。
- 不运行 npm install、dist 或安装脚本。修改与对应图纸在同一提交中交付；提交只选择本任务文件。

## 2. 已确认事实与证据边界

### 多轮续聊：已复现启动参数错误

src/main/agentChat/adapters/codex.ts 的 buildArgs 在 resumeId 存在时仍把 --sandbox 放在 exec resume 子命令后面。session.ts 的 restartAndDeliver 使用这些参数启动进程；sessionState.ts 在进程退出后保留 resumeId 供下一次发送恢复。

本机 codex-cli 0.147.0，以只显示帮助的命令复现（没有发送模型请求）：

```sh
codex exec resume 00000000-0000-0000-0000-000000000000 --json --sandbox workspace-write --help
```

结果：exit 2，unexpected argument '--sandbox' found。这证实当前生成的恢复参数与本机 CLI 不兼容，能解释第二轮无法启动；尚未在隔离应用重放用户完整交互，不能据此排除事件竞态等其他原因。

### 模型：已有实现，存在待核验的失效路径

- codexModels.ts 已通过 app-server model/list 探测模型；modelCatalog.ts 已有 probe/cache/fallback/none 解析及磁盘缓存。
- session.ts 的 resolveAndBroadcastModels 发 capabilities 事件；toolbarModel.ts 和 ChatToolbar.tsx 已有下拉框，列表为空时隐藏。
- Codex probeModels 忽略传入的 host 参数，默认使用 process.env；真正启动对话的进程使用 PROBE_ENV。Dock 环境下两条路径可能不一致，须用精简 PATH 验证。
- 模型广播受 live.rec.alive 约束；短轮次先退出、探测后返回时可能不更新当前 UI，须做确定性时序测试。
- source/note 目前主要写日志，用户无法从界面区分探测中、失败、无缓存。模型字段仅保留 id/label，推理档位仍为 adapter 固定三档。
- initialize 错误、握手通知、分页及账号切换后的缓存策略需要按本机协议核验，不能仅凭注释认定正确。

### 展示与插件：复用已有设施

- MessageList.tsx 调用 features/editor/markdown 的 renderMarkdown，使用共享 md-view 样式；不能修改全局预览样式导致编辑器回归。
- useLinkify.ts/linkify.ts 已支持裸网址与本地路径、Cmd/Ctrl 点击、同 Frame 浏览器打开；保留文字选取和复制习惯。
- main/plugins.ts、features/plugins/PluginPanel.tsx、appsProtocol.ts、shared/pluginProtocol.ts 已有插件和面板协议，包括握手及工具/画布白名单。
- Codex adapter 已注入选中插件的 MCP server。需要区分“已安装、已启用、已注入本会话、调用成功”；不能把配置存在当作连接正常。
- 尚未采集隔离实例截图、插件端到端事件或 Codex 参考界面，因此不声称已经完成视觉差距审计，也不承诺复制未获取的私有 CSS。

### 基线验证

```sh
node --test src/main/agentChat/codexModels.test.ts src/main/agentChat/modelCatalog.test.ts src/main/agentChat/sessionState.test.ts src/main/agentChat/adapters/adapters.test.ts src/renderer/src/features/agentChat/toolbarModel.test.ts
```

180 项通过，0 失败。这批单测未阻止上述 CLI 参数错误；未运行全量检查和应用眼验。

## 3. 分阶段执行

### P0：恢复多轮会话

文件：src/main/agentChat/adapters/codex.ts、adapters/adapters.test.ts；按复现结果涉及 session.ts、sessionState.ts 及其测试。

- [ ] 重新核对本机 exec/resume 帮助和 buildArgs 输出，给首轮与恢复轮各留一份 argv 证据。
- [ ] 补充 CLI 帮助模式契约测试，要求生成的恢复参数可被本机解析；覆盖只读、workspace-write、角色限制、model/effort 与插件参数。测试不能发真实推理请求。
- [ ] 选择 CLI 支持的沙箱传参位置或配置形式，保留与首轮相同的有效权限；不能简单删沙箱约束让恢复依赖用户全局配置。用真实权限探针验证后再定实现。
- [ ] 补充 turn.done 与进程 exit 之间再次发送的测试，失败时输入不丢失、不把未接受的消息显示为已发送。
- [ ] 隔离实例连续三轮，验证上下文记忆、停止后恢复、下一轮切模型、错误可读，记录脱敏事件顺序。

验收：同一 resumeId 连续三轮成功，恢复不降级角色权限，非零退出明确显示原因。

### P1：动态模型目录可靠性与公共能力字段

文件：codexModels.ts、modelCatalog.ts、session.ts、shared/agentChat.ts、renderer 的 reduce.ts、toolbarModel.ts、ChatToolbar.tsx；对应测试与 preload 类型同步。

- [ ] 用假 stdio server 覆盖握手错误、超时、分页、损坏响应；用精简 PATH 验证探测与实际启动共用可执行文件/环境来源。
- [x] 定义兼容旧事件的可选目录元数据：状态 loading/ready/error，来源 probe/cache/fallback/none，更新时间、可读错误；旧 capabilities.models 继续可消费。
- [ ] 用“会话仍存在且代次匹配”约束异步结果，测试短进程已退出仍可更新目录，以及旧会话结果不得覆盖新会话。
- [x] 增加刷新入口、缓存提示、失败重试。首次失败也保留模型控件状态，不填造模型名称。
- [x] 根据 model/list 实际字段保留每模型推理档位和默认值；区分用户待应用选择与 CLI 确认的实际模型，不由选择值伪造实际状态。
- [ ] 测试账号/CLI 来源改变后刷新，防止永久复用旧进程缓存；缓存键与失效策略写入协议说明。

验收：成功、无缓存失败、缓存降级、短轮次晚返回四种状态均可见；选模型在下一轮生效且不打断当前轮。

### P2：回复排版、链接与过程展示

文件：MessageList.tsx、agentChat.css、useLinkify.ts、linkify.ts；必要时在 agentChat 内新增局部消息组件，避免改共享 Markdown 样式。

- [ ] 读取 design-router 与 open-app-verify 技能，采集隔离应用现状和可访问的参考界面，制作一份含普通回复、长代码、表格、工具结果和错误的样例。
- [ ] 先展示排版方案，再实现限定在 .ac-* 下的字号、段距、宽度、代码复制和工具折叠样式；将 commentary 与最终结果的展示建立在真实事件字段上。
- [ ] 回归中文长段、嵌套列表、长 URL、带空格本地路径、代码内路径、文字选择与 Cmd/Ctrl 点击；保持编辑器预览表现。
- [ ] 在窄于 455px、普通宽度和画布缩放下验证工具栏、表格及代码横向滚动，保留历史加载与自动滚动行为。

验收：完整内容可读、可选、可复制，链接打开位置正确，工具过程不会淹没最终回答。

### P3：插件读取和会话内展示

文件：main/plugins.ts、shared/pluginProtocol.ts、features/plugins/PluginPanel.tsx、appsProtocol.ts、agentChat/MessageList.tsx；按实际事件需求扩展 shared/agentChat.ts 与翻译器。

- [ ] 追踪插件清单 → 用户选择 → MCP 注入 → 工具调用 → 结果/资源 → 面板握手的完整数据链，列明每一状态的真实来源。
- [ ] 定义会话插件信息的只读展示，显示名称、可用状态、当前会话是否启用及错误；不虚构“已连接”。保留原有单插件选择语义，多插件能力另立范围。
- [ ] 优先复用已有 resourceUriOfTool 与面板协议，工具结果按文本、链接、资源入口展示；缺失资源时降级到可读文本。
- [ ] 验证未安装、关闭、工具报错、资源失效、握手失败和正常结果；未知链接协议与面板调用继续受现有白名单约束。

验收：用户能从对话看清本轮用了哪个插件、调用结果及可打开的资源，安装状态与运行状态明确区分。

### P4：公共协议、回归与交接

- [x] 在 docs/architecture 下新增对话协议说明：能力发现、模型目录、会话/轮次标识、内容与工具事件、终态、错误与降级、资源链接和插件状态；字段逐一对应 shared 类型，不另造并行协议。
- [x] 同步 10-模块领地图、03-agent角色边界、13-所有权矩阵中受影响条目。
- [ ] 跑各阶段针对性测试，再运行 npm run check；UI 改动执行 npm run verify 并记录隔离实例证据。Claude/omp 至少验证事件回放不回归。
- [ ] 更新 docs/AGENT_ACTIVITY_LOG.md，记录提交、测试结果、验证限制和剩余工作。实现完成后再更新 memory/project_progress.md。

## 4. 方案取舍与停止条件

推荐按 P0 → P1 → P2 → P3 执行，各阶段独立提交和验收。直接整体迁移 Codex app-server 能扩大原生能力，但会改变会话、审批和事件传输边界，需另做兼容性验证，当前不作为修复前置条件。仅改 CSS 无法解决续聊和模型问题。

当前计划不授权发版、安装、合并其他协作者分支或修改真实用户会话。本轮交付为调查与计划；用户确认后进入实现。

## 2026-09-07 执行记录

用户已批准实施。P0–P3 的核心代码已落在独立分支，P4 图纸与证据已补充；实际验收见 `docs/verification/agent-chat/README.md`。上方未勾选的组合项中仍包含未执行的真实服务/时序验收，不将单测或事件回放算作这些端到端验证。实现当前集中在一个审查提交中，避免公共协议字段与消费者分离。
