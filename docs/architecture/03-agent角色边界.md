# 03 · Agent 角色边界图

> 分两半读，**别串味**：
> **3A** 是产品能力 —— Eas-Term 托管起来的 agent 各自能干什么，边界由**代码**强制。
> **3B** 是开发纪律 —— 改这个仓库的 agent（你）的禁区，边界靠**文档**约束，没有代码兜底。

---

> **拆分说明（2026-09-30）**：3A 产品能力搬到 [03a](03a-产品内角色边界.md)（按需读）；本文件只留 3B 开发期红线 + 补充护栏索引，是**必读**。

# 3A · 产品内 agent 角色边界

→ 见 [03a-产品内角色边界.md](03a-产品内角色边界.md)。

# 3B · 开发期 agent（你）的边界

Windows 路径补正（2026-09-08）：真实 windows-2022 探针证实 `fs.realpathSync` 保留 `RUNNER~1` 而 Git 输出 `runneradmin`，导致同一目录被拒。`fsGuard.realResolve` 仅 Windows 改用 `fs.realpathSync.native` 统一长短名，继续解析 junction/symlink 和现存祖先，不降低 guardPath/guardDir 授权范围。回归 `fsGuard.test.mjs` 必须保留短长名相等、根删除拒绝、兄弟目录与 junction 越界拒绝。

## 🔪 危险操作 —— 会打到用户正在用的东西

| 别做 | 为什么 / 改做什么 |
|---|---|
| `pkill -f "Eas-Term"` · `killall Eas-Term` · `pkill -f electron` | 用户的正式版跑在 `/Applications/Eas-Term.app`，**而你这个会话就活在它的终端里** —— 宽匹配会连用户的应用带自己的对话一起杀。2026-07-23 真出过（`memory/工作规则-验证只在dev端-不擅自动release-app.md`）。只收自己起的那个：`verify-app.mjs` 前台跑就 Ctrl-C（它的 cleanup 会 `child.kill()` 并删掉隔离目录）；非要按模式杀，只认 `node_modules/electron/dist` 或 CDP 端口 9333 |
| 用 `npm run dev` 做真机验证 | dev 模式的 userData 走 `app.getName()`，**和正式版是同一个目录**（密钥柜就在那儿），不是隔离；且 electron-vite 的 CLI 吃不下 `--user-data-dir`。正确入口是 `npm run verify`（= build + `scripts/verify-app.mjs --seed`）：构建产物 + 显式临时 `--user-data-dir` + `--remote-debugging-port=9333`，配 `scripts/eval-in-app.mjs` 取状态。（memory 里"验证只在 dev 端"那句是旧结论，已被 `verify-app.mjs` 文件头推翻）|
| `npm run dist` | 几分钟起步、产物写 `~/Eas-Term-release`。用户没明说要打包就不跑 —— 2026-08-19 滚出过九个版本 |
| `scripts/install-local.sh` | 会 `mv` 走 `/Applications/Eas-Term.app`、`ditto` 新包、`lsregister`、`open -a` 重开。用户没明说要安装就不跑。脚本自带"应用还开着就拒装"的闸门，判据必须两条一起判（`pgrep -f "MacOS/Eas-Term"` + `ps -axo command \| grep`）—— `pgrep -x` 和 `pgrep -f "Eas-Term.app/Contents/MacOS"` 实测都会漏，**别删这道闸** |
| 挂 `scripts/watch-install.sh` | 它自己**不写** plist（只在收摊时 `rm -f` 掉），要跑就得先往 `~/Library/LaunchAgents/top.biily.eas-term.installer.plist` 写一份并 `launchctl` 注册 —— 等于在用户机器上装了个开机项，之后自动替换并重开他的应用。同样：用户明说才做 |

> **验证只在自己起的隔离实例上做；用户的 `/Applications/Eas-Term.app` 不碰、不杀、不换。**

## 🚫 绝对禁区 —— 改了会破坏安全模型

