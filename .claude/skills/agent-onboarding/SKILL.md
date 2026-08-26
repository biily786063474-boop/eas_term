---
name: agent-onboarding
description: >
  给 Eas-Term 接入一个**新的 AI CLI**（Gemini CLI / Cursor Agent / OpenCode /
  任何读 CLAUDE.md · AGENTS.md · soul.md 之类"人格文件"的 agent）时，照着这份做前置工作 ——
  盘清六个注入面、每个面写什么、按什么纪律写，让新 agent 和 Claude Code / Codex
  一样开箱即用，而不是又长出一套并行的、迟早对不上的逻辑。
  Triggers: 接入新 agent, 集成新 agent, 支持 Gemini, 支持 Cursor, 加一个 CLI,
  新 agent 前置, agent 注入面, 改 CLAUDE.md, 改 AGENTS.md, soul.md, 托管区,
  规则同步, syncRules, 为什么 agent 不知道有这个工具.
---

# 接一个新 agent 进 Eas-Term

Eas-Term 对一个 AI CLI 做的事，本质是**六件独立的注入**（前五件是把 Eas-Term 的能力**告诉**
agent，第六件反过来，是 Eas-Term **直接驱动** agent 跑会话，方向相反）。接新 agent 不是
"再抄一遍 Codex 那套"，而是**逐个面回答两个问题**：这个 agent 有没有对应机制？没有的话降级到哪？

先跑 `.claude/skills/agent-onboarding/scripts/audit.sh` —— 它把面 1–5 在**这台机器上的当前实况**
打出来（哪些文件真的被写了、托管区多大、盘上那份和代码期望的一致吗）。
不要凭代码推断现状，那个表和现实脱节过。面 6 不写用户的全局配置、没有"盘上状态"可查，
它分两半验：**静态那半**跑 `scripts/check-adapter.mjs`（不起进程、不花额度、秒回，
抓「加了 adapter 却忘了扩别处」这类静默漏）；**真起一轮会话那半没法自动化**
（要花用户的额度，还要人眼看流式和时序），清单在下面「验收」一节，手动过。

---

## 六个注入面

| # | 面 | 干什么 | Claude Code 落点 | Codex 落点 | 代码 |
|---|---|---|---|---|---|
| 1 | **常驻规则**（托管区）| 让模型**知道自己有哪些能力、什么时候该动** | 靠 skill 的 `description`（Claude 原生按需加载）| `~/.codex/AGENTS.md` 里 `<!-- eas-term:begin -->…<!-- eas-term:end -->` 一整段 | `src/main/agentRules.ts` |
| 2 | **技能包正文**（按需读）| 具体怎么做：工具表、场景、坑 | `~/.claude/skills/eas-term/`（整个目录）| `~/.eas/agent/*.md`，由面 1 写绝对路径指过去 | `src/main/agentSkill.ts` |
| 3 | **MCP 工具** | 把画布 / 知识库 / 密钥柜的能力开放出去 | `~/.claude.json` 的 `mcpServers` | `~/.codex/config.toml` 的 `[mcp_servers.*]` | `src/main/mcpBridge.ts` |
| 4 | **提交钩子** | git commit 后扫新增代码行，沉淀专业名词 | `~/.claude/settings.json` 的 `hooks.PostToolUse` | `~/.codex/hooks.json` | `src/main/agentHook.ts` |
| 5 | **库内说明书** | 让 agent 知道这个知识库**怎么分类、东西往哪放** | `<知识库>/CLAUDE.md` | `<知识库>/AGENTS.md` | `src/main/wiki/schema.ts` |
| 6 | **会话驱动**（入方向）| 让 Eas-Term 能直接驱动这个 CLI 跑对话（不经终端）| `claude -p --output-format stream-json`（完整 flag 见下）+ 项目级 PreToolUse hook 审批 | `codex exec --json`（`app-server` 原生带审批但标 experimental，推迟）| `src/main/agentChat/adapters/` |

