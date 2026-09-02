# Oh My Pi（omp）底座接入

**日期**：2026-09-01（v3：2026-09-02。v2 合并了 6 份子系统地图 + 4 份审查；v3 合并了 9 份按章对抗审查
（全部 opus，每条主张先对代码核实再报）的 88 条 issue 与 87 条核实结论。v2 里被核实为错的地方在正文里直接改掉，不留旧说法。）
**范围**：把 omp 作为与 Claude Code / Codex **同级**的第三个 AI 对话底座接进 Eas-Term：
随包分发、自带引导链路、审批走前端卡片、花费与上下文进现有数据面。
**技术依据**（每条技术判断都以这些为准，不以印象为准）：
- `docs/omp接入评估-2026-09-01.html` —— 两条协议面的实测、事件映射、额度两种模式
- `src/main/agentChat/ompEvents.ts` + `ompEvents.test.ts`（24 条全绿）—— 已写好的 ACP→ChatEvent 翻译器
- `src/main/agentChat/__fixtures__/omp-acp-bash.jsonl` / `omp-acp-handshake.json` —— omp 18.0.11 真录（**录自 `always-ask` 模式、免费模型，没有 `cost` 字段**）
- omp 源码实读（本地 checkout 是 18.0.11，钉 18.1.2 后要复跑一遍关键 grep）：
  `utils/src/dirs.ts`（配置目录：`PI_CONFIG_DIR` 相对 HOME；`PI_CODING_AGENT_DIR` 绝对路径覆盖 agentDir；`OMP_PROFILE`/`PI_PROFILE`；darwin 也走 XDG）、
  `config/settings.ts`（受管文件是 `agent/config.yml`；`settings.json` 只被迁移一次；`project wins over global`，项目层含用户项目的 `.claude/settings.json`）、
  `config/settings-schema.ts`（`tools.approvalMode` 默认 **yolo**，`write` = 自动放行写类；`generate_image.enabled` / `speechgen.enabled` / `browser.enabled` / `computer.enabled` / `tools.xdev`）、
  `tools/approval.ts`（`APPROVAL_MODE_MAX_TIER`、逐工具 override 在每种模式下都生效）、
  `modes/acp/acp-agent.ts`（`loadSession` 重放历史、`resumeSession` 不重放且响应无 `sessionId`、`agent_end` 内部消费、`configId` 字面量、`session/cancel` 立即回 `cancelled` 且进程存活、`#toMcpConfig` 接受 stdio 但 `env` 必填、MCP 连不上 `session/new` 整体失败、prompt 内部排队）、
  `session/acp-permission-gate.ts` + `session-tools.ts` + `extensibility/extensions/wrapper.ts`（两条审批通道的产生顺序；拒绝后第二通道不来；`elicitation/create` 不带 `toolCallId`）、
  `cli/args.ts` + `flag-tables.ts` + `main.ts`（`--approval-mode` / `--tools` 在 `acp` 下生效；未知工具名**抛错**；`builtin-names.ts` 无 `ls`）、
  `cli-commands.ts`（**没有 `login` 子命令**，未知词会被改写成 `launch <词>` 起一个对话）、
  `ai/src/usage/*`（`UsageLimit` 形状；Anthropic 一份 report 里多条 7d 并列；`resetsAt` 是 ms；`metadata` 带 email/accountId）、
  `session/session-manager.ts`（cost 从会话条目重算，resume 后延续）
- `docs/superpowers/specs/2026-08-14-通用CLI对话前端-design.md` —— 本设计要往里接的那套系统的原始设计
- `docs/architecture/03-agent角色边界.md` §3B、`13-所有权矩阵.md` 跨文件同步清单

---

## 用户原话

> 探一下如果项目中要新增这个 ohmypi 项目中的 harness 底座作为 cc 和 codex 的同级，应该注意什么，
> 怎么改写代码，需要兼容那些模块，模型填入那边需要做什么匹配的事件和前端
>
> 那能做到代码层面的隔离吗 **OMP 的接入不要影响 CC 和 codex 的任何方面**
>
> 留好这些数据接口，后面做软件的数据层会用
>
> 那如果我想现在接入，你来写 spec 设计实现方案吧

第二句是本设计的**核心约束**：§二整节回答它，§十二的验收项证明它。

---

## 一、已拍板的决定

| # | 决定 | 理由 |
|---|---|---|
| 1 | **omp 走独立的 ACP 传输层**（`agentChat/omp/transport.ts`），不复用 stdin 行协议那条路 | ACP 是双向 JSON-RPC：服务端会向我们**发请求**（审批、elicitation），不回整轮挂死（实测 180s）。`session.ts:159` 的 `for (const e of live.translator.push(l))` 假定翻译器只回事件数组；`writeStdin`（L407）硬写 Claude 的 wire format |
| 2 | **隔离靠「能力字段驱动的独立分支」，不靠「按 id 分支」** | 沿用 2026-08-14 决定 #6。`session.ts` 里新增的每一处都判 `live.acp` / `adapter.transport === 'acp'` / `adapter.quotaSource`——旧 adapter 不声明、旧会话没有 `live.acp`，对它们**恒为 no-op** |
| 3 | **二进制随包分发，不在运行时下载** | ① `01-系统上下文` 不许私自新增运行时出站；② 本机 Clash 拦 GitHub 实测 173KB/s；③ 运行时签不了名。代价见 §四 P.5 |
| 4 | **配置目录放 `userData` 之下；用 `PI_CODING_AGENT_DIR`（绝对路径）钉 agentDir，同时清掉会改道的环境变量** | ① 用户已在自己装 omp 做实验，我们的设置不能写进他的 `~/.omp`；② 隔离实例（`verify-app.mjs` 临时 `--user-data-dir`）自动隔离；③ **只设 `PI_CONFIG_DIR` 不够**：omp 还认 `PI_CODING_AGENT_DIR`（`dirs.ts:316-320` 绝对路径覆盖 agentDir）、`OMP_PROFILE` / `PI_PROFILE`（`dirs.ts:39`，agent 目录变成 `profiles/<p>/agent`）、以及 **darwin 也生效**的 `XDG_DATA_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME`（`dirs.ts:338-361`，会把 sessions / `agent.db` 挪出去）。目标用户正是最可能设了这些变量的人。`PI_CODING_AGENT_DIR` 设成绝对路径后 `isDefault` 为假、XDG 分支整个关掉，也不再依赖「相对 HOME」这条假设 |
| 5 | **受管配置写 `<agentDir>/config.yml`（YAML），不写 `settings.json`** | `settings.ts:1297-1305`：只有 `config.yml` 不存在时才读 `settings.json`，读完 deep-merge 进 `config.yml` 并把它改名成 `.bak`（`:1612-1623`）。写 `settings.json` 只生效一次，之后每次重写都是死文件——换 provider、收紧 deny 全部静默无效 |
| 6 | **`tools.approvalMode: always-ask`**，命令行同步 `--approval-mode=always-ask` | v2 写的 `write` 语义读反了：`approval.ts:37-41` `APPROVAL_MODE_MAX_TIER = { 'always-ask':'read', write:'write', yolo:'exec' }`——`write` 是**自动放行读类和写类**、只对 exec 弹卡；`always-ask` 才是「读类自动、写与执行都问」，与 Claude 侧 `PATCH_TOOLS = {Write, Edit, NotebookEdit}` 要弹卡的粒度真正一致。现有 fixture 本来就录自 `always-ask`，不用重录 |
| 7 | **审批决定器改成异步**（返回 Promise），翻译器加 `abort()`，`abort` 与超时都要产 `approval.resolved` | 同步只能跑 fixture。`reduce.ts:126` 的 `pending` 是单槽位，清它的唯一入口是 `approval.resolved`（`:323`）；`ApprovalCard.tsx:53-58` 的不变量是「主进程必定广播一次 resolved」。不产的话卡片永远挂着 |
| 8 | **复用 `agentChat:resolveApproval` 这条 IPC，不复用 `approvalRoute.ts`，也不借 `HookPayload`** | `approvalRoute.ts` 是 hook/HTTP 那条路的私有实现，3B 明写「不许把 registry 搬回 approvalRoute」。omp 的 `toolCall.kind` 已在 `ompEvents.ts` 映射成我们的 `kind`；ACP 的待决审批自己记一张表，IPC 处理器加一行「hook 那路没认领就问 ACP 那路」 |
| 9 | **两条审批通道靠时序配对，不靠 id** | `elicitation/create` 的 params 只有 `{mode, sessionId, message, requestedSchema}`（fixture 第 10 行；`acp-agent.ts:350-360`），**没有 `toolCallId`**。omp 侧对同一次工具调用严格串行（外层 `session-tools.ts:795-845` 先 await `requestPermission`，通过后才执行，内层 `wrapper.ts:325-336` 才发 elicitation）。拒绝后内层不执行 → **第二通道不来**，所以「两条都回」不能当完成判据 |
| 10 | **模型 / 强度列表：`omp models --json` 列、`session/new` 的 `configOptions` 校** | `cli-commands.ts:135-139` 注册了 `models` 子命令，`models-cli.ts:199-206` 在 `--json` 下直接输出 `{models:[…]}`，不建会话。`configOptions` 是**数组**（`[{id:'mode'…},{id:'model'…},{id:'thinking'…}]`），取项要 `.find(o => o.id === 'model')`；没有 `model` 项 = 没配 provider |
| 11 | **用户选定的模型 / 强度在第一条 prompt 之前用 `set_config_option` 下发；中途改也走它，不重启** | `session/new` 只收 `{cwd, mcpServers, additionalDirectories}`（`protocol.ts:234-239`），没有 model 参数；spawn 也不带 `--model`（那样改模型就要重启）。v2 里用户选的模型**没有任何一条路会生效**，工具栏却显示回读的 `currentValue`。`configId` 是字面量 `'model'` / `'thinking'`（`acp-agent.ts:100-101`），value 是 `<provider>/<model>` |
| 12 | **用户按「停」：发 `session/cancel`，等 prompt 响应（≤3s），进程留着** | `acp-agent.ts:1091-1103` `#beginCancelCleanup`：收到 cancel **立即**以 `stopReason:'cancelled'` 回 prompt 响应，会话与进程存活，后台最多 5s abort/flush。v2 的「随后照旧 kill」会打断 flush；若这一轮没落盘，`session/resume` 会以 `ACP session not found` 失败（`:1258-1270` 直接 throw）——「停一下，整段对话没了」 |
| 13 | **provider key 一律经 `models.yml` 的 `apiKey: "EAS_OMP_<ID>_KEY"` 注入，内置 provider 也不改名成 `ANTHROPIC_API_KEY`** | `model-registry.ts:1318-1348` 对**任意** providerName（含内置）在 `apiKey` 存在时都会 set，`:1377-1379` 明写「wins over OAuth tokens」；`resolve-config-value.ts:21-27` 先查同名 env。改名成标准名的后果：omp 起的 bash 里若跑 `claude` / `codex`，会继承 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`——Claude Code 从订阅 OAuth 静默切成 API key 计费。这是最难发现的一种「影响 CC」 |
| 14 | **关掉 `browser` / `computer` / `generate_image` / `speechgen`（tts），关 `tools.xdev`** | 生图红线。真键名与默认值：`generate_image.enabled`（默认 false）、`speechgen.enabled`（默认 false；工具叫 `tts`、开关叫 `speechgen`，且 `sdk.ts:2046-2048` 推 tts 时**不看 `--tools`**，这是唯一能挡它的锁）、`computer.enabled`（默认 false）、`browser.enabled`（**默认 true**，必须主动关）、`tools.xdev`（默认 true，`write.ts:524-552` 的 `xd://<tool>` 转发让「白名单里有 write」等于给所有已挂载工具开后门）。再叠 `tools.approval.{generate_image,browser,computer,tts}: deny` 当第二道（`approval.ts:133-158` 按 `tool.name` 查，不校验是否 builtin） |
| 15 | **额度走「第三条通道」：`omp usage --json`，`snapshot.omp` 整段替换、带账号校验、定时轮询有门** | 事件流只有花费与上下文，订阅额度只有 `omp usage` 拿得到。它是单来源全量载荷（与 Codex 同形），逐格写入会让消失的窗口永不清除、换账号后继续显示上一个账号——正是 `claudeAccountUuid` 那次事故的形状 |
| 16 | **omp 在注册表排最后；默认选择规则改成「有别的 CLI 可用就不抢」；顺序有测试钉住** | `AgentChatView.tsx:445` 默认取 `usable[0]`，`phone/provider.ts:179` 与 team 派活也取第一个可用。omp 随包 → `available` 恒真 → 放首位会让**只登了 Claude 的老用户升级当天每个新节点都被切成 omp**。规则：`cur ?? pinned ?? usable.find(c => !c.bundled) ?? usable[0]`；`adapters.test.ts` 加一条「声明了 `bundled` 的必须排在未声明的之后」 |
| 17 | **一期不做团队成员、灵动岛、历史面板、订阅登录 GUI、用户手选 CLI 的持久化** | 前三处按 `AgentKind` 分支。订阅登录：omp **没有 `login` 子命令**，入口要实测（§十三）。手选 CLI 持久化：`persist.ts:85` 落盘 agent pane 只写 `{kind, cwd, resumeId}`，`cli` 今天对 Claude/Codex 也一样被丢掉——补它是一处**新增**的持久化行为，不是 omp 接入的一部分 |
| 18 | **版本钉 `18.1.2`（GitHub Release 独立二进制），fixture 在它上面重录；重录时用一个**收费**模型补一份带 `cost` 的 `usage_update`** | 现有 fixture 录自 npm 装的 18.0.11 + 免费模型：`grep cost` 零命中，D.1 的花费整行、阶段 4 的验收目前零真录覆盖 |