| 位置 | 为什么 |
|---|---|
| `src/main/fsGuard.ts` | `fs:*` / `snapshot` / `agentChat` 那几条写通道的路径白名单（另有更窄的独立边界，见 3A「运行时文件边界」）。绕过或弱化 = 渲染层/webview/MCP 桥都能写任意路径。改前必须读懂 `realResolve` 的 symlink 防绕逻辑 |
| `src/main/fs.ts` 里各写操作前的 `guardPath`/`guardDir` 调用 | 注释原话："漏了它的话，'所有文件写操作都限制在你自己加过的目录内'这句话就是假的" |
| `src/main/agentRules.ts` 里的 `rmSync({recursive, force})` | 删的是用户 home 里的真实目录（`~/.claude/skills/eas-term`、`~/.claude/skills/eas-wiki`、`~/.eas/agent`、旧 DSH 目录），**没有任何守卫兜底**。`claudeSkill()` 返回的是 `<...>/skills/<name>/SKILL.md`，调用点全都套 `path.dirname` —— **改成直接返回目录，dirname 就变成 `~/.claude/skills`，一次卸载抹掉用户全部 skill**。改删除范围、改 `claudeSkill()`/`detailDir()`、改 `home()` 的来源（注释里记着 `os.homedir()` vs `app.getPath('home')` 分叉的实测事故），一律按破坏性改动对待；`legacyDshSkill()` 的基路径还来自 `DSH_HOME` 环境变量 |
| `src/main/secrets.ts` 的 `assertReady()` / seal-open checksum / 钥匙串懒访问 | 删 ready 断言 → 静默用错全局密钥桶；删 checksum → macOS AES-128-CBC 无认证，实测坏 1 bit 有 **62.9%** 概率静默解出错误内容而不报错；**启动路径与 `secrets:status` 绝不调 safeStorage**（它本身就是同步钥匙串访问，弹窗会卡死主线程，见 03b 2026-09-30） |
| `src/main/agentHistoryKey.ts` | 专门抽出来的路径穿越防线 |
| `src/main/phone/server.ts` 的绑定地址 | 绝不能绑 `0.0.0.0` |
| `src/tunnel/hub.ts` 的"不终止 TLS"架构 | 任何"中间解密再转发"的改动都是红线违反，`hub.test.ts` 会红 |
| `src/main/builtinRoles.ts` 里 `illustrator` **不带** `caps`（2026-09-06 用户决定）与 `shared/roleBinding.ts` 的 `imageGen` 翻译逻辑 | 前者往回加 `imageGen` 要先问用户；后者改动影响所有勾了「不许生图」的自建角色 |

> **写边界不止 fsGuard 一条，是几条各管一摊 + 一片无守卫区**（已知有下面这些，不保证穷尽；
> 加写入口前自己再查一遍），不要"统一"它们：
> · `fsGuard.ts` —— 项目根 + 知识库根（`fs:*` / snapshot / agentChat / phone）
> · `skillLibrary/write.ts` 的 `skillWriteRoots()` —— 已登记的 skill 目录 + `<项目>/.claude/skills`，
>   且落点必须在某个 skill 子目录之内（**比 fsGuard 更窄**，文件头写明了故意不复用的理由）
> · `projectPaths.ts` —— 项目根本身的改名/删除（同样更窄，且不引 electron 以便单测）
> · 注入面（`agentRules.ts` 等）—— **无守卫**，靠"只写固定几个写死的路径"自律

## ⚠️ 静默失效区 —— 改了不报错，但功能悄悄坏掉

| 位置 | 症状 |
|---|---|
| `src/main/index.ts` `whenReady()` 内注册顺序 | 见 [02](02-分层架构.md)。打乱后一切照常启动，只是密钥桶错了 / profiler 没生效 / PTY 拿不到 MCP token |
| 自定义协议注册（`bizone`/`dictClip`/`media`） | **必须在 ready 之前**，挪到之后静默失败 |
**执行清单跨文件护栏（2026-09-25）**：`agentChat/session.ts` 只在成功投递用户消息时签发 `turnId`，同一消息的安全分叉/自动恢复不能换 ID；`mcpBridge.ts` 的租约校验与 `pluginHost.ts` 入站捕获轮次及晚到回执校验必须同改。`executionPlanAuthorization.ts` 不信任模型的 cwd/session/turn/accepted 参数；`resources/plugins/execution-plan/lib/store.mjs` 是唯一写入者，`executionPlanSnapshot.ts` 只能读，不可在坏库时覆盖。关闭/替换插件后旧 shim、面板都失效，不能为使工具可用而放宽 `fsGuard` 或把计划服务挂到 PTY。新增事件 `plan.progress`/`plan.missing` 同步 `shared/agentChat.ts`、归约器与隔离基线；`index.ts whenReady()` 顺序保持不变。 原生卡片另有 `executionPlanOwner.ts` 的画布节点/项目根验证与 `executionPlanCardIpc.ts` 的 sender/会话校验；绝不让模型或任意面板自报 ownerKey。`agentChat:interrupt` 与任务卡终止共用 `interruptManagedTurn`，卡片路径必须等进程 exit 或 ACP 真 `turn.done` 才写 `terminated`；未知停止不自动重试，且取消未确认时必须释放“正在终止”门闩。清单自动收尾仅在全部步骤reported_done且idle时同事务完成，晚到步骤追加靠 CAS 拒绝；完成/终止历史不能回退为 active。

