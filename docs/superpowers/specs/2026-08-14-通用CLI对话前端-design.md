# 通用 AI CLI 对话前端

**日期**：2026-08-14
**范围**：在 Eas-Term 里新增一个不依赖终端的 AI 对话界面，逻辑对齐 Kimi Code；
并把软件的默认入口从分屏改为画布。
**技术依据**：`docs/cli-headless-接口实测.md`（真跑出来的接口行为，**本设计的每一条技术判断都以它为准**）

---

## 用户原话

> 新做一个通用前端，逻辑和 kimi code 一致，在没有输入对话的时候是一个 logo 加一个居中的可输入
> 对话框，然后用户可选择 cli 类型，用户输入对话并发送的时候，根据用户选择的 cli 进行对应 cli 的
> 启动，然后画面变为一个全篇幅的对话框，下方是会话框，发送，以及一些常用和 cli 通用的功能，
> 比如模型切换，上下文显示，一键压缩上下文，模型的 effort，这些前端选择后通过给用户单次发送
> 后面注入后缀的形式进行任务请求，以达成前端选项的目的，对话界面专注于用户的本体内容以及模型
> 返回的文字内容，执行内容在 AI 返回文字内容下用弱视觉层级默认显示三行随着任务推进滚动刷新的
> 小字，用户也可以点击展开查看完整的执行返回，画面聚焦对话文字本身
>
> 软件打开逻辑，默认进画布，画布没有任何 frame 的时候，画布上显示双击开始你第一个项目吧，
> 用户创建后，打开第一个项目的 frame，默认打开的是新做的前端

补充（同一轮对话中）：

> 有时候用户可能在 GUI 菜单里调整模型和 effort，这个点要考虑到
>
> 这个前端窗口要考虑后期新增 cli 的兼容性
>
> 语音输入按钮、模型和 effort 发送 CTA 常驻

---

## 一、已拍板的决定

| # | 决定 | 理由 |
|---|---|---|
| 1 | **工具调用走前端原生审批卡片**，不是预设权限模式 | 这是让这个前端能真正替代终端的前提；只选沙箱级别的话，危险操作只能靠模式粗档挡 |
| 2 | **一期同时做 Claude Code 与 Codex 两个 adapter** | 中间事件模型必须被两种真实格式检验，否则会长成只适配 Claude 的形状 |
| 3 | **会话中途改模型/effort → 下一条消息生效**，不打断当前任务 | `--model` / `--effort` 是启动参数，中途改不了；重开会截断正在跑的活 |
| 4 | **会话进程常驻 + 空闲超时回收** | 实测起一个会话到能干活要数秒，每轮重启手感很差；但常年不回收会随开的节点数线性吃内存 |
| 5 | **底部常驻四件**：语音输入、模型、effort、发送 CTA；上下文细条与压缩按钮次级 | 用户明确指定 |
| 6 | **UI 代码里不允许出现按 CLI 名字的分支** | 「通用」成立与否的唯一判据 |

## 二、由 spike 事实导出、对用户原描述的两处主动偏离

**① 审批卡片不使用弱视觉层级。**
用户要求「执行内容用弱视觉层级三行小字」。待审批项虽然属于执行内容，但它是唯一会
**卡住任务、必须人动手**的东西，埋进三行小字等于没有。故：执行流中出现待审批时，该条
升为高层级卡片（显示要跑的命令 / 要改的文件 + 允许 / 拒绝），处理完塌回小字。

**② 失败与被拒的执行项常驻可见，不塌回小字。**
实测记录（见接口实测文档「三个坑」第 1 条）：`Write` 被拒后，模型最后一句是
「已创建完成。」而文件根本不存在。**若把失败埋进小字，用户看到的就是一句谎话加一片安静。**
故失败项保持可见，且执行结果一律以事件为准渲染，不采信模型的文字陈述。

## 三、系统边界：三个子项目

依赖顺序 A → B → C，各自独立成计划。

| | 子项目 | 内容 | 可独立验证的方式 |
|---|---|---|---|
| **A** | 会话内核 | 中间事件模型、Claude adapter、Codex adapter、会话生命周期、审批事件的缝合 | 纯逻辑：喂真实 JSONL 样本进 adapter，断言产出的中间事件。无需 UI |
| **B** | 对话界面 | 空态、消息流、执行三行折叠、审批卡片、底部工具栏 | 只面对 A 的一种事件模型；喂造好的事件序列即可渲染 |
| **C** | 启动逻辑 | 默认画布、空 frame 提示、默认落 agent 节点 | 最小；改 viewMode 默认值与空态渲染 |