| 19 | **首启引导：omp 配好且冒烟过视同 ready**（用户 2026-09-02 拍板） | `AgentOnboarding.tsx:90` 的 `anyReady` 只认 claude/codex，omp 配好、两者未登录时每次启动仍弹「先让它有个大脑」。改法：`anyReady` 并入 `api.omp.status()` 的 `configured && lastSmoke?.ok`，**同时把 omp 纳入 `:89` 的 `allChecked`**（否则 omp 状态没查回来会先闪一下引导页）；文案加一句「或直接用自带的 omp」。改的是引导页判据与文案，不改 Claude/Codex 的登录、安装、会话任何路径 |
| 20 | **mac x64 也带 omp**（用户拍板） | 包体 +45MB 左右、首次拉取多 135MB；下载页已按芯片分包，x64 用户不该是二等 |
| 21 | **omp 会话用一份「原版原样复制 + 末尾追加」的 eas-term skill 副本，原版一个字不改**（用户拍板：动得少、方便维护） | 原版 `skills/eas-term/`（7 个文件，`agentRules.ts` 分发到 `~/.claude/skills/eas-term/`）的 `SKILL.md:10` 触发情境 C 与 `:47` 那行表格都教模型「凭证卡住 → `request_secret`」，而那三个 MCP 工具按 `ptyId` 授权，omp 会话没有 `ptyId`，**工具看得见、调不通**。做法见 §P.4：`omp/config.ts` 每次起会话前把整个目录**原样**拷到 `<agentDir>/skills/eas-term/`，只在 `SKILL.md` 末尾追加一段带围栏注释的「本会话是 omp 底座」说明（十来行的生成器，不 fork 内容）；原版以后怎么改都自动带过去。**不动 `secrets.ts` 的授权模型** |

## 二、隔离契约（回答「不要影响 CC 和 codex 的任何方面」）

### 2.1 三层隔离

| 层 | 承诺 | 靠什么保证 |
|---|---|---|
| **代码** | 下列文件**零改动**：`adapters/claude.ts` `adapters/codex.ts` `claudeEvents.ts` `codexEvents.ts` `approvalRoute.ts` `approvalRegistry.ts` `approvalEnv.ts` `hookInstall.ts` `slashSilence.ts` `sessionState.ts`、`src/main/cliAuth/*`、`quotaApi.ts`、`CliLoginPanel.tsx` `CliSetupPanel.tsx`、`pty.ts`、`secrets.ts`、`shared/types.ts`、`shared/teamCost.ts`、`toolbarModel.ts`、`store/canvas/persist.ts` | 验收 §12.1-1：`git diff --stat` 对这份清单为空 |
| **既有测试** | 允许改的既有测试文件只有两个：`ompEvents.test.ts`（omp 专属，按新契约重写其中 5 条）与 `adapters.test.ts`（**只许新增 test 块，不许改既有断言**）；其余一个都不改 | 验收 §12.1-2 |
| **运行时** | Claude / Codex 会话走的每一行代码与今天相同 | `session.ts` 的 9 处改动全部是「对旧 adapter / 旧会话恒为 no-op」的形状（§五 T.1 逐条列了形状），不在旧路径上加 else、不改旧路径的顺序。§12.1-5 用事件序列基线证明 |
| **配置** | 不碰 `~/.claude` `~/.codex` `~/.claude.json`、用户项目里的 `.claude/settings.json`；也不碰用户自己的 `~/.omp` | omp 只读写 `<userData>/omp`（决定 4 的六个环境变量一起处理）；`approvalHook` 不声明 → `installApprovalHook` 对 omp 不执行；`approvalEnv` 对 omp 不调用；进程 env 里**不出现任何标准 provider 变量名**（决定 13） |

### 2.2 共享文件里允许的改动（只许「加」）

| 位置 | 改法 | 为什么不算「影响」 |
|---|---|---|
| `shared/agentChat.ts` `CliAdapter` | 加可选：`transport?: 'acp'`、`auth?: 'cli-login' \| 'provider-key'`、`bundled?: true`、`quotaSource?: 'omp-usage'`、`detect(host?: HostPaths)`；`paramChange` 联合加 `'acp-config'`。**不加 `secretVarNames`**（静态字段装不下运行时才知道的 provider，见 §八 U.2） | 全部可选；旧 adapter 不写就是 `undefined`。**文件头那句「加第三个 CLI 时这个文件不该需要改」同 commit 改成「只允许新增可选的能力位，不许出现某个 CLI 独有的概念」** |
| `shared/agentChat.ts` `HostPaths` | 新类型 `{ isPackaged, resourcesPath, appPath, userData, home }`。**不放进 `StartOpts`**：restart / resume 路径的 `StartOpts` 由 `sessionState.ts` 的 `effectiveOpts` 从 `SessionRecord` 重建，那里没有 host——v2 的写法会让「隔一段时间再发一条」时 `ompBinPath(undefined)` 回 null | 只给 `detect()` 与 `AcpHostIo` 用 |
| `shared/agentChat.ts` `ChatEvent` | 加变体 `{ k:'capabilities'; models?; effortLevels? }`；`error.kind` 联合加 `'setup'` | 旧翻译器永远不产出。**`reduce.ts` 必须同 commit 改**（下一行） |
| `renderer/agentChat/reduce.ts` | ① `Notice.kind` 放宽成 `'auth' \| 'setup'`（`:386` 的 `kind: e.kind` 否则 TS2322）；② 加 `case 'capabilities'`，存进 `ChatView.capabilities?: {models?, effortLevels?}` | 已核实 `:397` 是 `default: break`（静默忽略）——**正因如此** `capabilities` 事件不加 case 就永远到不了工具栏。旧翻译器不产该事件，`ChatView.capabilities` 对 Claude/Codex 恒为 undefined |
| `shared/agentChat.ts` `CliInfo` + `cliList.ts` | `cliList.ts` 的 `buildCliList` 加三行透传：`auth: a.auth ?? 'cli-login'`、`bundled: a.bundled ?? undefined`、`transport: a.transport ?? undefined`。**`auth` 在这里给默认值**，不在 adapter 层留 undefined | 判据全部写成「`=== 'provider-key'` 走 omp，否则走旧路径」——缺省 = 老行为。v2 写的 `=== 'cli-login'` 对不声明的 Claude/Codex 恒假，会把它们的登录预检整个跳过（`AgentChatView.tsx:309` 的 `blockedByAuth` 恒假），那是直接踩红线的回归 |
| `shared/agentChat.ts` `SessionStats` / `SessionBrief.stats` | 新类型 `{ contextWindow?, contextUsed?, currency? }`（**不含 `costUsd`**：花费的唯一出口是 `tally.costUsd`，两处都放数据层会加两遍） | 可选字段 |
| `shared/quota.ts` | `QuotaSnapshot` 加 `omp?: CliQuota`、`ompAccountKey?: string`；`CliQuota` 加 `label?: string`；`src` 联合与 `SRC_RANK` 加 `'omp'`（`Record` 类型漏键 TS 会拦）；新增纯函数 `ompQuotaFromUsageJson(payload, provider, now)` | 可选字段 + 新函数 |
| `main/quotaStore.ts` | 新增 `readOmpQuota` / `replaceOmpQuota`；`registerQuotaHandlers` 里**有门地**注册 omp 的 tick | 不改 `merge` / `putWindow` / Claude 与 Codex 的三条 ingest |
| `renderer/layout.ts` L85 `cli?: 'claude' \| 'codex'` | 放宽为 `string` | 只是内存里的一次性传参（插件页 / 派活）。**它不落盘**，见决定 17 |
| `adapters/index.ts` | 数组**末尾**加一项 | 注册表设计本来就是「加一行」 |
| `session.ts` | 见 §五 T.1 的九处 | 逐条形状见那张表 |
| `AgentChatView.tsx` | L291 `cliAuth.check` 分支；L925 / L1150 面板分发；L445 默认选择规则；本地 auth state 类型放宽成 `Omit<CliAuthState,'cli'> & {cli?: string}`；`:908` 传 caps 时合并 `displayView?.capabilities`；`.ac-authgate`（`:1130-1141`）文案按 `auth` 分 | 全是加分支，旧分支体不动。**`shared/types.ts` 的 `CliAuthState` 不放宽**（它是 `cliAuth/*` 那面的身份类型），所以 `omp:status` 返回 `Omit<CliAuthState,'cli'>` |
| `ChatToolbar.tsx` | `:241` 的动作按钮判据从 `n.kind === 'auth'` 扩成 `(n.kind === 'auth' \|\| n.kind === 'setup') && onLogin`，文案按 kind（「去登录」/「去设置」） | 对话态里 `.ac-authgate` 不存在（只在空态 `:940` 起），`kind:'setup'` 在对话态必然发生（柜子 15 分钟自动锁 + 会话 2 小时回收）——没有按钮就是一条无出口的红字 |
| `QuotaBar.tsx` | 第三段 `<CliPart name={q.omp.label ?? …}>`；分隔符按有数据的段数拼 | 两处旧调用点不动 |
| `AgentOnboarding.tsx` | `:89` 的 `allChecked` 与 `:90` 的 `anyReady` 各并入一项 omp 状态；`:156-158` 文案加一句 | 决定 19。判据是「多一个来源」，Claude/Codex 那两项的查询与判定不动 |
| `main/prefs.ts` + `preload/index.ts` | `Prefs.omp` 要改**四处**：`Prefs` 接口、`getPrefs()` 的逐字段兜底（对象校验 + 三个字符串限长）、`prefs:set` 的 key 白名单加 `omp` 分支做形状校验、`PrefsSnapshot`。`prefs.ts:104-121` 的 `prefs:set` 对不在白名单的 key **静默返回旧快照**，`getPrefs()` 又逐字段重建——v2 只写 preload 那一处，结果是「界面显示已保存、重启归零」 | 只加分支 |
| `preload/index.ts` | 加 `api.omp.*` 域 | 只加域 |
| `main/index.ts` | `whenReady` 里 `registerAgentChatHandlers()` 之后加 `registerOmpSetupHandlers()`（仍在 `installIpcProfiler()` 之后） | 02 图纸的启动顺序硬依赖 |
| `package.json` | `extraResources` 末尾追加两条；`dist` / `dist:ci` / **`verify`** 链插脚本 | 六个既有条目、`asarUnpack` / `x64ArchFiles` / `mac.identity` 一字不动 |

