# AI 对话验证记录

## 分屏高亮层级（2026-09-07）

App 增加 split-mode 作用域，项目选中、标签页选中、面板标题的背景强调按 17%/8%/3% 递减，面板类型改为透明底，焦点面板通过文字与细边框标识，不再套用画板浮窗的高亮光晕。

`--width` 验证通过：明暗两套选中背景逐级递减、类型按钮无反色/渐变、面板无浮窗阴影、真实点击右面板后 activeLeafId 唯一且正确；切回画板后 split 作用域消失，原类型按钮恢复。原有 640px 最小宽度、真实缩小拖动、分屏不重叠、横向滚动、Pane 不重挂检查通过。类型检查、CSS 平衡、diff 检查通过，preload 恢复后构建完成。

证据：[深色](split-hierarchy-dark.png)、[浅色](split-hierarchy-light.png)、[层级测量](split-hierarchy.json)、[验证日志](split-hierarchy.log)。


## 警告与错误样式（2026-09-07）

聊天通知、启动错误及工具失败行取消红/黄透明铺底，统一中性背景和正文；三角警告、圆形错误图标以及细侧线标记级别。默认隔离交互验证通过，新增明暗主题检查确认通知背景/正文为中性色、图标与侧线使用相同级别色、警告与错误可区分；原有关闭、去重计数、限高及审批交互通过。类型检查、CSS 平衡、diff 检查通过，测试 preload 已还原并重新构建。

截图：[深色通知](alerts-dark.png)、[浅色通知](alerts-light.png)；日志：[交互及视觉检查](alerts-ui.log)。使用模拟错误事件，没有触发真实安装失败或远端推理。


## 启动沙箱与工具调用区（2026-09-07）

- Codex 启动页新增三档沙箱选择，默认工作区可写；只读角色锁定，切 CLI 隐藏并在切回时保留选择。`--startup` 验证首发和模拟 resume 失败重试均带所选 read-only，发送前不启动会话。640px 明暗截图已复查并校正权限行 18px 左右、16px 底部留白。
- 工具区默认最近 3 条加失败项；展开全部仅展开列表，单条详情独立展开。长输出限高为所属消息视口约三分之一（96–320px），内部滚动，展开标题吸顶，收起列表在滚动区外。
- 默认隔离交互检查全部通过，新增断言检查列表展开不批量打开输出、单条独立收放、80 行长输出实际滚轮、正文 scrollTop 不变，以及吸顶标题可命中。消息/审批 allow 与 deny、失败项/资源相关旧检查保持通过。
- 三 CLI 的 `--compat` 公共事件回放与 640px 明暗控件检查通过。
- 沙箱/启动参数/adapter/sessionState 定向测试 145 项通过，消息 reducer/history 88 项通过；类型检查、CSS 平衡、diff 检查通过。

截图：[沙箱启动页](startup-narrow-dark.png)、[工具区域深色](tool-region-dark.png)、[工具区域浅色](tool-region-light.png)。启动事件与工具输出是隔离测试回放，未执行真实远端推理或扩大真实会话权限。具体条数与尺寸为本项目的实现规则，没有宣称已精确测量 Codex 客户端。


## 原型进代码后的验证（2026-09-07，当前）

用户已批准安装引导、提问导航、双色图标和分屏 Worktree 进入代码；间距以真实窗口校正。新增功能已经接入，下面旧记录中“仅原型/未实施”的描述属于此前阶段。

- `--integration`：14 项检查通过。覆盖未安装选择归属、切已安装清旧提示、同 CLI 重选仍需认证、晚响应隔离、安装失败重试→登录→重查、草稿保留且不自动发送、内置缺失不执行外部安装。
- 导航在真实消息上点击定位、悬停预览、当前高亮；最大化可命中，还原及 80% 缩放后跟随 Frame。普通导航层级 40 低于抽屉 45，抽屉覆盖的位置让位；截图已复查。跳转保留 48px 设计留白以避开原有吸顶条，消息区 padding-top 仍为 0。
- 文件树从隔离注册项目读取 JS、PNG、SVG、plist、AGENTS.md；抽屉与分屏侧栏共享图标。两面板分别显示自身 Worktree 路径，切分屏前后聊天 pane DOM 相同。
- `--compat`：Codex / Claude / omp 公共事件回放及 640px 深浅色控件检查通过。`--width`：旧节点恢复、缩小下限、操作同排、分屏各 640px/横向滚动/不重挂通过。
- 默认交互脚本：16 项通过，包含消息、Markdown、工具展开/失败常驻、审批 allow/deny 实际 IPC 参数、错误去重/关闭及 CLI 能力差异；控制台无异常。
- `--startup`：真实首轮前模型目录读取通过，发送前 start=0，首轮与模拟恢复失败重试参数一致。
- 定向 Node 测试 181/181、类型检查、CSS 平衡和 git diff --check 通过。测试 preload 均在 finally 恢复，相对 HEAD 无差异；恢复源码后的构建通过。