**本文档是三个子项目共同的设计依据**；实现计划分别撰写。

---

## 四、子项目 A：会话内核

> **⚠️ 本节是实施前的设计，已于 2026-08-15 完成实施，其中几条被实测推翻了。**
> **读代码与下面这两份，不要照本节的技术细节做判断：**
> - 实际接口行为：`docs/cli-headless-接口实测.md`（真跑出来的）
> - 实施期的 15 条裁定与理由：`docs/superpowers/rulings/2026-08-14-会话内核-裁定.md`
>
> 已知被推翻的四处：
> 1. **A.3 说「`--include-partial-messages` 必须有」** —— 实测它的增量在 `stream_event` 类型里，
>    当前翻译器不处理，开着纯浪费，**已摘掉**（Ruling 1 与 Task 9 探针）
> 2. **A.3 说审批「两路按 `tool_use_id` 缝合」** —— 实测流里的 hook 事件**只有 `hook_id`**，
>    两路无共同关联键，**缝不了**。审批完全由 hook 路单独驱动（Ruling 4）
> 3. **A.4 说 Codex 走 `app-server`** —— 该协议是 Codex 桌面应用的整个后端（93 个类型、
>    5 种决定集互不相同的审批、v1/v2 并存），成本远超收益。**这一期走 `exec --json`**
>    并报 `approval: []`（Ruling 5；详细评估见 `docs/codex-app-server-协议探针.md`）
> 4. **A.2 的 `CliAdapter` 接口已扩展**：加了 `buildArgs` 返回的 `stdin`、`createTranslator()`、
>    `approvalHook?`、`capabilities.sandboxLevels`（Ruling 9 / 10 / 最终评审 I6）
>
> 另有一条设计当初完全没考虑到、由最终评审发现：往用户项目装阻塞式 hook 必须
> **显式问 + 能卸载 + 写前备份**（仓库既有规矩），后两件 A 已补，「显式问」见 §五 B.4（Ruling 15）。


### A.1 中间事件模型

放 `src/shared/agentChat.ts`（主进程与渲染层共用）。**这套事件里不允许出现任何
CLI 特有的概念**（不能有 `hookEventName`、不能有 `thread_id` 这种只有一边有的字段）。

```ts
export type ChatEvent =
  | { k: 'session.ready'; sessionId: string; model: string; cwd: string }
  | { k: 'text.delta'; text: string }
  | { k: 'text.done'; text: string }
  | { k: 'thinking'; tokens: number }
  | { k: 'exec.start'; execId: string; label: string; detail: string }
  | { k: 'exec.done'; execId: string; ok: boolean; output: string }
  | { k: 'approval.request'; approvalId: string; kind: 'exec' | 'patch' | 'tool'
      title: string; detail: string; cwd: string }
  | { k: 'approval.resolved'; approvalId: string; decision: 'allow' | 'deny' }
  | { k: 'turn.done'; usage: Usage; costUsd?: number }
  | { k: 'error'; message: string; fatal: boolean }

export interface Usage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  /** 上下文占用比例 0~1。两边算法不同，由各 adapter 自己算出来交上来 */
  contextRatio?: number
}
```

`exec.start` 的 `label` 是给三行小字用的一句话（例：`编辑 auth.ts`、`运行 npm test`），
`detail` 是展开后看的完整内容。**由 adapter 负责把各自的原生结构压成这两个字段**，
UI 不做解析。

### A.2 能力声明与 adapter 接口

放 `src/main/agentChat/adapters/`，一个 CLI 一个文件；注册表在 `adapters/index.ts`。

```ts
export interface CliCapabilities {
  models?: { id: string; label: string }[]
  effortLevels?: { id: string; label: string }[]
  compact?: 'slash' | 'native' | false
  contextUsage: boolean
  /** 空数组 = 这个 CLI 做不了逐次审批，UI 退回显示沙箱级别选择 */
  approval: ('exec' | 'patch' | 'tool')[]
}

export interface CliAdapter {
  id: string
  displayName: string
  capabilities: CliCapabilities
  detect(): Promise<boolean>
  start(opts: StartOpts): Promise<SessionHandle>
  resolveApproval(sessionId: string, approvalId: string, decision: 'allow' | 'deny'): void
}
```

**UI 只读 `capabilities` 渲染控件。** 某 CLI 没有 `effortLevels` → 不渲染 effort 控件；
`approval` 为空 → 不渲染审批卡片。加第三个 CLI 时 UI 一行不改。