### 2.3 明确**不动**的 19 处 `'claude' | 'codex'` 字面联合

2026-09-01 `grep` 实测（非测试文件）：`shared/types.ts` 的 `AgentKind`（L18）及其 14 个消费文件、
`PluginInfo.cli`（L717）、`CliAuthState` / `LoginState` / `InstallState`（L980/990/1004）、
`cliAuth/parse.ts` 的 `CliId`、`preload/index.ts` 的 `cliAuth.check/startLogin/startInstall`、
`CliLoginPanel.tsx` 的 `CliId`、`CliSetupPanel.tsx` 的 `TERMINAL_LOGIN`、`CanvasAgentBar.tsx` 的 `Kind`、
`DictHookBar.tsx` 的 `Target`——**一律不放宽**。**尤其不要把 omp 加进 `STATUS_ARGS` / `LOGIN_ARGS`**。

`AgentChatView.tsx` 三处 `as 'claude' | 'codex'` 强转（L291 / L925 / L1150）**不改字面**，改的是把它们
**留在** `auth !== 'provider-key'` 那个分支里。

### 2.4 与用户自装 omp 的隔离（六个环境变量）

- 用**自己包里的二进制**，不用 `PATH` 上的 `omp`；`buildArgs` 拿不到路径时**抛错**，绝不退回字面量 `'omp'`
- spawn env（正式会话、冒烟、`omp usage`、`omp models` **四处同一个组装函数**）：
  - 设：`PI_CONFIG_DIR=<相对 HOME 的 userData/omp>`、`PI_CODING_AGENT_DIR=<绝对 agentDir>`、`HOME=<host.home>`（与算相对路径用的 home **同源**——`agentRules.ts:41-43` 记着 `os.homedir()` 跟 `$HOME`、`app.getPath('home')` 不跟的分叉事故）、`OMP_SKIP_SETUP=1`
  - **删**：`OMP_PROFILE` `PI_PROFILE` `XDG_DATA_HOME` `XDG_STATE_HOME` `XDG_CACHE_HOME`（从拷贝的 env 对象上 `delete`，置空串不可靠——`x || default` 会回落）
  - `transport.test.ts` 加断言：spawn 的 env 里这五个键不存在、三个键存在
- 冒烟里加一条断言：起会话后 `<userData>/omp/agent/` 被建出来（配置目录没被改道）

## 三、系统边界：五个子项目

依赖顺序 P → T → E → U → D。P 与 T+E 可并行，其余串行。

| | 子项目 | 内容 | 可独立验证的方式 |
|---|---|---|---|
| **P** | 打包与配置 | `manifest.json`、`fetch-omp.mjs`、`check-omp-bundle.mjs`、`extraResources`、`omp/paths.ts`、`omp/config.ts`（产 `config.yml` / `models.yml` / skill 副本） | 打出的包里 `Resources/omp/omp --version` = 18.1.2；`codesign -dv --entitlements -` 见 allow-jit；连起两次会话后 `config.yml` 仍是我们的值 |
| **T** | ACP 传输层 | `omp/transport.ts`（**electron-free**）+ `omp/spawnEnv.ts`（允许 electron；组 spawn 整包） | `node --test`，假 ACP agent 回放 fixture |
| **E** | 事件与审批 | `ompEvents.ts` 异步化 + `abort()` + `endTurn({result}\|{error})` + `capabilities`、`omp/approvals.ts`、`resolveApproval` 兜底 | 24 条中 5 条按新契约重写、19 条一字不动；新增异步审批 / 超时 / abort / error 响应用例 |
| **U** | 引导链路 UI | `OmpSetupPanel.tsx`、`omp/setup.ts` IPC（本子目录唯一允许 import electron 的另一个文件）、工具栏吃 `capabilities`、`AgentChatView` 分支 | CDP 隔离实例：从「未配置」走到第一条回答 |
| **D** | 数据与额度 | `omp usage --json` 第三条通道、`QuotaSnapshot.omp`、`SessionStats`、额度条 / 花费显示 | 订阅模式看额度条；API key 模式看花费；两种都不编数 |

新文件全部放 `src/main/agentChat/omp/`（`ompEvents.ts` 留在原位），**不放 `adapters/`**——
`.claude/skills/agent-onboarding/scripts/check-adapter.mjs` 会把 `adapters/` 下每个非 adapter 文件当「没注册的 adapter」报警。

## 四、子项目 P：二进制分发与配置目录

### P.1 目录、清单、脚本

```
resources/omp/
├── manifest.json               # 入库：version + 每个 target 的 file / sha256 / url
├── THIRD-PARTY-NOTICES.txt     # 入库：上游随包的第三方声明（MIT 要求随分发附带）
├── mac-arm64/omp               # gitignore：fetch 脚本落盘，chmod 755
├── mac-x64/omp                 # gitignore
└── win-x64/omp.exe             # gitignore
```

| | |
|---|---|
| 子目录名 | **`<os>-<arch>`，`os ∈ {mac, win}`**——electron-builder 的 `${os}` 宏展开为 `mac` / `win`（`app-builder-lib/out/core.js:46-48` 的 `buildConfigurationKey`），`${arch}` 每个架构各展开一次（`platformPackager.js:136-141`）。按 `process.platform` 取名的后果：目录不存在时只 `log.warn('file source doesn't exist')`（`fileMatcher.js:271-274`）**不报错**，包照样打出来 |
| `manifest.json` | `{ version:'18.1.2', assets:{ 'mac-arm64':{file:'omp', sha256, url}, 'mac-x64':{…}, 'win-x64':{file:'omp.exe', …} }, notices:{sha256} }` |
| `scripts/fetch-omp.mjs` | 读 manifest；已存在且 SHA256 相同 → 跳过；否则下到 `.part`、校 SHA256（不符删掉 exit 1）、rename、posix `chmod 0o755`。**可执行位只能在这里保证**（`builder-util` 的 copyFile 只保留 mode），漏掉的症状是 spawn EACCES 且只在打包版出现。darwin 默认下 arm64 + x64 两份 |
| `scripts/check-omp-bundle.mjs` | 打包前硬拦：① `manifest.version === paths.ts 的 OMP_PINNED_VERSION`；② 本次构建需要的每个 target 存在、非空、SHA256 对、有 x 位；③ `package.json` 含 `{from:'resources/omp/${os}-${arch}', to:'omp'}` 且 `'omp'` === `OMP_RESOURCE_DIR`；④ NOTICES 条目存在；⑤ `--tools` 白名单里的每个名字都在 `OMP_BUILTIN_TOOLS` 常量里（该常量抄自 omp `tools/builtin-names.ts`，注释来源，进 13-矩阵） |
| `package.json` | `extraResources` 末尾追加 `{ "from": "resources/omp/${os}-${arch}", "to": "omp" }` 与 `{ "from": "resources/omp/THIRD-PARTY-NOTICES.txt", "to": "omp/THIRD-PARTY-NOTICES.txt" }`；新增 `"omp:fetch": "node scripts/fetch-omp.mjs"`；`dist` / `dist:ci` 在 `electron-vite build &&` 之后插 `npm run omp:fetch && node scripts/check-omp-bundle.mjs`；**`verify` 改成 `npm run build && npm run omp:fetch && node scripts/verify-app.mjs --seed`**——`verify-app.mjs:82` 起的是 `electron .`，走 `paths.ts` 的 dev 分支读 `resources/omp/<os>-<arch>/`，不拉就没有，阶段 3/4 的全部验收一步都走不了 |
| `.gitignore` | `resources/omp/mac-*/`、`resources/omp/win-*/` |
| CI | `build.yml` 不加步骤（fetch 在 `dist:ci` 链里）；`scripts/smoke.mjs` 加断言，**路径基准**：CI 传的是 `release/win-unpacked/Eas-Term.exe`，extraResources 落在 exe 同级的 `resources/`，即 `path.join(path.dirname(APP), 'resources', 'omp', 'omp.exe')`，不是 `Contents/Resources` |
| 本机首次拉取 | 260MB，先给 `github.com` / `objects.githubusercontent.com` 加 Clash DIRECT（`~/.claude/playbook/网络排障-代理卡死.md`） |

### P.2 签名与公证

- `@electron/osx-sign` 的 `walkAsync` 递归遍历 `Contents/` 全部文件、按内容判 Mach-O 并逐个签（`sign.js:163`、`util.js:150-181`），非主 app 文件用 `entitlementsInherit`（= `build/entitlements.mac.plist`，已含 `allow-jit` / `allow-unsigned-executable-memory` / `disable-library-validation`）+ hardened runtime + `--timestamp`（`MacTargetHelper.js:159-187`、`sign.js:228-250`）。ignore 列表只排除 `.kext` / PlugIns / 浏览器目录。**`afterPack.js` / `notarize.js` / entitlements 都不需要改**
- **本地 `npm run dist` 已带正式 identity**（`package.json` 的 `build.mac.identity` 是硬编码的 Developer ID，`afterPack.js` 读到 identity 非空直接 return），omp 会被一并签；与分发包的唯一差别是公证（`EAS_NOTARIZE=1`）。v2 那句「本地快包里 omp 未签」描述的是本仓库走不到的分支
- **必须真机验证的硬前提**：Bun 独立二进制被 Developer ID + hardened runtime 重签后能启动、公证接受。验法：`codesign --force --options runtime --timestamp --entitlements build/entitlements.mac.plist --sign "<identity>" omp && ./omp --version`。验不过整个 P 停下报告
- 每次本地打包都核：`codesign -dv --entitlements - "<app>/Contents/Resources/omp/omp"` 见 runtime flag + 三条 `cs.*`；`<bin> --version` 输出 `omp/18.1.2`

### P.3 运行时定位：`omp/paths.ts`（零 electron import）