另有两个**只读**面，接新 agent 时要跟着扩但没有注入风险：
`agent.ts`（探测 CLI 是否装了；GUI 启动的 Electron PATH 常缺 homebrew，那里补了常见安装目录）、
`agentInstall.ts`（挑一条安装命令交给渲染层预填进终端，**不代跑** —— 静默装全局 CLI + 改 PATH
是恶意软件的行为特征，会被 Gatekeeper/Defender 盯上）。

### 面 1 和面 2 的分工是这份文档的核心

**面 1 常驻、面 2 按需。** 判据不是长短，是「**不知道它会不会做错事**」：

- 「生图只能走笔纵画板、不许调别的图像 API」是**规则** —— 漏了模型就会去调 DALL·E。必须常驻。
- 「怎么建节点、怎么两阶段确认」是**步骤** —— 用到时读来得及。

面 1 里每条只写两样：**触发条件** + **去哪读**。正文一个字都不放。

---

## 每个面具体注入什么

### 面 1：常驻区的形状

看 `agentRules.ts` 的 `codexRegion()`。生成出来长这样（内容随启用的模块变）：

```
<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->
# Eas-Term 扩展能力

你运行在 Eas-Term 里。下面是已启用的能力和各自的**触发条件**，
详细约定按路径自己去读，不用背下来。

**画板**：产出了给人看的东西（报告 / 预览页 / 图）→ 用画板 MCP 工具摆到用户眼前，
别只说「已生成」。详细：`/Users/<你>/.eas/agent/canvas.md`

**生图 / 生视频**：用户要图、封面、海报、视频 → 走「笔纵画板」的 MCP
（`bizone-canvas`），不要调别的图像 API。详细同上：`/Users/<你>/.eas/agent/canvas.md`

<!-- eas-term:end -->
```

**知识库故意不在这里出现。** 它整条能力搬进了 MCP 工具 `wiki_query`，触发条件写在那个工具自己的
`description` 里 —— MCP 协议自带把 description 给模型看的机制，在常驻文件里再写一遍是同一件事说两遍，
而且常驻文件是**全局**的，写了就等于给知识库开了后门，绕开了 `wiki_query` 的门禁。

### 面 2：按需文件的清单

仓库里 `skills/eas-term/` 一个目录，分发到两处：

| 文件 | 装什么 | 什么时候读 |
|---|---|---|
| `SKILL.md` | 最重要的一条 · 工具速查表 · **三条触发条件各占一行** · 边界 · 分寸 | 每会话常驻 |
| `canvas.md` | 完整工具表 · 具体场景 · 工具不见了怎么办 | 要操作画布时 |
| `generate.md` | 生图/生视频全套（两阶段确认、`@N`、`from`/`to`、中文 prompt、八个坑、意图→该调什么、跟别的生成路径的关系） | 用户要图/视频 |
| `secrets.md` | 密钥三步 + 三条不要越的线 | 撞到缺 key / 401 |
| `wiki-architect.md` | 自定义知识库的引导流程 | 用户要改知识库分类 |

Claude 拿整个目录（原生 skill 机制支持同目录相对引用）；
Codex 没有 skill 机制，细节文件落 `~/.eas/agent/`，常驻区写**绝对路径**指过去。

### 面 3：MCP 的门禁

三道锁，接新 agent 时一道都不能省：① 只监听 `127.0.0.1`；② 随机 token，**只经 PTY env
注入给本 app 自己起的终端**；③ 路径白名单（`open_file`/`open_html` 只允许项目目录内）。

第 ② 条是关键设计：在**别的**终端起同一个 claude，`tools/list` 里根本没有这些工具 ——
不是「不建议用」，是「看不见」。新 agent 如果不走 PTY（比如是个 GUI app），
这条门禁不成立，**必须先设计替代门禁再接，不要先接了再想**。

**写配置的两种格式各有各的脆弱处**（`mcpBridge.ts`）：Claude 是 `~/.claude.json` 的
`mcpServers`（整份 JSON 读改写，用户手写的其他字段必须原样保留）；Codex 是
`~/.codex/config.toml` 的 `[mcp_servers.<name>]`，**逐段处理而不是整份重写** ——
TOML 没有安全的通用解析/回写路径，整份重写会毁掉用户自己写的配置。
接新 agent 前先问清它读什么格式，别默认能套用这两套之一。