| `mcpBridge.ts` 与 `eas-mcp.mjs` 各自的 `LONG_WAITS` 集合 | 两处**手动同步**。不一致 → 用户看到连接错误而非业务提示 |
| 四道超时闸的不等式（shim http > invokeRenderer > 渲染层**两个**等待窗口） | 破坏后同上；③ 是两个独立常量，只改一个会改错文件 |
| `approvalRoute.ts` 的 `hookResponseBody()` ↔ `resources/agent-hooks/responseBody.mjs` | 跨进程无法 import 的重复代码，两处注释互相钉死，改一处必须改另一处 |
| 审批 payload 的归一化位置 | **不许把 `approvalRegistry` 搬回 `approvalRoute.ts`**。那条边界是修复轮特意划的（`approvalRoute.ts` 文件头）：路由层只留数据，一接 registry 就把"会话"概念拖进这一层，并重演"payload 只剩 approvalId、卡片内容全丢"的历史退化。要改 kind 映射，只改 `approvalRegistry.ts` 的 `PATCH_TOOLS` / `kindOf()` |
| `shared/agentChat.ts` 的 `AGENT_CHAT_EVENT_CHANNEL` ＋ `agentChat/session.ts` 的 `emitEvent()` ＋ `src/preload/index.ts` 的加载期监听器 | **三处必须一起看**：`agentChat:start` 的 handler 在 `return` **之前**就同步走完 deliverMessage→handleEvent→`wc.send`，事件早于 invoke 的 reply 到达。所以频道必须是**固定名**、preload 的监听器必须在**模块加载期**挂上 —— 不能照搬上面 pty 那套"invoke resolve 后再订阅/再缓冲"（`pty:create` 的 handler 里没有同步 send，前提不一样）。改成按 sessionId 动态命名、或改成 await start 之后再订阅：不报错、无测试拦截，只是首批事件被 Electron 静默丢弃（实测同步推 30 条只到 1 条，丢的正是"本次会话没有审批保护"那条 notice）。同一处的 `stoppedAgentChatSessionIds` **只能当黑名单，绝不能反过来做成白名单**（"start resolve 后才允许缓冲"＝把同一个窗口重新打开）|
| **不要给注入面"补上漏掉的 `guardPath`"** | fsGuard 的白名单里永远没有 home，一加规则分发当场全量失败**且不报错**（`syncRules` 静默写不进去），症状是 agent 不再知道画板工具、首启"有更新待安装"反复弹。同理 `skillLibrary/write.ts`、`projectPaths.ts` 也不许换成 fsGuard，两处文件头都写明了理由 |
| `adapters/claude.ts` buildArgs | 绝不能带 `--bare` / `--permission-mode manual`（实测硬约束） |
| `adapters/codex.ts` stdin | 必须 `ignore`，否则卡在等 stdin |
| `src/main/probeEnv.ts` 的 `userBinDirs()` 候选目录 | 探测子进程的 PATH 从这里来。**漏一个安装位 = 那种装法的用户永远显示「未安装」**，而且不报错、不进日志、测试全绿 —— 开发机从终端起实例有完整 PATH，永远复现不出来。复现只能靠 `env PATH="/usr/bin:/bin:/usr/sbin:/sbin"` 起构建产物（模拟 launchd）。**删 `applyLoginShellPath()` 的调用同样静默** —— 只是从「装在哪都找得到」退回「只认写死那几个目录」 |
| `src/main/cliContractRun.ts` 的探测命令 | 只能是 `--help` / `--version`。**绝不能加会拉起交互会话的子命令** —— 曾误用 `claude config list` 启动了一次真实会话（教训记在 `agent.ts` 的注释里）。自检每次启动都跑，有副作用就是每次启动都有副作用 |
| `skillLibrary` 的分类口子 | **下面这些一起改**：`mcp/eas-mcp.mjs` schema + `mcpHandler.ts` 执行 + `skillLibrary/index.ts` 落盘（IPC + `saveConfig` patch 语义 + `skippedLocked` 跳过）与 `category.ts` 校验（`validateCategoryBatch`，有单测）+ `.claude/skills/skill-organizer/SKILL.md` 说明。只改 `category.ts` 会漏掉落盘那半 |