证据：[集成断言](integration.json)、[集成日志](integration-latest.log)、[旧交互日志](interaction-latest.log)、[兼容性](compatibility.json)、[宽度](minimum-width.json)。截图：integration-missing.png、integration-navigation-dark/light.png、integration-navigation-canvas.png、integration-drawer-icons.png、integration-split-worktrees.png。

边界：安装/登录/start/消息事件使用可还原测试 transport，没有真实安装软件或调用远端推理；Worktree 使用隔离样例状态，未执行创建/合并/删除。真实录音转写、外部插件认证与操作未验证。未重跑全量测试；下方既有证书和动画扫描问题仍未修复。不能据此声称所有外部聊天功能已完成端到端验收。

## 最小宽度补充与接入审查（2026-09-07）

用户要求主操作不换行，当前 AI pane 下限改为 640px，取代下方历史 340px/480px 的换行方案。`--width` 隔离 Electron 检查通过：280px 旧节点修正为 640px、缩小不低于下限、主控件同排且在界内、两 AI 分屏各 640px、空间不足可横向滚动、无重叠且切换前后 pane DOM 相同。深浅色画布及分屏截图见 minimum-*.png，数据见 [minimum-width.json](minimum-width.json)。

`--compat` 已按 640px 重跑通过；类型检查通过；paneSizing、canvas undo、viewMode restore、frame size、tidy grid 共 35 项回归通过。preload 恢复后构建通过。此后未重跑全量测试，既有证书与动画失败不能视为修复。

**用户报告旧功能失效后的审查：** 确认 CLI 切换不清理旧 cliNote；安装完成后列表刷新存在待动态验证风险。侧边提问导航、多色图标仍仅为原型。安装状态原型新增 Figma 35–50，尚未实施；引用旧组件不等于完成真实业务验收。详见 [接入审查](../../superpowers/specs/2026-09-07-startup-install-audit.md)。

## 历史测试（2026-09-07，首次端到端验证）

**结论：已实现 UI 的隔离交互和兼容性测试通过；完整远端端到端尚未覆盖，全量回归未通过。** 本节与下方记录保留为历史；当前实施以顶部记录为准。

| 检查 | 最新结果 | 真实边界 |
|---|---|---|
| 首轮模型 `--startup` | 通过 | 真实 model/list；发送前 start=0；模型/强度选择和恢复失败重试参数一致；会话 start 用测试替身 |
| 默认 UI 交互脚本 | 16 项通过 | 隔离 Electron，真实鼠标/键盘、组件、归约器及审批 IPC；启动/事件是模拟数据 |
| 三 CLI `--compat` | Codex / Claude / omp 通过 | 公共事件回放、目录加载/失败、模型项、Markdown、工具成功/失败、资源入口；340px 深浅色控件无越界/重叠 |
| Codex 三轮恢复 | 通过 | 实际 Codex CLI 与 adapter，对接本地模拟 Responses 服务；同一会话，输入数 3/5/7，保留首轮内容，三轮 read-only |
| 类型检查、构建、CSS 括号 | 通过 | 临时 preload 恢复后重新构建通过，preload 相对 HEAD 无差异 |
| 全量 `npm test` | **2453 通过 / 1 失败 / 1 跳过** | 2455 项；手机配对证书生成遇到 ERR_OSSL_ASN1_ILLEGAL_PADDING |
| 动画扫描 | **失败** | 未改动的 canvas.css / cframe-sweep / --sweep infinite，原有问题仍在 |

本轮更新了旧脚本的引导语、CLI 下拉菜单、图标发送按钮和沙箱提示选择器；按当前产品约定检查旧审批 chip/卸载入口已移除（入口位于设置）。鼠标点击前等待控件坐标稳定并检查命中，避免异步加载时点错位置。保留首次菜单超时诊断，最后完整重跑 exit 0；没有把失败断言改成跳过。16 项由原 11 项加错误去重、错误区域滚动、错误关闭、Codex 沙箱提示、两种 CLI 工具栏差异构成。

**证书失败已固定输入复现，尚未修复。** 随机序列号首字节 00 失败，01/80 成功；identity.ts 与 HEAD 一致。见 [复现方法](certificate-reproduction.md) 和 [全量失败日志](unit-failure.log)。没有通过重复运行碰运气来覆盖此失败。

证据：[UI 交互断言](interaction.json)、[交互日志](interaction.log)、[跨 CLI 结果](compatibility.json)、[首轮参数](startup-model.json)、[真实 CLI 恢复](codex-resume.json)。截图是实际 Electron 截图，已查看深浅色窄栏和交互结果；窄栏是缩窄对话根节点，宿主窗口仍宽。