要写进哪些名字看 `MANAGED`（现在是 `eas-term` + `bizone-canvas`）。
**漏一个，用户点「移除」就只清掉一半，剩下的成了删不掉的残留。**

### 面 4：钩子是侵入性最高的一项

技能包只是让模型多读一份说明；钩子是**在用户每次跑命令时插入我们的代码，在他所有项目里，永久**。
所以三条铁律：必须显式问、必须能一键卸、写之前必须备份。

新 agent 没有钩子机制就**跳过这个面**，不要为了"对齐"去发明一个（比如 wrap 它的二进制）。

### 面 5：库内说明书的围栏

```
<!-- eas-term:wiki-schema:begin v4 -->
（我们生成的，可安全重写）
<!-- eas-term:wiki-schema:end -->
（围栏外：用户自己补的规矩，必须原样保留）
```

新 agent 如果读的是别的文件名（`soul.md` / `GEMINI.md` / `.cursorrules`），
**在 `initWiki` 的 `files` 数组里加一项**，内容复用 `schemaTextFor(root)`，
围栏语义照抄 `upgradeSchemaFile()` —— 不要新写一套。

> `initWiki` 一共写 5 份文件（`CLAUDE.md` / `AGENTS.md` / `index.md` / `log.md` /
> `START-HERE.md`）。**自定义分类的库有 4 份要按配置走**，只改 `CLAUDE.md`/`AGENTS.md`
> 会让 `index.md` 和 `START-HERE.md` 描述不存在的目录，而它们**只在文件缺失时写**，
> 一旦写错永久不自愈。这个坑 2026-08-12 刚踩过一次，见纪律 12。

### 面 6：会话驱动是反方向的注入

前五个面都是把 Eas-Term 的能力**告诉** agent；这一面反过来，是 Eas-Term **直接驱动**这个 CLI
自己跑对话，不经终端。落点是 `src/main/agentChat/adapters/` 下的 adapter 文件，
完整实测记录见 `docs/cli-headless-接口实测.md`。

**Claude Code**：

```
claude -p --input-format stream-json --output-format stream-json --verbose \
       --strict-mcp-config --include-hook-events --include-partial-messages
```

审批走**项目级** `.claude/settings.json` 里的 PreToolUse hook —— hook 是外部进程、能阻塞，
实测能阻塞 70 秒不被切断（`src/main/agentChat/approvalRoute.ts`）。

**Codex**：`codex exec --json`。`app-server` 协议原生带审批，但标着 experimental，推迟到之后
单独做 —— `exec` 模式做不了逐次审批，`capabilities.approval` 因此是空数组，UI 自动退回显示
`sandboxLevels`，不用为 Codex 写任何分支。

**接新 CLI 时，`CliAdapter` 这七个字段每一个都要回答**（定义在 `src/shared/agentChat.ts`）。
它们都是**能力声明**，不是 CLI 名字 —— 下游一律判字段，永远不写 `if (id === 'xxx')`：

| 字段 | 要回答什么 | 漏了会怎样 |
|---|---|---|
| `capabilities` | 支持哪些模型 / effort 档 / 审批粒度 / 沙箱档 | UI 拿它决定显示什么控件；空数组会自动降级，不用写分支 |
| `buildArgs().stdin` | `'pipe'`（持续写）还是 `'ignore'`（必须关掉）| 刻意不给可选：Codex `exec` 不关 stdin 会**卡死**在 `Reading additional input from stdin...` |
| `createTranslator()` | 自己的 wire format 怎么翻成 `ChatEvent` | 每次调用返回**新实例** —— 节流/去重状态是每个会话各自的，共享会串台 |
| `approvalHook` | 要不要装 Claude 风格的 PreToolUse hook 文件 | **与 `capabilities.approval` 是两件事**：前者说"有审批能力"，后者说"实现方式是装这个 hook"。混成一个布尔正是 C1 那个 Critical 的根 |
| `paramChange` | 会话跑起来后怎么改模型 / effort | `'slash'` = 认 `/model x`、`/effort x`，往 stdin 一写就换，**不重启、不丢上下文**；不声明 = 只能重启带启动参数 |