## 🔄 历史修复区 —— 改了会把已修好的问题改回去

| 位置 | 那次事故 |
|---|---|
| `CanvasStage.tsx` L100-110 · L1146-1148 | **故意不订阅 `canvas.shapes`**。注释原话："不为一句引导把那次重渲染优化撤回来"。AI 重构最爱"顺手补全订阅"，一补就回退掉帧修复 |
| `store/index.ts` 撤销 subscribe（250ms 合并窗口） | 撤销记录**单点**触发，不在各条 action 里各写 `record()`。新增改 canvas 的 action **不要**手写记录 |
| `store/canvas/persist.ts` | "序列化和 sanitize 是同一件事的两面"，改写入格式必须同步放宽读取校验，否则症状是"下次启动一片白" |
| `features/status/RunMonitor.tsx` | 注释点名："说反左右正是当初『右上角通知不见了』那场事故的起因" |
| `.github/workflows/build.yml` 固定 `windows-2022` | 升级会导致 node-pty 编译失败 |
| `package.json` 的 `asarUnpack`/`x64ArchFiles`/`build.mac.identity` | 原生模块打包规则与签名身份，改坏产出"能打包但一用麦克风就崩"或"下载即被 Gatekeeper 拦" |
| `scripts/publish-site.sh` 的 `OTHER_SITES` / `KEEP` | 同一台服务器上还跑着别的生产站（名单以 `OTHER_SITES` 为准）；`KEEP` 改小会误删版本导致下载 404 |

## ✍️ 分发产物区 —— 手改无效，下次会被覆盖

| 位置 | 源头在哪 |
|---|---|
| `site/vendor/spb-design/` | `~/Biily/独立站/design-system/`，用 `sync-design-system.mjs` 分发回来 |
| `deploy/tunnel/hub.mjs` | esbuild 打包产物（路径的权威是 `scripts/publish-tunnel.sh` 的 `LOCAL=`）：入口 `src/tunnel/main.ts`，隧道协议与"绝不终止 TLS"的实现在 `src/tunnel/hub.ts`。改完由 `publish-tunnel.sh` 重新打包并 scp 到线上 `/opt/eas-tunnel/hub.mjs`，手改这份下次打包原样覆盖。**它被 git 跟踪、不在 `.gitignore` 里**，在磁盘上长得跟普通源码一样 —— ⛔ 标记是唯一的护栏 |
| `~/.claude/skills/eas-term/*.md`、`~/.eas/agent/*.md` | 由 `agentRules.ts` 分发，写完 `chmod 444` |
| `~/.codex/AGENTS.md` 的 `<!-- eas-term:begin -->` 围栏内 | 每次 `syncRules` 整段重写 |
| 知识库根的 `CLAUDE.md`/`AGENTS.md` 围栏内段 | `wiki/schema.ts` 升级时重写 |
| `out/` | `electron-vite build` 产物，已在 `.gitignore` |

> **`hooks/dictionary-bundle.json` 不在这一区** —— 它是 git 跟踪的**源文件**，没有脚本会生成或
> 覆盖它，随 `package.json` 的 `extraResources`（`hooks/ → hooks/`）原样打进包，由
> `hooks/scan-commit.mjs` 的 `loadDict()` 直接读，要改就直接改它并提交。反过来的风险：删掉它或
> 把它 gitignore 掉，钩子会因 `loadDict()` 返回 null 而**静默 `exit(0)`**，词典提示从此不再出现
> 且没有任何报错。它与 `src/renderer/src/features/dict/dictionary-bundle.json`（界面 `import`，
> `scripts/dict-svg/*` 只改那一份）是两条独立链路且**内容已经分叉**，动前先确认要改哪一条。

## 补充护栏索引（详情在 [03b](03b-补充护栏详情.md)）

> 一行一条：标题：规则开头一句 — 涉及的文件或符号。**这些都是真约束，摘录不等于全文**；你要改的文件出现在某一行里，先去 03b 读那一条全文再动手。