未覆盖：真实远端模型推理、真实录音/转写、外部插件认证及工具实际操作；本轮没有贯通 UI→真实 CLI→远端服务的整条链路。新增提问目录、多色工具/文件图标、左侧抽屉图标及分屏 worktree 仍是 Figma 原型，未实施，不能列为 E2E 通过。测试只启动并关闭自己的隔离实例，不替换正式应用、不合并或发布。

---

2026-09-07，基线 62f993f，分支 codex/agent-chat-codex。

- `npm test`：2453 项，2452 通过、1 跳过、0 失败。包括三个翻译器、模型探测假 stdio server、损坏缓存、资源协议/面板映射、历史及原有组件回归。
- `npm run typecheck`：通过。隔离 UI 脚本的测试构建和恢复源码后的构建均通过。
- `node scripts/verify-agent-chat-ui.mjs --compat`：实际 Electron 组件回放 Codex/Claude/omp 公共事件，目录读取/失败/刷新入口、动态模型项、Markdown、工具成功/失败、HTTP 资源入口均可见；340px 根节点下消息区 331px，scrollWidth 331px；无渲染控制台错误。见 compatibility.json 及截图。
- `node scripts/verify-codex-resume.mjs`：实际 adapter 参数、本机 codex-cli 0.147.0、独立 CODEX_HOME、回环假 Responses 服务。三轮 exit 0、同一 resumeId，请求输入数 3/5/7，后续请求保留首轮消息和回复；检查 transcript 三轮 read-only 策略。不会调用真实账号或推理服务。
- 本机真实 model/list 已读通：返回模型自带推理档位，包括六档模型；前端不硬编码模型名称或最大档位。
- `npm run check` 被未修改的 canvas.css 中 cframe-sweep 动画规则阻止（--sweep infinite 非合成属性）。不能宣称整个 check 通过。

## 验证边界

公共事件回放不等于 Claude/omp 真实远端对话。未向真实插件外部服务发起工具操作；面板映射有测试，实际插件认证、资源失效和握手失败继续走现有宿主处理。三轮探针证明 CLI 恢复和策略传递，没有验证操作系统级写入拒绝，也未覆盖应用端停止后恢复、切换账号以及进程 exit 与发送竞态的全部时序。没有取得 Codex 私有样式，界面改动沿用 Eas-Term 主题和 Markdown 能力。

验证脚本只启动并关闭自己的隔离实例，临时 preload 补丁在 finally 还原；没有替换正式应用、发布或合并分支。

## 首轮模型选择补充

2026-09-07：`--startup` 隔离验证通过。发送前从真实 model/list 读到选项，start 调用数为 0；选择 GPT-5.6-Sol/low 后首轮和模拟 resume 失效重试都传递相同 model/effort。没有发送真实模型请求；start 被可还原测试接口拦截。见 startup-model.png/json。类型检查及构建通过；全量测试 2454 通过、1 跳过、0 失败。

## 审查后 UI 实施验证

2026-09-07：`--startup` 再次通过，首轮/恢复重试参数相同；`--compat` 回放三种 harness 均通过。新检查在 340px 根节点下测量模型/强度/刷新/语音/发送按钮：无超界、无互相覆盖，图标按钮有可访问名称且不显示文字。深浅色截图见 `*-narrow-dark.png` / `*-narrow-light.png`。截图仅缩窄对话根节点，因此周围宿主区域仍然较宽。

类型检查、隔离脚本恢复源码后的构建均通过；全量测试 2455 项，2454 通过、1 跳过、0 失败。第一次普通沙箱运行因 localhost listen EPERM 中止，授权本地端口后重跑通过。CSS 平衡检查通过；动画扫描仍有上述未改动的 canvas.css 基线失败。临时 preload 已还原。

Figma 新增目录（5:535 / 5:629 / 5:726）仅是待审查提案，不在此次代码验证范围。没有进行真实录音或 Claude/omp 远端推理。

## CLI 品牌与紧凑选择框（2026-09-07）

`--startup` 逐一点击 Claude Code / 默认 harness / Codex，确认菜单三张本地图片加载成功、选中按钮同步为对应品牌；首轮模型和恢复重试参数仍一致。菜单截图 `cli-brand-menu.png`。本地 harness 引用正式打包源图标，Codex 为 OpenAI 官方组织标识；来源见 `src/renderer/src/ui/cliBrands/README.md`。

`--compat` 三种 harness 公共事件回放通过，640px 下模型、强度、刷新和消息按钮保持同一行，无溢出或相互覆盖。选择框实际高度 32px、圆角 999px，启动已选模型宽约 113px、low 为 64px；深浅色截图 `startup-narrow-*.png`、`codex-narrow-*.png`、`claude-narrow-*.png`、`omp-narrow-*.png`。本次优化闭合选择框，展开选项继续使用原生 select。