**`ChatEvent` 里有三个事件不是翻译器产出的**，接新 CLI 时别去自己的 wire format 里找它们：

- `turn.start` —— **会话层推的**。CLI 只在开口说话时才出声，而「发出去了、还没回音」实测有
  4 秒多，界面正是那段时间最需要表态。渲染层自己记标志的话，同一件事记在两个地方，必漏。
- `quota` —— 订阅额度（周额度 / 五小时额度）。原样透传 window/status，**不做枚举映射**：
  映射表会在服务端加档位时静默失配。
- `Usage.contextRatio` —— 上下文占用。分母必须来自同一个 result 事件里的
  `modelUsage[<model>].contextWindow`，**拿不到分母就返回 undefined，绝不用猜的窗口大小顶上**。

**审批有两条路，别默认走 hook 那条：**

- **硬拦截**（`approvalHook: 'claude-pretooluse'`）：外部进程能阻塞，实测能挡 70 秒。
  代价是要装文件进用户的项目目录。
- **伪无头**（`StartOpts.askFirst` + `ASK_FIRST_PROMPT`）：不装任何东西，靠系统提示让模型
  **在动手前先问**。这是软约定不是硬拦截 —— 模型不听就穿透了，但它对用户零侵入，
  是现在的默认。新 CLI 没有 hook 机制时直接用这条降级，不用为它写分支。

另外 `OUTPUT_STYLE_PROMPT`（不用 emoji / 标题最多三级 / 不用分隔线）是**追加到系统提示**的，
跟 CLI 无关，新 adapter 只要走 `buildArgs` 的公共路径就自动带上。

**三条坑，这一轮实测踩到的，不写下次还会再踩一遍：**