```ts
export const OMP_PINNED_VERSION = '18.1.2'   // ↔ manifest.version
export const OMP_RESOURCE_DIR = 'omp'        // ↔ extraResources.to
export const OMP_TOOLS = ['read','bash','edit','write','grep','glob','todo','ask']   // ↔ omp tools/builtin-names.ts；**没有 ls**（不是工具名，validateToolNames 会抛）
ompBinPath(host: HostPaths): string          // 拿不到就 throw，绝不返回 'omp'
ompConfigDirRelative(home, userData): string // PI_CONFIG_DIR 用；path.join 会规范化 '..'，隔离实例的 tmpdir 可直接传（已核实 dirs.ts:110-112）
ompAgentDir(home, userData): string          // 绝对路径，PI_CODING_AGENT_DIR 用
```

- `HostPaths` 由 `session.ts` 算一次：给 `listClis` 的 `probeClis()` 传 `a.detect(host)`（**这是 `session.ts` 的第 9 处改动**——`:1023` 今天是无参 `a.detect()`，不传 host 则 omp 的 `available` 恒 false 且 `.catch(() => false)` 静默），给 `createAcpLive` 的 `AcpHostIo.host`
- `adapters/omp.ts` 的 `detect(host)` 在 `host` 为空时返回 false 不抛（`adapters.test.ts:152-156` 无参调用）
- 首次 spawn 前跑一次 `omp --version` 比对 `OMP_PINNED_VERSION`。**只跑 `--version`**；`omp acp` 会挂在 stdio 等 initialize，绝不能进 `cliContractRun.ts`（不加 omp）
- Windows：`path.relative(home, userData)` 跨盘符时返回绝对路径，`escaped` 判据按「盘符不同」；有了 `PI_CODING_AGENT_DIR` 绝对路径，agentDir 不再受此影响，只剩 `PI_CONFIG_DIR` 根（models.db 缓存等）要复核

### P.4 受管配置：`omp/config.ts`（纯函数产内容，`setup.ts` / `spawnEnv.ts` 落盘）

| 文件 | 内容 | 何时写 |
|---|---|---|
| `<agentDir>/config.yml` | 下表（YAML；点分键按 `.` 拆成嵌套，`settings.ts:165-178`）。**不生成 `settings.json`**；写之前删同目录的 `config.yaml`（两个候选按序命中） | **每次 spawn 前整份重写**。文件头注释「手改无效」 |
| `<agentDir>/models.yml` | `providers.<id>: { baseUrl?, api?, apiKey: "EAS_OMP_<ID>_KEY", models: [...] }`——**内置 provider 也写**（决定 13）；`apiKey` 写变量名不写值 | 用户在面板保存 provider 时 |
| `<agentDir>/skills/eas-term/*` | 决定 21：把随包的 `skills/eas-term/` **整个目录原样拷贝**（源头与 `agentRules.ts` 分发用的是同一份：`process.resourcesPath/skills/eas-term`，dev 时 `app.getAppPath()/skills/eas-term`），然后只对 `SKILL.md` 做一件事——在末尾追加下面这段。生成器不解析、不删改任何原文 | 每次 spawn 前（7 个小文件，代价可忽略） |
| omp 的 `secrets.yml` | **永远不写**（明文） | — |
| `<agentDir>/secret-placeholder.key` | omp 开了 `secrets.enabled` 后自己写；**升级 / 清理时不要删** | omp 自己 |

追加到 `SKILL.md` 末尾的那段（**唯一**的 omp 专属文字，围栏注释让它一眼可辨、也让生成器可幂等）：

```markdown
<!-- omp:begin ——由 Eas-Term 在每次起 omp 会话前追加，改原版请去 skills/eas-term/，别改这里 -->
## 本会话是 omp 底座，只有这一条不同
上面「触发情境 C」与工具表里的 `request_secret` / `secret_check` / `report_secret_invalid`
在本会话里**看得见但调不通**（它们按终端授权，这个会话不是终端）。缺 key、401/403、鉴权失败时：
直接告诉用户「在 AI 对话面板的设置里填 key」，不要调那三个工具，也绝不让密钥进对话。其余规则原样适用。
<!-- omp:end -->
```

`config.yml` 里配套两键：`skills.customDirectories: ['<agentDir>/skills']`；`skills.enableClaudeUser` **保持默认 true**（用户自己的其他 Claude skill 照常可见）。两处同名 `eas-term`（`~/.claude/skills/` 的原版与我们的副本）谁生效 → §14.2 第 7 条复核；若原版赢，加 `skills.ignoredSkills: ['eas-term']`。

`config.yml` 一期钉死的键（键名与默认值已在 omp 18.0.11 的 `settings-schema.ts` 逐个核实；18.1.2 拿到后复跑 grep）：

| 键 | 值 | 默认值 | 为什么 |
|---|---|---|---|
| `tools.approvalMode` | `always-ask` | **`yolo`** | 决定 6。命令行 `--approval-mode=always-ask` 再钉一次（`main.ts:1499-1502` 走 override，ACP 分支的 `applyAcpDefaultSettingOverrides` 不含它，保得住） |
| `tools.approval` | `{ generate_image: deny, browser: deny, computer: deny, tts: deny }` | `{}` | 第二道锁，逐工具 override 在每种模式下都生效 |
| `generate_image.enabled` / `speechgen.enabled` / `computer.enabled` | `false` | 已是 false | 显式写，防上游改默认 |
| `browser.enabled` | `false` | **`true`** | 唯一默认开着的 |
| `tools.xdev` | `false` | **`true`** | 关 `write` 的 `xd://` 转发后门 |
| `secrets.enabled` | `true` | `false` | 不开就没有脱敏：bash 跑一句 `env`，key 明文进会话记录并发给模型。脱敏按变量名含 KEY/SECRET/TOKEN 收（值 ≥8 字符）——所以我们的变量名带 `KEY`。**同时会把 `EAS_TERM_TOKEN` 脱敏成占位符**，这是期望行为（agent 不该拿到它） |
| `skills.customDirectories` | `['<agentDir>/skills']` | `[]` | 决定 21 的副本从这里进来；`enableClaudeUser` 不写（默认 true） |
| `retry.modelFallback` | `false` | **`true`** | 用户选了哪个模型就是哪个。这是真的在改行为 |

**项目层会盖全局层**：`settings.ts:1292`「global → project → overrides; project wins over global」，项目层来源**包含用户项目里的 `.claude/settings.json`**（`:212-218`、`:913`），每个 `session/new` 按 cwd 重算（`main.ts:416`）。`--approval-mode` 走 override 层不受影响；`tools.approval.*` 与 `secrets.enabled` **没有命令行兜底**——§14 第 3 条要在**带 `.claude/settings.json` 的真实项目**里验一次，验不过就用 `--config=<我们的 config.yml>` overlay（`omp --help` 有这个 flag，overlay 层级要一并验）。

### P.5 安装包体积（要用户知情）

当前 `Eas-Term-0.4.72-x64.zip` 133MB。加 omp 后：mac 每包 **+40～85MB**（Bun 二进制在 dmg/zip 里的压缩率未测），Windows **+50～100MB**。
服务器 14G 可用，`KEEP=2` 不动，每版多占 0.3～0.5G。`publish-site.sh` 的 `df` 只打印不拦。**先在验收会上把这个数摆出来，用户点头再合并 P。**

## 五、子项目 T：ACP 传输层

### T.1 两个新文件，`session.ts` 九处改动

`omp/transport.ts` —— **electron-free**（不 import `electron` / `mcpBridge` / `secrets` / `approvalRoute` / `hookInstall` / `claudeEvents` / `codexEvents` / `slashSilence` / `cliAuth`；错误类不用 TS 参数属性，node 26 strip-only 下 `constructor(public x)` 直接 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。它拥有：`proc`、`rpc`（帧 + 请求表 `id → {method, resolve, reject, timer}`）、`phase: 'spawning'|'initializing'|'ready'|'prompting'|'dead'`、`sessionId`、`translator`（**只造一次，restart 复用**——`stats()` 的累计在它的闭包里，重建就归零，团队面板同一行会出现 `tally.costUsd = $1.2` 而 `stats` 为空）、`approvals`、`queue`。

`omp/spawnEnv.ts` —— **允许 import electron / mcpBridge / secrets**。组出 `{ bin, args, env, cwd }` 整包，经 `AcpHostIo.spawnSpec()` 传进 transport。`mcpBridge.ts:12` import electron、`:21` import `approvalRoute`——transport 若自己组 env 就把这条禁止的边拉进来了。

`AcpHostIo`（由 `session.ts` 提供）：`{ emit: (e) => handleEvent(live, e), log: logSession, version: app.getVersion(), host: HostPaths, spawnSpec: () => SpawnSpec, waitDecision }`。`handleEvent` / `emitEvent` 是模块私有、`live` 在 IPC 闭包里造，transport 只能经这条注入通道拿到它们。

`Live` 加 `acp?: AcpLive`，**spawn 成功即刻创建**（`phase:'spawning'`）。

`session.ts` 的九处（2026-09-02 行号；形状分三类）：

| # | 位置 | 形状 | 内容 |
|---|---|---|---|
| 1 | `agentChat:start` L1072 组 `Live` | 对象展开，旧 adapter 展开空对象 | `...(adapter.transport === 'acp' ? { acp: createAcpLive(adapter, hostIo) } : {})`。`translator` 照旧赋值（omp 的 `createTranslator()` 回 `push()` 永远 `[]` 的占位，满足 `adapters.test.ts`；真翻译器在 `live.acp.translator`） |
| 2 | `deliverMessage` L642 `endSilence()` 之后、L643 `planSend` 之前 | **if-return** | `if (live.acp) return acpDeliver(live, message)`。三条消息入口（start / send / 手机端）的汇合点 |
| 3 | `restartAndDeliver` **函数第一行**（L495，在 `if (live.proc) { killing=true; kill() }` **之前**） | **if-return** | `if (live.acp) return acpRestart(live, planSend(live.rec, Date.now()).opts, message)`。放在 kill 之前，`acpRestart` 自己决定怎么收尾旧进程（先 `session/close` 再 kill）。v2 放 L507 会让旧进程先被裸 SIGTERM，`close` 没机会发。`effectiveOpts` 未导出，用导出的 `planSend(...).opts` |
| 4 | `agentChat:setParams` L1118 `getAdapter` 之后、L1119 `paramChange==='slash'` 之前 | **if-return** | `if (adapter?.paramChange === 'acp-config' && live.acp) return acpSetParams(live, clean)`。**`acpSetParams` 在 `set_config_option` 成功后就地回写 `live.rec.model / effort`**——slash 分支 `:1109-1113` 的注释钉死了同一个坑（不回写，空闲回收后 restart 悄悄退回旧模型、界面还显示新的） |
| 5 | `agentChat:interrupt` L1208 | if-return | `if (live.acp) return acpInterrupt(live)`：发 `session/cancel` → 等 prompt 响应 ≤3s → `turnDoneOf(result)` → `phase='ready'`、**不 kill**；等不到才退回 kill + 合成 `turn.done` |
| 6 | `agentChat:stop` L1234，`live.proc?.kill()` 之前 | 可选链，旧会话 no-op | `live.acp?.close()`（发 `session/close` 不等，随后照旧 kill） |
| 7 | `agentChat:resolveApproval` L1150–1156 | 短路，陌生 id 右侧空操作 | `{ ok: resolveApprovalGlobal(aid, d, '') \|\| resolveAcpApproval(aid, d) }` |
| 8 | `listSessionBriefs` L865 | 可选链 | `stats: live.acp?.translator.stats()` |
| 9 | `listClis` 的 `probeClis()` L1023 | 加参数，旧 adapter 忽略 | `await a.detect(host)` |
| 9′ | `handleEvent` L378 | 条件，旧 adapter 恒真 | `if (getAdapter(live.rec.cli)?.quotaSource !== 'omp-usage') scheduleApiRefresh()`——不加门，omp 每轮都去刷 Claude 账号的额度接口；Anthropic / OpenAI 的 usage 端点按 IP 限流（omp `sqlite-credential-store.ts:40-42` 注释），同一 IP 上多打是实打实的风险 |