类型检查、CSS 平衡和 diff 空白检查通过。测试使用隔离实例及公共事件回放，未发送真实远端推理请求；FrameStart 和 CanvasAgentBar 接入共享图标并经构建检查，此次没有逐一点击这两个额外入口。

## 沙箱三态图标（2026-09-07）

已将 Codex 启动权限整行改成输入操作行内的单个图标，默认完全放开。`--startup` 隔离实例真实点击验证：完全放开→可改工作区→只读→完全放开；每次图标状态与气泡文字一致，hover 显示“调整沙箱状态”，切换气泡 3.2 秒后自动收起。640px 与明暗主题下气泡保持在视口内、主操作不换行。只读角色点击也无法提升权限，CLI 切换后控件正确隐藏和恢复；最终选择只读，首轮及恢复失败重试均传入 read-only。截图 `sandbox-icon-dark.png` / `sandbox-icon-light.png`，参数及三次切换记录在 `startup-model.json`。

145 项启动/adapter/sessionState 测试通过；类型检查、CSS 平衡、diff 检查及隔离脚本还原后构建通过。start 仍由测试接口拦截，没有发起真实推理或改变正在运行的会话权限。

## 首条消息说明层级（2026-09-07）

摘要文字由 12px/t-2 调整为 11px、fg-dim 的 85% 不透明度，弱于 13px 的输入预置文字。`--startup` 明暗主题和 640px 实例验证通过，截图见 `startup-narrow-dark.png` / `startup-narrow-light.png`。核对截图时同时修正沙箱气泡随模型控件宽度和容器宽度变化后的锚点，新增缩窄后的定位断言；最终启动/恢复重试、三态切换、类型检查及构建均通过，渲染控制台无异常。

## 对话身份、强度滑块与 MCP 容错（2026-09-07）

对话上下文栏新增当前 CLI 名称与品牌图标；已有会话的 CLI 即使暂时检测为不可用，也保持实际身份。强度滑块使用模型能力清单中的离散档位，首档为不覆盖 CLI 默认。三 CLI 隔离 Electron 回放通过：真实拖动、Home/方向键、换模型清空、能力失效清空、恢复显示、品牌图片加载、640px 明暗主题布局；注入非致命 MCP 错误后停止按钮仍可用，后续文字及完成事件正常。

284 项相关单元测试、类型检查、CSS 平衡、构建与 diff 空白检查通过，临时 preload 相对 HEAD 无差异。这是本轮相关测试结果，不覆盖上文记录的其他全量基线问题。

真实故障定位：旧 CLI 0.147.0 不支持 gpt-6-astra，服务器已返回升级提示；原实现未翻译 error / turn.failed，最终 MCP shutdown 警告覆盖了真正的模型错误。现保留结构化模型错误，MCP 握手故障只发非致命工具提示；MCP 401 不触发主模型账号登录检测。没有修改全局 MCP 配置，用户显式设置 required 的服务器仍遵循 CLI 的必需语义。

两层真实验证：先使用本机已有 0.153.4，临时接入 `/usr/bin/false` 的 optional MCP，真实 gpt-6-astra 返回 EAS_OK 且 exit 0；再通过全新隔离应用的实际 agentChat.start IPC → 已修复的全局 CLI → 远端模型，得到 EAS_OK、turn.done，随后收到非致命 MCP 提示，没有 fatal。见 `codex-fixed-real.json` / `codex-fixed-real.png`；截图已人工查看 CLI 标识、滑块及正常回复。另以新 CLI 重跑本地模拟 Responses 服务的三轮恢复，退出成功并保留同一会话历史。没有调用外部 MCP 工具，未修复或重新授权 Figma 登录。

本机 CLI 入口修复记录：Homebrew 升级提供的 0.151.0 因本机签名问题退出 -9；随后下载 OpenAI 官方 rust-v0.153.4 的 aarch64 macOS 完整包，SHA256 对照官方 release asset 校验为 `35438da1fbf7a6db7ddb3bcec84448fa6015ba188461472a97d9d1da7d9c4353`。两个主可执行文件采用本地 ad-hoc 签名后校验通过，安装至 `/Users/biily/.local/share/codex/0.153.4`；`/opt/homebrew/bin/codex` 指向该版本，旧链接保存在 `/opt/homebrew/bin/codex.eas-term-backup-0.151.0`。Homebrew 账目仍为 0.151.0，未来 brew 操作可能替换入口；未关闭系统安全功能、修改 shell PATH 或改变账号配置。官方来源：https://github.com/openai/codex/releases/tag/rust-v0.153.4 。