- **密钥柜不在启动/状态路径碰钥匙串（2026-09-30）**：`registerSecretHandlers` 与 `status()` 只读 secrets.json + 缓存，safeStorage 只在真加解密前现查；「真用前要不要弹解锁」走 `secrets:checkStatus` 不走展示态 — `secrets.ts` · `SecretsPanel` · `vaultCheck.ts` · `secretsKeychainLazy.test.mjs`
- **2026-09-28 历史保护补充**：非ACP取消不能在 kill 请求之后立即发 turn.done，必须等 owned process close + dispatch 释放，否则「调整方向」在资源占用期间抢发并暂…
- **输入框辅助护栏（2026-09-28）**：`composerAssist` 推荐及 ↑ 历史只读当前会话，Tab 永远不是发送动作 — `composerAssist`
- **Codex 路由超时恢复开发护栏（2026-09-23；当晚上限调整为 5 次）**：`mcp/codex-task-recovery.mjs` 的纯判据必须严格匹配原生 terminal failed 的错误全文，任何活动、状态不明或五次恢复额度耗尽都失败关闭 — `mcp/codex-task-recovery.mjs` · `codex-task-error.mjs` · `unknown`
- **2026-09-07：对话恢复与能力更新补充**：Codex exec 的 --sandbox 必须放在 resume 子命令之前，禁止为修恢复错误删去沙箱或改 stdin ignore
- **蓝图hover历史修复（2026-09-08）**：BlueprintPanel的词条按钮必须有局部onMouseLeave
- **2026-09-09 最大化恢复补充（历史修复区）**：兄弟模块 display:none 使几何归零
- **语音输入保护（2026-09-09）**：语音文本写入只能经编辑器适配接口 — `stt:audio/stop`
- **2026-09-09 OMP 调整方向的取消轮次边界**：`agentChat/omp/transport.ts` 的 cancel 超时只属于发起取消的 prompt 身份及进程 — `agentChat/omp/transport.ts` · `redirect.real.test.ts`
- **用量账本边界（2026-09-10）**：计量只能由主进程真实 CLI 事件旁路采集 — `meter`
- **2026-09-10 后台输出历史修复**：终端后台解析不能等待requestAnimationFrame，否则最小化时输出积压
- **密钥柜视觉调整的契约（2026-09-10）**：不能把列表元数据替换成reveal结果
- **2026-09-11 验收缺陷回归边界**：`secretRequest.ts` 持有弹窗，必须先于 `mcpBridge` 10 分钟上限超时（当前 9 分钟），清 pending + emit + reject — `secretRequest.ts` · `mcpBridge` · `CodeView`
- **2026-09-12 设计选型提示词边界**：设计选型复用 `composerAddChip`，确认只附加所选系统，不发整个库，不直接调用模型、不写 PTY — `composerAddChip`
- **2026-09-13 · 固定运行状态文件例外**：fsGuard.guardRuntimeStateFile 是主进程固定 userData/runtime-state.json 的窄入口，无路径参数，不扩展 guardPath/…
- **2026-09-13 流式语音迁移保护**：流式识别模型和decode仅在 `voicePreviewWorker` — `voicePreviewWorker` · `voicePreviewSession.takeText`
- **2026-09-14 · 安全边界四道新闸（改了会静默失效）**：安装命令只认主进程方案表 — `cliAuth/installCommand.resolveInstallCommand` · `startInstall` · `cliAuth/install.ts`
- **2026-09-18 插件兼容性门禁**：`pluginCompatibility` 对未知/畸形 requirements 失败关闭 — `pluginCompatibility` · `pluginMarket`
- **2026-09-18 OAuth 宿主连接链路（尚未广告能力）**：`pluginManifest`/`PluginInfo.remote` 增加显式 OAuth public-client 固定端点描述，要求 `auth.oauth`，拒绝内嵌… — `pluginManifest` · `PluginInfo.remote` · `auth.oauth`
- **2026-09-18 插件包变更生命周期**：pluginMarket的installCommit/uninstall在同步写盘前调用pluginHost.assertPluginPackageIdle：已起宿主（含30s宽限…
- **Codex 原生目标生命周期（2026-09-18）**：AI 对话专用 `taskLifecycle: true` 由 `session.ts` 传给 `codexCapabilityLaunch.ts`，经 `mcp/eas-code… — `taskLifecycle: true` · `session.ts` · `codexCapabilityLaunch.ts`
- **画布平移第一阶段（2026-09-21，12闲置对话场景已验收）**：CanvasStage 的鼠标拖动以 frameLatest 合并绝对位置，每帧最多提交一次，松手/失焦/卸载收尾 flush 并取消残留帧
- **2026-09-22 源码引用边界**：设计选型台 `dict:designSource` 不接受任意URL，只按既有索引slug读取固定HTTPS源，拒绝redirect/非HTML/超时/超限 — `dict:designSource`
- **CLI 安装引导边界补充（2026-09-22）**：安装唯一槽位与 window/taskId 取消校验不能为了 UI 方便绕过 — `curl` · `sh`
- **2026-09-23 Codex 原生任务短时状态查询容错**：`codex-task-bridge.mjs` 仅对已启动原生轮次后的 `thread/goal/get` **超时**做最多三次只读查询（第一次加两次重查） — `codex-task-bridge.mjs` · `thread/goal/get` · `turn/start`
- **2026-09-24 · AI 用量显示边界**：`Usage.inputIncludesCached` 为可选口径标记 — `Usage.inputIncludesCached`
- **未投递恢复护栏（2026-09-26）**：`message.unsent` 只由主进程确认尚未进入投递回调时产生 — `message.unsent` · `turn.start` · `shared/agentChat.ts`
- **2026-09-26 · 合成结束事件不是成功**：启动拒绝、排队取消、进程崩溃、停止补偿的 `turn.done` 必须带 `interrupted:true, usageKnown:false`：只清 busy，不发完成通知，不… — `turn.done` · `interrupted:true, usageKnown:false` · `islandResults`
- **2026-09-26 · 不把资源等待当执行失败**：默认资源等待无截止，不得再次给其外层套短Promise.race/IPC总等待计时器 — `interrupt()` · `handleEvent(..., true)`
- **2026-09-26 · 清单自动完成，不要求用户验收**：PlanCard按reported_done显示勾选/已完成，不代写accepted（旧用户验收历史字段只保留兼容）
- **2026-09-27 · CLI dispatch 终态与资源复验护栏**：只有当前非 ACP 协议流的终态（成功或失败）与所属进程 close 有资格，显式停止仍保留至 close — `!interrupted`
- **2026-09-27 任务清单固定模块锚点**：`PlanCard` 的 body portal 仍不改变 pane 父容器和对话布局 — `PlanCard` · `planDockPlacement.test.ts` · `scripts/verify-plan-dock.mjs`
- **闲置恢复交接边界（2026-09-27）**：`ipcProfiler` 的最先注册顺序同时保护 `recoveryAdmission`，不得挪后或只包装 guardedHandle — `ipcProfiler` · `recoveryAdmission`
- **2026-09-28 本地行为统计保护**：个人活动日账本只在本地，不许接入匿名遥测
- **2026-09-28 · 双击项目菜单排序例外**：用户明确要求此菜单运行项目优先，不能套回全局 approval/done/running 紧急度顺序 — `ProjectRow.top`
- **2026-09-28 Jev 旧包发布兼容**：Jev v2必须按requirements.capabilities里的jev.decisions.v2分流，不按名字向市场0.1.x发host/restore、保存恢复证明或宣称…
- **2026-09-28 · 后台任务不是「完成」**：Claude `run_in_background` 的 shell 在本轮 `result` 之后仍在跑，跑完 CLI 会自己再起一轮（实测 Claude Code 2.1.28… — `run_in_background` · `result` · `__fixtures__/claude-background-shell.jsonl`
- **2026-09-29 · 后台运行中：独立提示音 + 不说「完成」**：「处于后台任务进行中的时候，它的提示音应该是不同于任务完成的提示音的」＋灵动岛卡片「也改为后台运行中」 — `uiSlice.ptyBackground` · `BackgroundMark {at,count,label}` · `ptyApproval`
- **2026-09-28 · 后台通知引起的空一轮不能结束用户那一轮**：恢复一个带着未完成后台任务被强杀的 Claude 会话（例如升级时进程被结束），CLI 先补报 `task_notification(stopped)`，再为它跑一轮**空回复**… — `task_notification(stopped)` · `result.origin.kind = task-notification` · `__fixtures__/claude-resume-stopped-task.jsonl`
- **2026-09-28 · 灵动岛不得切换宿主应用类型（Dock 图标）**：`setVisibleOnAllWorkspaces` 必须带 `skipTransformProcessType:true`，否则整个 app 变 accessory、Dock 图标消失 — `island.ts:createIsland` · `islandDockPolicy.test.mjs`
- **2026-09-28 · 原生灵动岛宿主（macOS NSPanel）**：子进程 stdio 不是 IPC sender，动作必须经 generation/类型/当前目标校验；Lab 隔离不得改主进程 HOME — `islandNativeHost.ts` · `islandHostProtocol.ts` · `appHome.ts` · `islandRecovery.ts`