§12.1-5 的事件序列基线要点名比对 #1 #6 #7 #8 #9′ 这五处 no-op 改动。

### T.2 spawn 与 env（`spawnEnv.ts`）

```
bin  = ompBinPath(host)                               // 拿不到 throw
args = ['acp', '--approval-mode=always-ask', `--tools=${OMP_TOOLS.join(',')}`]
env  = scrub({ ...PROBE_ENV,
               ...mcpEnv({ project: cwd }),           // 正式会话带；冒烟不带
               PI_CONFIG_DIR, PI_CODING_AGENT_DIR, HOME: host.home, OMP_SKIP_SETUP: '1',
               ...secretsEnv(names) })                // 放最后，覆盖用户 rc 里的同名变量
scrub = delete OMP_PROFILE / PI_PROFILE / XDG_DATA_HOME / XDG_STATE_HOME / XDG_CACHE_HOME
```

- `names = ompSecretVarNames(prefs.omp)`，**每次 spawn 现算**（`['EAS_OMP_<PROVIDER>_KEY']`）。三道门，缺一就推 `{k:'error', kind:'setup', message}` **不起进程**：① `names.length > 0`（否则「还没选 provider」）；② `secretsHas(names)` 全部 `inVault && readable`（否则「还没填 key」）；③ `secretsEnv(names)` 非空（`secrets.ts:330-334` 锁定态返回 `{}` 且 `secretsHas` 故意不反映锁态——两者合起来就是「柜子锁着」，**不加任何 `secrets.ts` 导出**）。不拦的后果：omp 的 `resolveConfigValue` 把 `models.yml` 里的变量名字面量当 key 发出去 → 401 → 用户去改一把根本没被用到的 key
- `secretsEnv` **必须传显式名单**——但这只保证**密钥柜**不整组外泄；env 的其余部分来自 `PROBE_ENV`（= `process.env` 全量），`AWS_*` / `DATABASE_URL` 照样进 omp 进程，与 Claude/Codex 今天一致。所以 `secrets.enabled` 那道脱敏是**必须真机验证**的（阶段 3）
- **不调** `installApprovalHook`、**不调** `approvalEnv`、**不注入** `ELECTRON_RUN_AS_NODE`；`askFirst` 忽略（omp 有真硬拦截，附 `ASK_FIRST_PROMPT` 用户会被问两遍）
- `--tools` 与 `--approval-mode` 在 `omp acp` 下**真生效**（`commands/acp.ts:17-34` 走完整 `parseArgs`；`main.ts:1318-1323` / `:1499-1502`），且未知工具名**抛 `CliUsageError`**（`args.ts:336-344`，调用点 `main.ts:463-471` 在建会话闭包里）——v2 说的「静默吞」是错的，后果反而更硬：名单里有一个错名字，每次 `session/new` 都失败
- stdout 由 transport 自己按行切；stderr / exit / error 三个回调**逐字照抄** `wireProc` L439–487 的三条判据 + `logSession`（注释指回，13-矩阵同步项）。**exit / error 只认闭包里自己的 `proc` / `rpc`**：`if (live.proc === proc) live.proc = undefined`，`phase='dead'` 只在 `live.acp.rpc === rpc` 时写——否则空闲回收 `kill()` 后同步清了 `live.proc`、exit 还没到，这个窗口里用户发消息起了新进程，旧 exit 会把新的清掉 → 孤儿进程
- exit 时 `const wasBusy = live.rec.busy === true` **先取出来**；`wasBusy` 且不是我们杀的 → 先推 `turn.done(usage 全 0)` 再落 `ended`；只在 `phase ∈ {ready, dead}` 时自己报「omp 进程退出（code N）」，握手期与 prompt 期交给对应 Promise 的 catch 报一条（含 stderr 尾 20 行）

### T.3 握手与会话建立

1. `initialize { protocolVersion:1, clientCapabilities:{ fs:{readTextFile:false, writeTextFile:false}, terminal:false, elicitation:{form:true} } }`。**`elicitation.form` 必须声明**（不声明 omp 直接拒掉工具）。`auth` 不用声明：`acp-agent.ts:630-673` 只用 `auth.terminal` **追加**一种认证方式，`newSession`（`:687-700`）没有任何鉴权检查
2. 首次 `session/new { cwd, mcpServers }`；恢复 **`session/resume { sessionId, cwd, mcpServers }`**（不用 `session/load`：`:702-712` 会 `#replaySessionHistory`；`:731-740` 不会）。**resume 的响应里没有 `sessionId`**（只有 `configOptions` / `modes`），`session.ready` 用请求里那个（= `SessionRecord.resumeId`）。resume 失败命中 `ACP session not found` → 清 `resumeId`、改发 `session/new`、推 `{k:'error', fatal:false}` 说明上下文已丢
3. 响应里的 `configOptions`（数组）：`find(o => o.id === 'model')` 没有 → 推 `{k:'error', kind:'setup'}`（没配 provider）；有 → `{k:'capabilities'}` + `{k:'session.ready', model: currentValue}`
4. **下发用户选的模型 / 强度**：`planSend(live.rec, now).opts` 的 `model` / `effort` 与 `currentValue` 不同 → 在**第一条 prompt 之前**发 `session/set_config_option {configId:'model', value}` / `{configId:'thinking', value}`；握手期排队的 `setParams` 与这一步合并只发一次
5. 握手期到达的消息进 `queue`；`phase==='prompting'` 时**本地排队**（omp 内部也排队：`acp-agent.ts:175` `promptQueue`、`:897-909`），不拒收——Claude 今天 busy 时也接受，同一界面两个 CLI 行为要一致。仍保持「同一时刻只有一个 `session/prompt` 在飞」
6. `session/prompt` 响应就是这一轮的终点（`agent_end` 在内部消费，`:1462-1472`：先 `usage_update` 再回响应；**ACP 流里不会出现 `sessionUpdate==='agent_end'`**）

`mcpServers`：读 `agentMcpConfigPath(live.rec.pluginId)` 那份 JSON，**过滤 + 归一**：只取有 `command` 的条目；`env` 一律写成 `Object.entries(r.env ?? {}).map(([name,value]) => ({name,value}))`（**哪怕是 `[]`**——`#toNameValueMap` 无条件遍历，省略就 TypeError）；http/sse/url 型条目丢弃并推一条 `{k:'error', fatal:false}`「omp 会话暂不支持这个插件的 MCP」。`session/new` 失败时按 `error.message` 里有没有我们传进去的 server 名分两类：命中 → 「MCP 桥没起来」+ 关掉扩展能力重试的出口，并用 `mcpServers: []` 重发一次；否则才是 `kind:'setup'`。ACP 的 `McpServer` 默认 `type:'stdio'`（`#toMcpConfig` 第一分支 `'command' in server`），`mcpCapabilities{http,sse}` 是额外能力

### T.4 帧、请求表、超时

- 每行一个 JSON；有 `method` 无 `id` → 通知 → `translator.push`；有 `method` 有 `id` → 服务端请求 → `translator.push` 回 `{events, reply: Promise}`，reply resolve 后写回 stdin；无 `method` 有 `id` → 我们请求的响应；不认识的 `method` 回 `-32601`
- 超时：`initialize` / `session/new` / `session/resume` 30s；`set_config_option` 10s；`session/prompt` **不设**；`session/cancel` 等响应 ≤3s；`close` 不等

### T.5 生命周期（与 CC 对齐的地方、不同的地方）

| 事件 | CC 今天 | omp |
|---|---|---|
| 空闲回收 | **2 小时**（`IDLE_TIMEOUT_MS`，2026-08-20 从 15 分钟改的；team 3 分钟、busy 4 小时），`reapIdleSessions` L763 | 三档一概沿用，不新增常量。下次发消息 → `acpDeliver` 见 `phase==='dead'` → `acpRestart` → `session/resume` |
| 用户按「停」 | kill + 合成 `turn.done` | 决定 12：cancel、等响应、进程留着 |
| 改模型 / 强度 | slash 或 pending→restart | `set_config_option` 即时生效，回写 `rec`；握手期排队，**不产生 `pending`** |
| 进程异常退出 | exit 判 interrupted → 团队自动恢复 | 同一套判据（照抄）；一期 omp 不是团队成员 |
| 每轮结束 | `scheduleApiRefresh()` | 加门（T.1 #9′） |

## 六、子项目 E：事件翻译与异步审批

### E.1 `ompEvents.ts` 要改的八处，`ompEvents.test.ts` 要改的五条

| # | 改动 |
|---|---|
| 1 | `ApprovalDecider` → `(req) => Promise<'allow'\|'deny'>`；`push()` 回 `{ events, reply: Reply \| Promise<Reply> \| null }`；`approval.request` 立刻产出，`approval.resolved` 经 `onEvent(cb)` 出口延后产出 |
| 2 | **两通道时序配对**（决定 9）：待决表里一个单槽 `lastDecision {tool, command?, decision, at}`，`request_permission` settle 时写入；`elicitation/create` 到达时若槽内 `tool` 与 message 首行的 `Allow tool: <name>` 匹配、`Command:` 文本与 `rawInput.command` 匹配、且在 30s 内 → 消费并清空、自动回 `{action:'accept', content:{value:'Approve'\|'Deny'}}`；否则按 `kind:'tool'`、title = message 首行、detail = message **单独弹卡**（`write` 工具不在 `PERMISSION_REQUIRED_TOOLS = bash/edit/delete/move` 里，只走内层审批，**只来 elicitation 一条**——这是常态不是反序） |
| 3 | `abort()`：清 `turnOpen`、丢弃未收口的文本缓冲（不产 `text.done`）、**对每个未 settle 的条目产 `approval.resolved{deny}`**、清待决表。interrupt / 进程 exit / restart 三处调用 |
| 4 | `turn.start` 由会话层推（`deliverMessage` L654 / L660 今天就推；`acpDeliver` 照做），翻译器的 `openTurn` 删掉（它一旦置起不复位，只生效一次） |
| 5 | `endTurn({result} \| {error})`：`error` 分支先 flush `text.done`，再产 `{k:'error', fatal:false, message}` + `turn.done(usage 全 0)`，复位轮次 |
| 6 | `text.done` 只按 `agent_message_chunk.messageId` 收口；`agent_thought_chunk` 是另一个 `messageId`（fixture 5–7 行 vs 14–21 行） |
| 7 | `createOmpTranslator(decide, cwd)` 收 `cwd`，`approval.request.cwd` 填它（现在 `:155` 是 `? '' : ''` 的死三元，卡片少「在哪跑」那一行） |
| 8 | `usage_update` 分支加 `currency`（`acp-agent.ts:2150-2159` 恒为 `'USD'`）；`OmpSessionStats` 改名 `SessionStats`，**去掉 `costUsd`**（花费经 `turn.done.costUsd` 进 `tally`，唯一出口） |