1. **绝不能传 `--bare`** —— 会跳过认证，直接返回 `Not logged in`
2. **`--permission-mode manual` 不是「等审批」是「直接拒绝」** —— 用它做审批卡片会让用户永远等不到
3. **PreToolUse hook 是 fail open**：只有 exit code 2 才阻塞工具调用，其它任何「跑不起来」
   （含 `command not found`）都放行、不等审批。所以 hook 的 node 解释器必须用**保证存在**的
   兜底（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`），不能祈祷 PATH 里有 node
   （见 `src/main/agentChat/hookInstall.ts` 的 `nodeBinForHook()`）

### 还有一条不在这六个面里、但会绕过它们的路

**MCP 工具的返回值本身就是一个注入面。** `wiki_query` 每次都会把
「这个库有哪些目录」交给模型，工具 description 还写着「`dirs.me` 是用户画像分区」——
于是即使库内 `CLAUDE.md` 描述的是自定义分类，模型照样会往 `me/` 写，
**把内置目录一个个造回去**。

判据：**凡是会告诉 agent「这东西长什么样」的通道，都要跟着配置走** ——
库内说明书是一条，MCP 工具的返回值与 description 是另一条，两条说的必须是同一件事。
接新 agent 时别只盯着文件落点，也要扫一遍 MCP 工具返回了什么。

**同一个坑的第二例（2026-08-17）**：密钥柜的 `secret_check` 原来 `vars` 必填，
agent 只能**猜一个变量名**去查。用户存的是 `MY_ALIYUN_AK`，agent 猜
`ALIYUN_ACCESS_KEY_ID` —— 查不到，于是弹窗要一个他刚存过的密钥。
根子不在存储，在于**这条通道从来没告诉过 agent 柜里叫什么**。
现在 `vars` 留空 = 列出组名 / 备注 / 变量名（永远不含值）。

由此多出一条接入检查项：**每个 MCP 工具都要能回答「agent 怎么知道该拿什么参数调我」**。
要求 agent 凭空猜一个标识符的工具，实际成功率接近零。

---

## 接新 agent 的步骤

**每一步先回答「这个 agent 有没有对应机制」，没有就明确记下降级方案，不要含糊跳过。**

1. **探测**：`agent.ts` 的 `hasCli()` 加这个 CLI 的二进制名；PATH 补全表加它的常见安装目录
2. **安装建议**：`agentInstall.ts` 加一条安装命令（仍然**不代跑**）
3. **面 3 MCP**：找到它的 MCP 配置落点与格式；确认 PTY 门禁成不成立，不成立就先设计替代门禁
4. **面 1 常驻区**：找到它的全局指令文件（`AGENTS.md` / `soul.md` / `GEMINI.md`…），
   加一个和 `codexRegion()` **同形状**的托管区生成函数
5. **面 2 细节文件**：有原生 skill 机制就拷整个目录；没有就落 `~/.eas/agent/` + 常驻区写绝对路径
6. **面 4 钩子**：有钩子机制才做，没有就跳过并在文档里写明跳过了
7. **面 5 库内说明书**：`initWiki` 的 `files` 数组加它的文件名，复用 `schemaTextFor(root)`
8. **面 6 会话驱动**（要支持被 Eas-Term 直接驱动跑会话才做）：`src/main/agentChat/adapters/`
   加一个 adapter 文件、在 `index.ts` 的数组里注册。**UI 不需要改** —— 控件由 adapter 的
   `capabilities` 声明驱动（有没有 `models` / `effortLevels` / `compact`、`approval` 是不是
   空数组、`sandboxLevels` 有哪些）。**如果你发现自己要去改 UI，说明能力声明没设计对，
   回头改声明而不是改 UI。**
9. **把 `'claude' | 'codex'` 这个联合类型扩开**。**这是最容易漏的一步，而且漏了不报错。**
   实测散落 **29 处 / 14 个文件**（`grep -rn "'claude' | 'codex'" src`）：
   `shared/types.ts`（角色的 model/effort 按 CLI 键控）、`store/uiSlice.ts`（`ptyAgent`）、
   `store/canvas/types.ts` 与 `persist.ts`（节点上存的 agent 选择要能持久化新值）、
   `preload/index.ts`、`main/pty.ts`、`main/roles.ts`、`main/agentHook.ts`、
   `main/agentInstall.ts`，以及五个渲染层组件。

   其中 **`pty.ts` 的 `agentOnTty()` 单独拎出来说**：它按**终端里跑的进程名**认这是哪个
   agent（`base === 'codex'` 这种）。不扩它的话，新 CLI 在终端里跑起来，
   通知系统 / 灵动岛 / 状态机全都认不出它 —— 功能"能用"但一路静默，最难查。

10. **卸载路径**：`removeRules()` / `removeMcpConfig()` / 钩子卸载都要覆盖到它
11. **状态显示**：`skillStatus()` / `rulesStatus()` / `mcpConfigStatus()` 加它一列
12. **实测**：真起一个这个 CLI 的会话，**只给它常驻那一份**，逐条念触发词看它会不会主动去读细节文件。
    这一步不能省 —— 触发条件写得含糊时，测试全绿而模型就是不去读

---

## 纪律（每一条都是踩出来的）

1. **一个 CLI 只允许一个托管区**，内容按当前启用的模块**整段重新生成**。
   不是「一个模块一段标记」—— 那样加一个模块就多一段，迟早变成一坨。
2. **常驻区只放触发条件 + 去哪读。** 实测教训：本机 `~/.codex/AGENTS.md` 共 3306 字符，
   我们的段占 3284（99%）—— 因为技能包按 Claude 的按需加载机制写，装到 Codex 时被整份灌进**常驻**文件。
   于是在 Codex 里改一行代码，都要先付这份画板指南的 token。
3. **触发条件必须能独立成立，不许合并。** 生图和摆放合并写，用户说「画张封面」时
   模型只会想到摆放，想不到自己有生成能力 —— 于是回一句「我不能生图」，或者去调别的图像 API。
4. **`home()` 只能用 `app.getPath('home')`，不许 `os.homedir()`。** 后者跟随 `$HOME` 环境变量：
   测试时把 `$HOME` 指到临时目录做隔离，`os.homedir()` 跟着变而 `app.getPath('home')` 不变，
   于是会往**真实**的 `~/.codex/AGENTS.md` 里写一行指向**另一个 home** 的路径。同一模块里必须同源。
5. **写用户全局配置前必须备份成 `.eas-backup`。** 写坏了是灾难，一份备份不值几个字节。
6. **必须能一键卸干净**，且卸载只动我们那一段，用户写在区外的内容一个字不碰。
7. **状态判断的参照物必须和实际写入的内容是同一个东西。** 踩过：状态检查拿「完整 SKILL.md
   全文包在标记里」去比对盘上那段，而实际写的是短路由 —— 两者永不相等，于是「有更新待安装」恒为真，
   首启弹窗每次启动都弹，用户点多少次「安装」都没用。`expectedCodexRegion()` 就是为修这个而导出的。
8. **一个事实只写一处**，需要引用就写路径，不复制正文。
9. **敏感能力靠门禁，不靠「不建议」。** 知识库路径不写进任何全局文件 —— 换个终端起 claude
   就不该读到 Eas-Term 专属的东西。整条能力搬进 MCP 工具，靠 PTY 注入的端口/令牌做门禁。
10. **dev 模式不要污染用户配置。** `npm run dev` 或拿 `out/` 起测试实例时，
    不该往 `~/.claude.json` 里塞一条指向临时路径的 MCP 条目。
11. **只加独立配置、不动别人的。** 用户的 `~/.claude/settings.json` 里可能有他自己的钩子，
    合并而不是覆盖；解析失败时**跳过，不冒险覆盖**。
12. **闸门要一次接全，接一半比不接更糟。** 2026-08-12 的自定义知识库就栽在这儿：
    改造把「建目录 / `CLAUDE.md` / `AGENTS.md`」三处接上了配置，`index.md` 和
    `START-HERE.md` 没接 —— 改造前五份文件**统一地错**（都描述内置分类，彼此自洽），
    改造后变成**自相矛盾地错**。而且后两份只在文件缺失时写，一旦写错**永久不自愈**。
    动一个「这东西长什么样」的数据源之前，先 `grep` 出它的**全部**消费者。
13. **回落的前提是「回落不会写坏用户的东西」。** 同一次改造的第二个坑：配置文件损坏时
    「回落到内置默认值」听着稳妥，实际会把用户自定义的库改回内置形状 —— 建出一堆他没声明的
    目录、把说明书整段重写，**不可逆**。判据：读取类回落无害；
    **写入类（建目录、改文件、搬东西）和「告诉 agent 这东西长什么样」（会诱导它写）
    都不能回落，要停手并在界面说清楚。**

---

## 验收

- 新 agent 起一个会话，**不做任何额外提示**，说「把这个报告打开看看」→ 它会调 `canvas_open_html`
- 说「画张封面」→ 它走 `bizone-canvas`，**不去调别的图像 API**（这条是红线，必须单独验）
- 撞到 401 → 它走 `request_secret` 弹 GUI，**不让用户把密钥贴进对话**
- 在**别的**终端（不是 Eas-Term 起的）起同一个 CLI → 这些工具在 `tools/list` 里**不存在**
- 卸载后：托管区没了、MCP 条目没了、钩子没了，用户自己写在区外的内容**一个字没少**
- 面 1 的常驻区字符数：打出来看一眼，超过 1500 字符就是又把正文塞进去了

**面 6（会话驱动）要单独验，前面那些都验不到它** —— 它不写用户的全局配置、盘上没有状态可查，
静态那半先跑 `scripts/check-adapter.mjs`；剩下这些只能真起一轮会话，人眼看：

- 发一条消息 → **界面立刻有反应**（`turn.start`），不是等 CLI 开口才动。
  实测「发出去了、还没回音」有 4 秒多，那段时间界面必须表态
- 回复是**流式**进来的，不是憋完一次性出现
- 切模型 / 切强度 → 真的换了（`paramChange: 'slash'` 的 CLI 看 CLI 重推的 init 事件），
  而且**回执不出现在对话区**（那是 CLI 的确认消息，对人零信息量，session 层静默掉了）
- 关掉这个 CLI 的会话 → 进程真的退出，没有留下孤儿

**别用「测试全绿」代替这一步。** 面 1 的触发条件写得含糊时，代码全对、模型就是不去读细节文件——
那种失败只有真起一轮会话、逐条念触发词才看得见。