### A.3 Claude adapter

启动（依据实测，各参数缺一不可）：

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --strict-mcp-config --include-hook-events --include-partial-messages
       --model <id> --effort <level>
       [--resume <sessionId>]
```

- `--verbose` 必须有，否则 stream-json 不完整
- `--strict-mcp-config` 去掉用户全套 MCP 的噪音（实测工具数 124 → 31）
- `--include-hook-events` 必须有，否则前端看不见审批开始/结束
- `--include-partial-messages` 必须有，否则**只有整段 `text.done`、没有 `text.delta`**，
  打字机效果无从谈起。（该参数的实际分块粒度**未经 spike 验证**，见 §九）
- **不能用 `--bare`** —— 实测它会跳过认证，直接返回 `Not logged in`
- 不重定向 stdin：它是送消息的通道

多轮：往 stdin 逐行写 `{"type":"user","message":{"role":"user","content":"..."}}`，
每轮以 `{"type":"result"}` 结束。实测同一进程内会话保持，无需每轮 resume。

**审批**（这是 Claude 侧唯一可行的路，实测确认）：

1. 会话启动前，在**项目的** `.claude/settings.json` 写入 PreToolUse hook，
   指向 Eas-Term 自带的一个小脚本（随包分发，路径由主进程算出）
2. 脚本从 stdin 收到 `{session_id, cwd, tool_name, tool_input, ...}`
3. 脚本 **POST 给 Eas-Term 已有的 MCP bridge**（`src/main/mcpBridge.ts`，已在 127.0.0.1 监听），
   带上这些字段 —— **不新造通道**
4. 主进程据此发出 `approval.request`，前端弹卡片；脚本**阻塞等待**响应
   （实测阻塞 4 秒后返回 allow，文件真的被创建）
5. 用户点击 → 主进程回给脚本 → 脚本 stdout 输出
   `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"deny","permissionDecisionReason":"..."}}`

`permission-mode` 一律用默认，**绝不能用 `manual`** —— 实测它是直接拒绝而非等待审批。

流里的 `system:hook_started` / `hook_response` 用来给 UI 标记「正在等审批 / 审批已出结果」，
但**审批的内容来自 hook 脚本那一路**，两路要按 `tool_use_id` 缝成同一个 `approval.request`。

噪音过滤：用户机器上的 `SessionStart` hooks 会产生大量 hook 事件（实测 5 个 hook、10 条事件），
**必须按 `hook_event === 'PreToolUse'` 过滤**。`system:thinking_tokens` 极密集，
按 200ms 节流后再转成 `thinking` 事件。

### A.4 Codex adapter

走 `codex app-server`（**不是 `exec --json`** —— 后者只有沙箱级别，做不了逐次审批）。

- 协议 schema 由 `codex app-server generate-json-schema --out <DIR>` 生成（实测 39 个文件），
  TypeScript 绑定由 `codex app-server generate-ts` 生成
- 审批原生支持：`CommandExecutionRequestApprovalParams`（含 `approvalId` `command` `cwd`
  `reason` `threadId` `turnId`）与 `ApplyPatchApprovalParams`（含 `callId` `fileChanges`
  `grantRoot` `reason`），响应各自只需一个 `decision`
- 用量从 `turn.completed.usage` 读（含 `cached_input_tokens` / `reasoning_output_tokens`）

**该协议标着 experimental。** 实现时若发现协议与本文档描述不符，以实际协议为准并回来更新本文档；
`exec --json` 作为退路保留（退路模式下 `capabilities.approval` 报空数组，UI 自动退回沙箱级别选择——
这正是能力声明机制要覆盖的情形）。

### A.5 会话生命周期

- 一个 agent 节点对应一个会话，一个会话对应一个常驻进程
- **空闲超时回收**：**15 分钟**无交互则杀掉进程，保留 `sessionId`/`threadId`；
  下次发送时用 `--resume` / `thread` 无感接上。
  取 15 分钟的依据：resume 一次的代价就是一次冷启动（实测数秒），而人离开工位十几分钟
  多半不会马上回来；这个值放在 adapter 之外的会话管理层，是**一个常量、一处定义**
- **改模型或 effort**：不动当前进程，只记下待生效参数，UI 上标注「下条起生效」；
  下一次发送时以新参数重开并 resume（决定 3）
- 应用退出 / 节点关闭：杀进程，会话 id 落盘，重开可续

---

## 五、子项目 B：对话界面

> **本节已按子项目 A 的实际落地校正（2026-08-15）。** A 实施过程中有几条前提变了，
> 下面标了「⚠️ 校正」的地方与最初设想不同，**以这里为准**。

新增节点类型 `{ kind: 'agent'; cwd: string; sessionId?: string }`（`src/renderer/src/layout.ts`）。
空态与对话态是**同一个节点的两个阶段**，不是两个组件。

### B.0 A 实际提供的接口（B 只能用这些）

`window.api.agentChat`：

| 方法 | 用途 |
|---|---|
| `start(params)` | 起会话，返回 `{ok, sessionId}`。**内部已在 resolve 时开始缓冲事件**，不会丢首事件 |
| `onEvent(sessionId, cb)` | 订阅 `ChatEvent`，订阅时先回放缓冲再转实时 |
| `send(sessionId, message)` | 发一条消息 |
| `setParams(sessionId, {model?, effort?})` | 改模型/effort，**下一条消息才生效**（决定 3） |
| `resolveApproval(approvalId, decision)` | 回传审批决定 |
| `stop(sessionId)` | 结束会话 |
| `hookStatus(cwd)` / `hookUninstall(cwd)` | 审批 hook 的状态与卸载（B.4 要用） |

CLI 列表与能力从 adapter 注册表读：`capabilities.models / effortLevels / compact /
contextUsage / approval / sandboxLevels`。**UI 只读 capabilities，不允许出现按 CLI 名字的分支。**

### B.1 空态

居中：logo + 输入框 + CLI 选择器。CLI 选择器的选项来自 adapter 注册表中
`detect()` 通过的那些 —— 没装的不显示。

### B.2 对话态

- 对话区只渲染两种东西：用户消息、模型文字（`text.done`）
- **⚠️ 校正：没有打字机效果。** 最初设想里模型文字靠 `text.delta` 逐字流入，实测证明
  Claude 的增量在 `stream_event` 类型里（`event.delta.text_delta.text`），而当前翻译器不处理它、
  `--include-partial-messages` 也已摘掉（开着会白花钱：每 token 一行 JSON 被解析后丢弃）。
  **`text.delta` 目前零生产者。** UI 按「整段到达」设计，不要等一个永远不来的事件；
  想要打字机效果，得先在 A 那层实现 `stream_event` 的解析（路径已记录在
  `docs/cli-headless-接口实测.md`），那是独立的一件事
- **执行区**挂在每段模型文字下方：默认三行、随 `exec.start` / `exec.done` 滚动刷新、
  弱视觉层级小字；点击展开完整执行历史（`detail` 与 `output`）
- **例外一**：`approval.request` 到达 → 该条升为高层级卡片，展示 `title` / `detail` / `cwd`
  与「允许 / 拒绝」；`approval.resolved` 后塌回小字（§二 ①）
- **例外二**：`exec.done` 且 `ok === false` → 该条常驻可见，不随滚动移出（§二 ②）
- **⚠️ 新增：`{ k:'error', fatal:false }` 必须显示出来，不能只写 console。**
  这条事件目前唯一的用途，就是在审批 hook 装不上时告诉用户「**本次会话的工具调用不会弹审批卡片，
  将按默认权限直接执行**」。执行期裁定（Ruling 14）选择了「告知而非阻断」，而那条裁定的
  全部说服力都压在「用户会看见」上 —— **界面不显示，它就是一句空话**。这是 B 的硬验收项

### B.3 底部工具栏

**常驻**：语音输入按钮（复用 `features/voice/VoiceButton`，并遵守既有的
`stopVoiceOnSend` 约定）、模型选择、effort 选择、发送 CTA。

模型与 effort 的选项来自 `capabilities`；改动后按决定 3 标注「下条起生效」。
一键压缩：`capabilities.compact === 'slash'` 时作为一条用户消息发送 `/compact`。

**⚠️ 校正：上下文占用只显示累计 token 数，不显示百分比。**
最初设想是一根「过半才显现」的占用细条，需要 `Usage.contextRatio` 作分母。
实测确认 `turn.done` 的 usage 里**没有上下文窗口上限**，算法未定，A 层**一律不填这个字段**
（spec §九 第 4 条：宁可少显示，也不要显示一个看起来精确、实则猜的比例）。
所以：显示 `inputTokens` / `outputTokens` / `cachedInputTokens` 与 `costUsd`（有则显示），
**不要编造百分比**。等窗口上限的取法确定后再加细条。

**⚠️ 新增：`capabilities.approval` 为空时，工具栏要显示沙箱级别选择**（读 `sandboxLevels`）。
这是 Codex 这一期的形态（走 `exec --json`，只有三档沙箱、没有逐次审批）。
**这不是为 Codex 写的特例分支** —— UI 判的是「`approval` 空不空」，不是「是不是 Codex」。

### B.4 审批 hook 的知情与卸载（⚠️ 新增，Ruling 15 划给 B）

审批功能要往**用户项目**的 `.claude/settings.json` 写一个 `matcher:'*'` 的 PreToolUse hook。
仓库对这类侵入早有规矩（见 `src/main/agentHook.ts` 开头）：**必须显式问、必须能一键卸、
写之前必须备份**。A 已经做完后两件（写前备份 + `hookStatus`/`hookUninstall` 两个 IPC），
**「显式问」这一件是 B 的**：

- 第一次要在某个项目里装这个 hook 时，**先问用户**，讲清楚它做什么、影响范围是这个项目
- 某处（设置面板或 agent 节点的菜单）能看到当前项目装没装，并能一键卸载

不做这一条，等于我们在用户项目里留了个他不知道、也关不掉的阻塞式 hook。

## 六、子项目 C：启动逻辑

- `canvasSlice` 的 `viewMode` 默认值 `'split'` → `'canvas'`
- **必须区分「老用户存过的选择」与「新用户的默认」**：现有恢复逻辑只在存档里
  `viewMode` 为 `canvas`/`board`/`gantt` 时才恢复（`'split'` 是默认值故不写入）。
  改默认值会让**所有存档为 split 的老用户**被一并推进画布。
  故：存档中新增一个显式字段记录「用户是否亲手选过视图」，只有没选过的才用新默认。
- 画布无任何 frame 时，画布中央显示「双击开始你第一个项目吧」
- 用户创建项目后：打开该项目的 frame，并在其中默认落一个 `agent` 节点（空态）

---

## 七、与 `agent-onboarding` 的关系

该 skill 现有五个注入面，全部是**出方向**（把 Eas-Term 的能力告诉 agent）。
本设计引入的是**入方向**（Eas-Term 驱动 agent），是**第 6 个面：会话驱动**。

**`.claude/skills/agent-onboarding/SKILL.md` 必须在实现本设计的同一批改动中补上这一节**，
写明：接新 CLI 时除了原五面，还要在 `src/main/agentChat/adapters/` 加一个 adapter 并注册。
否则下次接新 CLI 的人会照着旧的五个面做，漏掉会话驱动这一面 —— 这正是该 skill 自己
警告过的「长出第二套并行的、迟早对不上的逻辑」。

---

## 八、不在本次范围

- 让这个前端替代终端节点（终端保留，本前端只是**新的默认**，不是唯一）
- 现有 `ChatNavView`（只读 transcript 回看）的去留 —— 它与本前端用途不同，暂时并存
- 会话跨机器同步
- 除 Claude Code / Codex 外的第三个 CLI 的 adapter（但架构必须让它零改 UI 即可接入）

---

## 九、实现前必须复核的四处（spike 未覆盖，假设错了会返工）

1. **Codex `app-server` 是 experimental**：实际协议与 §A.4 描述不符时以实际为准，
   并回来更新本文档与 `docs/cli-headless-接口实测.md`。
2. **hook 脚本的分发与信任**：Eas-Term 要往项目的 `.claude/settings.json` 写 PreToolUse hook。
   这是**写用户项目目录**的行为，须走既有 `fsGuard` 边界；且要考虑用户该文件已有内容时的
   合并策略（**不能覆盖用户自己的 hooks**）。
   还要考虑：用户自己也配了 PreToolUse hook 时，两个 hook 的决定如何合并（保守取「任一拒绝即拒绝」）。
3. **`--include-partial-messages` 的分块粒度未验证**。若它给的是整段而非增量，
   `text.delta` 就退化成 `text.done`，打字机效果要另想办法（或接受无流式）。
   **这条应在 A 的第一个任务里当场验掉**，代价很小。
4. **`Usage.contextRatio` 的算法未验证**。`result` 事件里有 `usage`，但**没有「上下文窗口上限」**，
   而占用比例需要分母。可能的来源：模型 id → 已知窗口大小的静态表；或发 `/context` 取。
   两条都没验过。**在拿到确定算法之前，UI 上的上下文细条不能显示一个编造的百分比** ——
   宁可先只显示累计 token 数（那个是确定的），也不要显示一个看起来精确、实则猜的比例。