`fromConfigOptions(opts: ConfigOption[])`：`find(id==='model')` / `find(id==='thinking')`，显式忽略 `id==='mode'`。

要改的五条既有测试（其余 19 条一字不动）：`:101-105`「要自己合成 turn.start」→ 改成断言不产；`:234-243` 的 `seq[0] === 'turn.start'` → 去掉；`:92-99`「request 后紧跟 resolved」→ 改成从 `onEvent` 收；`:19-32` `runAll` → async 并 `await reply`；`:49-74` 四条读 `r.result` → 读 awaited reply。

### E.2 待决审批表 `omp/approvals.ts`

- 条目 `{ approvalId, rpcId, decision?, abandoned }`；`approvalId` 三种：`request_permission` 有 `toolCallId` → `<liveId>:<toolCallId>`；无 → `<liveId>:rpc-<id>`；elicitation 单独弹卡 → `<liveId>:elic-<id>`（渲染层对 `approvalId` 的用法只有 `ApprovalCard.tsx:51` 变化键与 `MessageList.tsx:109/327` 传参，带冒号安全，已静态核实）
- **完成判据 = 决定已作出**（不是「两条都回」——拒绝后第二通道不来）。`approval.resolved` **无论来自用户点击、5 分钟超时兜底还是 `abort`，都产且只产一次**
- 只借 `approvalRegistry` 的形状，不实现它的接口；`onApprovalSettled` 遍历各会话的 `live.approvals.resolve()` 对陌生 id 是空操作（`approvalRegistry.ts:65-70`），不会误伤
- 超时 5 分钟 → deny，常量 `ACP_APPROVAL_TIMEOUT_MS` 自己定义、注释指向 `approvalRoute.ts` 的同名值。**omp 侧对两条通道都无限等**（`acp-client-bridge.ts:114-152` 无 timer；`wrapper.ts:331` 不传 `dialogOptions`），5 分钟安全，不必真机等满
- `reduce.ts:126` 单槽位：并发第二条先排队，**上一条的决定作出后**再 emit
- 只回 `allow_once` / `reject_once`

### E.3 `turn.done` 的合成

transport 收到 `session/prompt` 响应时 `emit(turnDoneOf(result, translator.stats()))`；`stopReason:'cancelled'` 也产出。`usage_update` 绝不丢；`available_commands_update` / `session_info_update` 丢弃（resume 后 50ms 会推这两条，`#scheduleBootstrapUpdates`）。

## 七、adapter 与能力声明

`src/main/agentChat/adapters/omp.ts`：

```ts
export const ompAdapter: CliAdapter = {
  id: 'omp', displayName: 'Oh My Pi',        // 产品名待定
  transport: 'acp', auth: 'provider-key', bundled: true, quotaSource: 'omp-usage', paramChange: 'acp-config',
  capabilities: { models: [], effortLevels: [], compact: false, contextUsage: true, approval: ['exec','patch','tool'] },
  // 没有 approvalHook；没有 sandboxLevels
  detect: async (host) => !!host && existsSync(safeBinPath(host)),   // host 为空 → false，不抛
  createTranslator: () => ({ push: () => [] }),                        // 占位，真翻译器在 live.acp.translator（文件头写明）
  buildArgs: (opts) => { throw … }  // 不用：spawn 整包由 spawnEnv.ts 组；这里只满足接口，实现为返回 { bin:'<unused>', args:[], stdin:'pipe' } 并在 adapters.test.ts 加断言「omp 的 buildArgs 不是 spawn 依据」
}
```

- `adapters.test.ts` **只新增**两条：「声明 `bundled` 的排在未声明的之后」「omp 的 `detect()` 无参不抛且为 false」
- **注册（`index.ts` 加一行）与 transport 分支必须在同一个 commit**：注册了而 `session.ts` 没有分支，`restartAndDeliver` 会照常 spawn 然后 `writeStdin` 写 Claude 格式，整轮无声挂死；手机端 / 团队派活取第一个可用 CLI 没有选择器可绕
- `compact:false`（omp 不认 `/compact`，声明 `native` 会让按钮按下去永远转圈——`deliverMessage` 先推 `turn.start` 再投递，非致命 error 收不了它）

## 八、子项目 U：引导链路

### U.1 状态机（面板只认 `CliInfo.auth === 'provider-key'`）

```
柜子不可用(available=false / foreign) ─▶ 只显示一句话 + 关闭
柜子未建 ─▶ 建柜 ─▶ 柜子锁着 ─▶ 解锁 ─▶ 未配 provider ─选─▶ 未填 key ─填(进柜)─▶ 未选模型 ─选(omp models --json)─▶ 冒烟中 ─▶ 就绪
                                   ▲                                                                            │
                                   └── 冒烟失败：显示 omp 原话 ────────────────────────────────────────────────┘
任意步收到 secrets:locked、或窗口 focus 时重查 status 发现锁了 ─▶ 回「柜子锁着」，保留草稿
```

- 新组件 `features/agentChat/OmpSetupPanel.tsx`，照 `CliSetupPanel` 骨架复制；**不改** `CliSetupPanel.tsx` / `CliLoginPanel.tsx`；同一时刻只能有一个设置灯箱
- 主进程 `omp/setup.ts` 独立 IPC 域：`omp:status`（返回 `Omit<CliAuthState,'cli'>`）、`omp:saveProvider`、`omp:smoke`、`omp:listModels`（`execFile(bin, ['models','ls','--json'])`，同一个 env 组装函数，超时 8s）。**这是第三条不走 `fsGuard` 的写通道**：落点 `path.resolve` 后必须仍在 `ompAgentDir` 之内，provider id 只允许 `[a-z0-9-]+`——登记进 13-矩阵「刻意不走 fsGuard 的写通道」表（原文写着「多出第三条即红旗」，所以要**改那句话**）。登录预检不得 await 进 `agentChat:start`
- `AgentChatView.tsx`：① L291 `if (selected.auth !== 'provider-key') { …cliAuth.check… } else { api.omp.status() }`；② L925 / L1150 `setupFor.cli.auth === 'provider-key' ? <OmpSetupPanel/> : <CliSetupPanel …/>`（`:197` 的 `installCli` 入口同样经这里分发）；③ L445 默认规则；④ `.ac-authgate` 文案按 `auth`：`provider-key` 显示「**{displayName}** 还没配好。选一个模型服务商、填一把 key 就能开始 —— 全程在这里完成。」按钮「去设置」。`omp:saveProvider` 成功后调导出的 `refreshCliCache()`

### U.2 provider 与 key

| 步骤 | 做法 |
|---|---|
| provider 列表 | 一期写死：Anthropic、OpenAI、智谱（omp 内置 `zai`，env 名 `ZAI_API_KEY`）、DeepSeek（非内置，走 `models.yml` 的 `baseUrl`）。每项 `{id, label, keyUrl, builtin, baseUrl?, api?, models?}`；`baseUrl` / `api` / 模型 id 逐个按官方文档核对 |
| 变量命名 | **`EAS_OMP_<PROVIDER>_KEY`**，内置 provider 也用它（决定 13）。理由：① `secrets:save` 变量名全局唯一（`secrets.ts:1039-1055`），标准名会撞用户柜里已有的；② 名含 `KEY` → omp 自动脱敏；③ 进程树里不出现任何标准名，嵌套的 `claude` / `codex` 看不见 |
| key 落地 | `secrets:save { name:'omp · <provider>', vars:[{varName, value}], autoInject:false }`；已有同名组 → 传 `id` 复用。**不写 `auth.json`、不写 omp 的 `secrets.yml`** |
| 柜子状态 | 渲染层 `secrets.status()` 拿 `locked / available / foreign`（`SecretsStatus` 三个字段都有）；主进程侧锁态用 T.2 第 ③ 道门推断，**不给 `secrets.ts` 加 export**。`secrets.onLocked` 只覆盖**闲置自动上锁**（`secrets:lock` 手动上锁不广播），面板在窗口 `focus` 时重查一次（`AgentOnboarding.tsx:77-88` 有先例） |
| 冒烟失败分类 | 不复用 `cliAuth/detect.ts` 的 `unauthedInLine`（预过滤只认 Claude/Codex 的 `"type"` 字段）。`setup.ts` 自写 `authFailureInTail(lines)` 对 JSON-RPC `error.message` / stderr 做 `/401\|unauthori[sz]ed\|invalid.?api.?key\|authentication_error/i`；真录 401 当 fixture |
| `lastSmoke` | 只当展示用，**不做预判**（`secrets:save` 改 key 不动 `createdAt`，没有 `updatedAt`，指纹核不出「换错了」）。真会话第一轮命中 401 → 状态打回「未填 key」并弹 `OmpSetupPanel` |
| 订阅登录 | 一期不做 GUI，**也不预填任何命令**：omp 没有 `login` 子命令，未知词会被 `resolveCliArgv` 改写成 `launch login` 起一个烧 token 的对话。面板一句「订阅登录二期接入」。二期候选入口：`omp setup` 向导（那时**不能带 `OMP_SKIP_SETUP`**）或 `omp acp` 的 terminal-auth flag（`modes/acp/terminal-auth.ts`），以 18.1.2 实测为准 |

### U.3 冒烟

- **走和真会话同一个 spawn 组装函数**：先 `omp/config.ts` 整份重写 `config.yml`，env 含 `PI_CONFIG_DIR` + `PI_CODING_AGENT_DIR` + `HOME` + `OMP_SKIP_SETUP=1` + scrub 五个键 + `secretsEnv(names)`，**只减去 `mcpEnv`**（冒烟不该拿到 MCP 桥凭证）。`--tools` 钉最小集 + 审批全 deny 是第二道锁不是唯一一道。不带 `PI_CONFIG_DIR` 会读写用户的 `~/.omp`；不带 `OMP_SKIP_SETUP` 会撞交互向导挂 60s
- `cwd` 用 `os.tmpdir()` 下的空目录；`session/prompt "请只回复两个字：你好"`；看到 `text.delta` 就算过；超时 60s；失败贴 omp 原话；自建 slot，不借 `cliAuth` 的 `loginSlot`
- 冒烟后断言：`<userData>/omp/agent/config.yml` 存在且 `tools.approvalMode === 'always-ask'`（配置目录没被改道、我们的值没被吃掉）
- 选定的 `{provider, model, thinking}` 存 `prefs.omp`（四处，§2.2）；`agentChat:start` 的 `model` 传 `<provider>/<model>`
- 订阅 `onSmokeProgress` **必须在** `omp.smoke()` 调用之前挂上（同一 effect 内先订阅再 invoke）

### U.4 工具栏

- 模型 / 强度下拉：`AgentChatView:908` 传 `caps={displayView?.capabilities ? {...selected.capabilities, ...displayView.capabilities} : selected.capabilities}`，`ChatToolbar` 不改（判的是 caps 内容）
- 「压缩」不渲染（`compact:false`）；审批 chip / 卸载按钮不渲染（无 `approvalHook`）
- `kind:'setup'` 的 notice 有「去设置」按钮（§2.2 `ChatToolbar` 行）

## 九、子项目 D：数据接口与额度

### D.1 现在就能拿到的（进 `turn.done`）

| 数据 | 来源 | 落点 | 语义 |
|---|---|---|---|
| 单轮 token | prompt 响应 `usage{inputTokens, outputTokens, cachedReadTokens}` | `turn.done.usage` | 单轮。`inputTokens` **不含**缓存——Anthropic 与 OpenAI 两条主干口径一致（`anthropic.ts:2070-2074`、`openai-shared.ts:451-453`），不只智谱 |
| 上下文占用 | `usage_update.size` / `.used` | `turn.done.usage.contextRatio`（有分母才填，封顶 1） | 当前。`formatUsage` 不读它、`tally` 不累加它——**数据层从 `SessionBrief.stats` 拿**（v2 引的那句「内核零处填写」注释已过期：`claudeEvents.ts:258` 已经在填） |
| 花费 | `usage_update.cost.amount`（> 0 才出现） | `turn.done.costUsd` → `tally.costUsd` | 会话累计，与 Claude 同语义。**resume 后延续不归零**（cost 从会话条目重算，`session-manager.ts:187-268`）；compaction 若重写会话文件可能缩水 → §14 |

### D.2 为数据层预留的结构

`SessionStats { contextWindow?, contextUsed?, currency? }`；`SessionBrief.stats` 从 `live.acp?.translator.stats()` 来（**translator 跨 restart 复用**，T.1）。花费只有 `tally.costUsd` 一处。

### D.3 订阅额度（第三条通道）

- `readOmpQuota()`：`execFile(bin, ['usage','--json'], { env: 同一组装函数, timeout: 8000 })`；失败静默 null。**不加 `--redact`**，但落盘前白名单裁剪
- `ompQuotaFromUsageJson(payload, provider, now)`：
  - **先过滤**：只保留 `scope.tier === undefined`（或 `scope.shared === true`）且 `window?.durationMs` 为有限正数的行——Anthropic 一份 report 里 `anthropic:7d` / `7d:opus` / `7d:sonnet` 全是 `WEEK_MS` 并列（`claude.ts:638-668`），按「最长窗口」挑会随机挑到 Opus 子额度；`anthropic:extra` 没有 `window`、`unit` 是 usd，会把美元超支显示成百分比
  - provider 选择：`prefs.omp.provider` 那个；该 provider 无 report → 不显示 omp 段（不退化到别的）
  - `percent`：照抄 omp `resolveUsedFraction` 的四级优先（显式 `usedFraction` > `used/limit` > `unit==='percent'` 的 `used/100` > `1-remainingFraction`，`ai/src/usage.ts:118-131`，13-矩阵同步项）
  - `resetsAt = floor(window.resetsAt / 1000)`（omp 是 ms）；`windowMinutes = durationMs/60000`；`src:'omp'`；`label:'omp · <provider>'`
  - `severity`：`'ok'→'normal'`、`warning`/`exhausted` 原样、`unknown`/缺失不写
  - 最短窗口 primary、最长 secondary；只有一条就只填一条；`reports:[]` → null
- 写入 `replaceOmpQuota(q, accountKey)`：reports 非空 → `snapshot.omp` **整段替换**（去重比 primary/secondary 的 percent+resetsAt+at）；`ompAccountKey`（`metadata.accountId` 或 email 的 hash）不一致 → 先丢掉旧的再写；reports 为空或失败 → 保持原样
- 触发：omp 会话 `turn.done` 后 debounce 2s + 最小间隔 **6.25 分钟**（`USAGE_REPORT_TTL_MS = 5min` 带 ±25% 抖动）。定时 tick **有两道门**：`ompAdapter.detect(host)` 为 false 时不注册；只有上一次读到非空 reports 才继续轮询，连续 3 次空就停掉定时器只留 turn.done 那条路——否则只用 Claude 的用户升级当天起每 10 分钟被拉起一个 128MB 进程去打必然失败的网络请求
- 原始 payload 另存 `<userData>/omp-usage.json`，**白名单裁剪**：`{ provider, fetchedAt, limits:[{id, label, window, amount, status, notes}], resetCredits, notes }` + 顶层 `capacity`，**剔掉 `metadata` 与 `scope` 里的 accountId / projectId / orgId / email**；`site/privacy.html` 写「本机会存一份 omp 的额度快照，不含账号邮箱」
- 同一个 Anthropic 账号在 Claude Code 与 omp 各登一份：一期分开显示、段名带来源
- `QuotaBar.tsx` 第三段；`verify-app.mjs` 播种的旧 `quota.json` 没有 `omp` 键 → `has(q.omp)` 走 `liveCells(undefined)` → 不渲染，已核实

### D.4 明确不做

- 不解析 omp 会话文件；不把 `cost` 换算成额度百分比；不预跑 `omp usage invalidate`；`--history` 二期

## 十、图纸与跨文件同步（**按阶段挂进各阶段的验收行，不许 `[skip-arch]`**）

`hooks/arch-guard.mjs` 真的挂在本仓库 `.claude/settings.json` 的 PreToolUse(Bash) 上：`new-module` 规则对新增 `scripts/*.mjs` 与 `src/**/*.ts` 的提交 exit 2，`ipc-register` 规则对 `registerXxxHandlers()` 命中。每个阶段的 commit 都会被挡，图纸必须随阶段走。

| 阶段 | 图纸 | 内容 |
|---|---|---|
| 1 · P | `10-模块领地图.md` 打包坑段 | `resources/omp/`（⛔ 分发产物、二进制不入库、源头 `manifest.json` + `fetch-omp.mjs`） |
| 1 | `01-系统上下文.md` | 构建期出站 `fetch-omp.mjs` → GitHub Releases（**先改图再出站**，01:116 红线 4）；运行时 omp 连用户所选 provider；`omp usage` 出站到各 provider |
| 1 | `03-agent角色边界.md` 3B | ② `extraResources.to` ↔ `OMP_RESOURCE_DIR`；③ `PI_CONFIG_DIR` 相对 HOME、`PI_CODING_AGENT_DIR` 绝对、五个键必须 scrub；⑦ 受管配置写 `config.yml`，写 `settings.json` 只生效一次；⑧ `--tools` 名单里一个错名字 = 每次 `session/new` 失败 |
| 1 | `13-所有权矩阵.md` | ⑤ `OMP_PINNED_VERSION` ↔ `manifest.version` ↔ CHANGELOG；⑨ `OMP_TOOLS` ↔ omp `builtin-names.ts`；⑩ `ompBinPath` / env 组装函数有四个调用点（transport 会话、冒烟、`omp usage`、`omp models`） |
| 2 · T+E | `03` 3B | ① `session.ts` 三处 if-return **必须在旧逻辑之前**（`restartAndDeliver` 在 kill 之前）；⑤ `session/resume` 不用 `session/load`；⑥ `secretsEnv` 必须传显式名单 |
| 2 | `13` | ① `secretsEnv` 第二调用点 ↔ `secretsForRun` 闸门；② `mcpEnv` 三处；④ `ACP_APPROVAL_TIMEOUT_MS` ↔ `APPROVAL_TIMEOUT_MS`；⑥ exit 三条判据 ↔ `wireProc`；⑦ `shared/agentChat.ts` 文件头判据；⑪ `resolveUsedFraction` 抄本 ↔ omp `usage.ts` |
| 2 | `11-MCP工具网络.md` | `agentMcpConfigPath` 的第三个消费者：transport 过滤归一后转成 `session/new.mcpServers` |
| 2 | `12-skill与hook流程.md` | omp 会话不装 hook、不打 `EAS_AGENT_CHAT_SESSION`；审批走 ACP 双通道时序配对 |
| 3 · U | `02-分层架构.md` | 启动链图在 `registerAgentChatHandlers()` 之后插 `registerOmpSetupHandlers()`（仍在 `installIpcProfiler()` 之后），注明不参与「MCP 桥 → 密钥柜 → PTY」硬依赖链 |
| 3 | `10` 主进程表 | `agentChat/omp/` 子域各文件；`quota` 子域到 `omp/paths.ts` 的跨域引用 |
| 3 | `13` | ③ `Prefs.omp` **四处**；⑧ `omp/setup.ts` 是第三条不走 fsGuard 的写通道（改掉「多出第三条即红旗」那句） |
| 3 | `14-验证与调试.md` | 更专脚本表加 omp 判据、`verify-agent-chat-ui.mjs` 状态更新；`npm run verify` 前置「先 `npm run omp:fetch`」；收尾纪律加「omp 子进程按 pid 杀，绝不 `pkill -f omp`」 |
| 4 · D | `13` | 额度链路；`ompAccountKey` ↔ `claudeAccountUuid` 同一纪律 |
| 5 | `CHANGELOG.md` / `site/privacy.html` / 下载页 | 「随包分发 oh-my-pi 18.1.2（MIT），许可见 `Resources/omp/THIRD-PARTY-NOTICES.txt`」；额度快照不含邮箱；体积说明 |

## 十一、由事实导出的七处主动偏离

**① omp 不是「另一个 Claude Code」，审批有两条通道且只能靠时序配对。** `elicitation/create` 不带任何关联键。
**② 「额度」对 omp 分两种模式**——但「API key 模式没有额度」只在已实测的 provider 上成立（§14 第 6 条）。
**③ 同步审批决定器是缺陷不是简化**，且 `abort` / 超时都要产 `approval.resolved`。
**④ 安装包要大 40～85MB。**
**⑤ omp 不能默认排第一。**
**⑥ `session/load` 不能用**；`session/resume` 的响应没有 `sessionId`。
**⑦ `write` 模式不是「写要问」而是「写不问」**；`always-ask` 才是。

## 十二、实施阶段与验收

### 12.1 隔离证明（每个阶段都跑）

1. `git diff --stat main -- <§2.1 零改动清单>` 为空；`cliList.ts` 的 diff 只允许三行透传
2. `node --test` 全绿；`git diff --stat main -- '**/*.test.ts'` 只出现新增文件 + `ompEvents.test.ts` + `adapters.test.ts`（后者只有新增 test 块）
3. 词边界 grep 为空：`grep -rnE "(^|[^A-Za-z0-9_])(omp|acp)([^A-Za-z0-9_]|$)" src/main/agentChat/claudeEvents.ts src/main/agentChat/codexEvents.ts src/main/agentChat/adapters/claude.ts src/main/agentChat/adapters/codex.ts`（v2 那条不带词边界的判据在干净 main 上就有 31 行：`compact` / `completed` 含 `omp`）
4. `scripts/verify-agent-chat.mjs` 加**传递** import 检查（解析 import 图）：`omp/{paths,config,transport,approvals}.ts` + `ompEvents.ts` + `adapters/omp.ts` 禁 `electron` 与六个文件；`omp/setup.ts` / `omp/spawnEnv.ts` 只禁六个文件、允许 `electron`
5. **隔离基线**（阶段 0.5，**已落地**）：`src/main/agentChat/isolationBaseline.test.ts`（真录 CLI 输出 → 翻译器 → 事件流）＋ `src/renderer/src/features/agentChat/isolationBaseline.test.ts`（事件流 → 归约器 → 视图）。两个单层文件，靠一份 JSON 传递，不 import 对方（两个 tsconfig 都是 `composite`，跨层 import 会 TS6307，修它要动共享配置）。手写组补齐真录盖不到的 7 个 `ChatEvent` 变体（`error` 带 kind、`approval.*`、`compacted`、`user.message`、`turn.start`、`text.delta`）与归约器几处注释专门写过的行为（notice 去重计数、`MAX_NOTICES` 溢出、fatal 收轮、pending 单槽、`trimmedFromHead` 算术）。**变异测试验过它真能抓**：改翻译器字面量、改 notice id、丢掉 `error.kind` 三处都当场红。不起 CLI、不连网，几十毫秒，已在 `npm test`（因而 `npm run check`）里。
   **它盖不到的**：`session.ts` 的九处分支是运行时的，这份基线只覆盖翻译器与归约器 —— 那九处要靠 §12.2 阶段 2 的 `transport.test.ts` 与阶段 3 的 CDP 验收。
   **两个旧脚本的实际状态**（2026-09-02 实测，别再按 spec v2 的假设排期）：`verify-agent-chat-ui.mjs` 的 `main.tsx` 补丁已删（改传 `EAS_VERIFY=1`），补丁/构建/启动/CDP/`__store` 注入这一半修好了，但它的 DOM 判据整体陈旧（等 `.ac-empty` 超时，要找的 `.ac-logo` 在代码库里已不存在），**仍跑不到断言**；`verify-agent-chat.mjs` 依旧写死 `cli:'claude'`、没有 interrupt/stop，且会真花额度。两者都不是阻塞项 —— 隔离证明已由上面那条基线承担。
6. 二进制缺席：dev 隔离实例改名 `resources/omp/<os>-<arch>/`，打包产物改名 `Contents/Resources/omp`，两处都要求 omp `available:false` 且 `error` 说得清楚，Claude / Codex 逐条一致

### 12.2 阶段

| 阶段 | 做什么 | 验收 |
|---|---|---|
| 0（已完成） | `ompEvents.ts` + 24 测试 + fixture + 评估报告 | `613255f` |
| 0.5（已完成） | 隔离基线两个测试 + 快照；删掉 `verify-agent-chat-ui.mjs` 的 main.tsx 补丁（改传 `EAS_VERIFY=1`）；14 图纸如实记下两个旧脚本的状态 | `npm run check` 全绿（1429 条）；三处变异测试当场红 |
| 1 · P | `manifest.json`、`fetch-omp.mjs`、`check-omp-bundle.mjs`、`.gitignore`、`extraResources`、`omp:fetch` + `verify` 链、`paths.ts`、`config.ts`、`smoke.mjs` 断言、图纸 | 手动 codesign 真二进制后 `--version` 能跑；`npm run dist`（**用户点头后**）产物里 `Resources/omp/omp --version` = 18.1.2、`codesign -dv --entitlements -` 见 allow-jit；**18.1.2 上重录 fixture（含收费模型的 `cost`）**，`ompEvents.test.ts` 全绿；**连起两次会话后 `config.yml` 仍是我们的值** |
| 2 · T+E | `transport.ts`、`spawnEnv.ts`、`approvals.ts`、`Live.acp`、九处改动、decider 异步、`abort()`、`endTurn({error})`、`capabilities` + `reduce.ts` case、`ompAdapter` + 注册（同 commit）、图纸 | `transport.test.ts`：①握手顺序 ②审批 5 分钟超时回 deny **并产 resolved** ③cancel 后 ≤3s 收到 `turn.done` 且进程存活 ④resume 期间零事件、`session.ready.sessionId` 非空 ⑤bash 的两通道只弹一次卡、`write` 只来 elicitation 单独弹卡 ⑥prompt 回 error 也产 `turn.done` ⑦exit 只清自己的 proc ⑧握手期 setParams 不产 pending ⑨审批挂起时 interrupt → `approval.resolved(deny)` → pending 为 null ⑩deny 后队列放行下一条 ⑪start 带 model → 第一条 prompt 前有一条 `set_config_option` ⑫坏 MCP 条目被过滤、`session/new` 失败后降级重试 ⑬spawn env 五个键不存在、三个键存在 ⑭restart 后 `stats()` 不归零 ⑮busy 时连发两句都得到回答；12.1 全过 |
| 3 · U | `setup.ts`、`OmpSetupPanel`、`AgentChatView` 四处、`ChatToolbar`、`Prefs.omp` 四处、`layout.ts`、`AgentOnboarding` 三处（决定 19）、skill 副本生成器（决定 21）、图纸 | CDP：新装 → 选智谱 → key 进柜（隔离 userData）→ `omp models --json` 列模型 → 冒烟（断言 `config.yml` 存在且 `always-ask`、`<userData>/omp/agent` 被建出来）→ 发 `echo hi` → **审批卡在任何文字之前出现**（omp 是 registry→IPC→卡片链路的第一个生产用户）→ 允许 → `exec.done ok` → **让模型新建一个文件 → 卡片先出现 → 拒绝后文件不存在** → 切 thinking → 下一轮生效且 pid 不变 → **在带 `.claude/settings.json` 的真实项目里**让模型「画一张图」→ 无 `tool_call` → 让模型跑 `env` → 会话记录里 key 是占位符 → 故意不填 key 起一轮 → 面板打回「未填 key」且文案可读 → 柜子锁着时发消息 → 红字带「去设置」按钮 |
| 4 · D | `readOmpQuota`、`ompQuotaFromUsageJson` + 测试（含 Anthropic 5h+7d+7d:opus+7d:sonnet+extra 的 fixture，断言 secondary 是 `anthropic:7d`）、`replaceOmpQuota`、`ompAccountKey`、`SessionStats`、额度条、`omp-usage.json` 裁剪、图纸 | API key 模式：`turn.done.costUsd` 只增不减；订阅模式：有数据额度条出现、没数据不出现；`omp-usage.json` 里 grep 不到 email；只用 Claude 的隔离实例里 omp 的 tick 不注册 |
| 5 | CHANGELOG、privacy、下载页、发版 | `publish-site.sh` |

### 12.3 真机验证纪律（沿用）

- 只在 `npm run verify` 起的隔离实例上验；**不用 `npm run dev`**；第一次验收前先 `npm run omp:fetch`（260MB，先加 Clash DIRECT）
- 密钥柜、冒烟一律在隔离 userData 里；`PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` 随 userData 走，隔离是自动的（已核实 `..` 相对路径可用）
- 杀进程只认 `node_modules/electron/dist` 或 9333 端口；omp 子进程按 pid 杀，**绝不 `pkill -f omp`**

## 十三、不在本次范围

- 团队成员用 omp、灵动岛显示 omp 会话、历史面板读 omp 会话文件（按 `AgentKind` 分支）
- 订阅登录 GUI 与其终端入口（omp 无 `login` 子命令，入口以 18.1.2 实测为准）
- 用户手选 CLI 的持久化（`persist.ts:85` 今天对 Claude/Codex 也不落盘 `cli`，补它是新增行为，三处一起改：`persist.ts` / `canvasSlice.ts:238-244` / `tabsSlice.ts:39-58`）
- 手机端验收；omp 的 `plan` 模式、`fork`、`session/list`、`/compact`、`--history`
- 把 omp 暴露成终端里可用的 CLI；`secret_check` / `request_secret` 对 omp 会话生效；Claude 的 `contextWindow` 暴露给数据层

## 十四、已核实的结论 与 实现前必须复核的七处

### 14.1 已核实（源码依据，v2 里列为待复核的 14 条中有 11 条定案）

| 结论 | 证据 |
|---|---|
| `PI_CONFIG_DIR` 接受 `..` 相对路径；隔离实例的 tmpdir 可直接传 | `dirs.ts:110-112` `path.join(os.homedir(), name)`，join 规范化 `..` |
| `reduce.ts` 对未知 `k` 静默忽略——所以 `capabilities` **必须加 case** | `reduce.ts:397` `default: break` |
| agent pane 的 `cli` 不落盘，没有会洗掉它的 sanitize | `persist.ts:85` 只写 `{kind, cwd, resumeId}` |
| P.4 六个键存在；`tools.approval` 按 `tool.name` 查、不校验 builtin，deny 在每种模式下生效 | `settings-schema.ts:4045/4061/4260/4270/4307/4486/4670/5250/1813/2493`；`approval.ts:133-158` |
| `--tools` / `--approval-mode` 在 `omp acp` 下生效；未知工具名**抛错** | `commands/acp.ts:17-34`、`main.ts:1318-1323 / 1499-1502`、`args.ts:336-344` |
| `initialize` 不声明 `auth` 也直通 | `acp-agent.ts:630-673 / 687-700` |
| omp 对两条审批通道无自身超时 | `acp-client-bridge.ts:114-152`、`wrapper.ts:331` |
| `mcpServers` 接受 stdio；`env` 必填数组 | `acp-agent.ts:2689-2697 / 2716-2722` |
| `session/resume` 不重放、响应无 `sessionId` | `acp-agent.ts:702-712 / 731-740` |
| `omp models --json` 存在 | `cli-commands.ts:135-139`、`models-cli.ts:199-206` |
| cost 在 resume 后延续 | `session-manager.ts:187-268 / 2037-2039` |

### 14.2 仍要真机 / 外部验的七处

| # | 假设 | 怎么核 | 错了怎么办 |
|---|---|---|---|
| 1 | Bun 独立二进制 Developer ID 重签 + hardened runtime 后能启动、公证接受 | P.2 手动 codesign 命令 | 硬前提，整个 P 停下报告 |
| 2 | 18.1.2 上 `always-ask` 下两通道的形状与 18.0.11 fixture 一致（bash 两条、`write` 只一条 elicitation、edit 是否两条） | 阶段 1 重录 fixture 时每种工具各录一次 | 按新形状改 E.1 #2 的配对规则 |
| 3 | 用户项目的 `.claude/settings.json` / `.omp/config.yml` **不能**盖掉我们全局层的 `tools.approval.*` 与 `secrets.enabled` | 在项目里放一条 `tools.approval.generate_image: allow` 起会话画图 | 用 `--config=<config.yml>` overlay 并验其层级高于项目层 |
| 4 | Bun 二进制最低 macOS 版本与 app（跟 Electron 37 走）有交集问题 | 查 Bun 官方要求 | UI 上对 omp 显示「需要 macOS ≥ N」 |
| 5 | compaction 重写会话文件后 `usage_update.cost` 是否缩水 | 触发一次 compaction 后看 `costUsd` | 只影响显示，记 hazard |
| 6 | 纯 API key（非 OAuth）下 `omp usage --json` 对已配 provider 是否回 reports（zai 有 `/api/monitor/usage` 适配器） | 配好智谱 key 后跑一次 | 若回：§十一 ② 改措辞，D.3 的显示分支按数据来不来判，不按模式判 |
| 7 | `skills.customDirectories` 里的 `eas-term` 副本与 `~/.claude/skills/eas-term` 原版同名时，omp 用的是副本（决定 21 的前提） | 起会话问「凭证卡住怎么办」，回答里应出现「在设置里填 key」而不是 `request_secret` | 加 `skills.ignoredSkills: ['eas-term']`；仍不行就把副本目录改名 `eas-term-omp`（frontmatter 的 description 保持原文，触发不变） |

---

**下一步**：决定表 21 条已全部拍板（2026-09-02）。阶段 0.5（修基线工具）与阶段 1（P，打包）先行，阶段 2（T+E）随后；`npm run dist` 与合并 P 之前把 §P.5 的体积数摆给用户看一次。
