# 11 · MCP 工具网络图

> **更新触发**：增删 MCP 工具 · 改超时 · 改鉴权 · 改注册方式。**与代码同 commit 提交。**

## 网络图

```mermaid
graph LR
    subgraph CLI["用户终端里的 AI CLI"]
        C1["Claude Code 会话1"]
        C2["Claude Code 会话2"]
        CX["Codex"]
    end
    subgraph SHIM["MCP shim 进程（每会话一个，轻量）"]
        S1["eas-mcp.mjs"]
        S2["eas-mcp.mjs"]
        S3["eas-mcp.mjs"]
        BZ["bizone-mcp.mjs<br/>（仅启动包装器）"]
    end
    subgraph APP["Eas-Term 主进程（每 App 实例一个网关）"]
        GW["mcpBridge.ts<br/>HTTP 127.0.0.1:随机端口<br/>x-eas-token"]
        AR["approvalRoute.ts<br/>/agent-approval/*"]
        SE["/secret-env<br/>x-eas-token + x-eas-secret-token"]
    end
    RD["渲染层 mcpHandler.ts<br/>▶ 工具的真正执行体"]
    BZAPP["笔纵画板 App<br/>mcpServer.js"]
    C1 -->|stdio| S1
    C2 -->|stdio| S2
    CX -->|stdio| S3
    C1 & C2 & CX -.->|stdio| BZ
    S1 & S2 & S3 -->|"POST /invoke"| GW
    BZ -->|"import() · 每会话 +93MB"| BZAPP
    GW <-->|"IPC mcp:invoke / mcp:result"| RD
    HK["eas-pretooluse.mjs<br/>（PreToolUse hook 进程）"] -->|"POST 阻塞等待"| AR
    PS["eas-plugin-shim.mjs<br/>（自家插件在会话里的转发 shim，每会话一个）"] -->|"POST /plugin/rpc · 心跳"| PH["pluginHost.ts<br/>一个插件一个进程（面板与会话共用）"]
    PH -->|"stdio · mcpClient.ts"| PP["插件 MCP server<br/>（~/.eas/plugins/ 或随包样板）"]
    PN["渲染层 PluginPanel<br/>sandbox iframe · eas-plugin://"] <-->|"IPC plugin:panelRpc / panelNotify"| PH
    ES["eas-secret run<br/>（shell 命令，非 MCP）"] --> SE
    classDef gw fill:#1d3a4a,stroke:#3498db,color:#fff
    class GW gw
```

**进程模型**（容易误传，钉死）：

- **shim 每会话一个**（MCP 协议天然行为，非本项目设计），但它们**共享同一个 HTTP 网关**（网关
  每 App 实例一个，端口/token 落盘 `userData/mcp-endpoint.json`）—— **不是每会话一套后端**。
- **例外：`bizone-canvas` 真的是每会话一个进程**（用 `ELECTRON_RUN_AS_NODE`），
  实测每个活跃 MCP 客户端**增量约 93MB**（画板本体一次性共享）。会话开多了要留意内存。

## 三道锁

1. 只监听 `127.0.0.1`
2. 随机 token 经 PTY 环境变量注入（`EAS_TERM_PORT` / `EAS_TERM_TOKEN`）；缺这两个变量时
   `tools/list` 返回空工具面，对外无感。**但不是「只经 env」**：同一个 token 还明文落在
   `userData/mcp-endpoint.json`（权限 0600）供手动配置读取 —— 它是「本机同用户可读」级别的凭证，
   不是每终端独有的密钥（密钥柜另用一张 `x-eas-secret-token`，两张都要过，见 `eas-secret.mjs`）
3. `canvas_open_file` / `canvas_open_html` 有**项目内路径白名单**（防渲染 `~/.ssh`）

## 四道超时闸（分布在三层，不等式必须成立：外层 > 内层）

| 层 | 位置 | 普通 | 长等待 |
|---|---|---|---|
| ① shim http.request timeout | `mcp/eas-mcp.mjs` 的 `CALL_TIMEOUT_MS` | 30s | 15min |
| ② `invokeRenderer` | `src/main/mcpBridge.ts` 的 `LONG_WAITS` 分支 | 15s | 10min |
| ③a 渲染层等待窗口（`team_status` 的 `wait:true`）| `src/renderer/src/mcpHandler.ts` 的 `TEAM_WAIT_MS` | — | 8min |
| ③b 渲染层等待窗口（`team_spawn` 的批次清单等用户点头）| `src/renderer/src/features/team/batchRequest.ts` 的 `WAIT_MS` | — | 9min |

> **③ 是两个独立常量，不是一个**：服务不同工具、值也不同，只按 `batchRequest.ts` 去调
> `team_status` 的超时会改错文件、改错值。不等式要对两条分别成立（8 < 10、9 < 10），动 ② 两处都得回来核。
>
> **`wiki_archive_plan` 虽在 `LONG_WAITS` 里，却没有第 ③ 层** —— `store/uiSlice.ts` 的
> `requestArchivePlan` 只挂 Promise、不带定时器，唯一的闸是 ② 的 10min，那句「已等 10 分钟」也是 ② 发的。
>
> **破坏不等式的症状**：用户看到「连接错误」而不是业务提示。③b 被放大到 ≥10min 更糟：主进程先
> 超时清掉自己那份 pending，用户随后才点「开工」，Frame 被脏标记成「有批次在跑」而实际一个 agent
> 都没起 —— 除非重启 app，这个项目再也派不了活（经过记在 `batchRequest.ts` 的 `WAIT_MS` 注释里）。
>
> **`LONG_WAITS` 在 `eas-mcp.mjs` 与 `mcpBridge.ts` 各存一份，加长等待工具两处都要改。**

## 工具清单

以 `mcp/eas-mcp.mjs` 的 `TOOLS` 为准（前缀即分类：wiki · canvas · team · secret · skill · dict，
另有 `notify` / `todo_list` / `board_read` / `merge_preflight` / `repo_impact`），真正的执行体在渲染层 `mcpHandler.ts`。
`tools/list` 不做任何过滤 —— 缺 `EAS_TERM_PORT`/`TOKEN` 时整份返回空，否则全量对外可见。

已知这几条从名字推不出来（不保证穷尽，改工具时自己再看一眼 `TOOLS`）：

| 工具 | 反直觉处 |
|---|---|
| `team_spawn` ⏳ | **五道闸**见 [03](03-agent角色边界.md)。`agents[].role_id` 可选 —— `checkBatch` 拿**当前角色卡的 id 列表**校验，对不上号**整批拒**（不是忽略），填了就走 `openAgentPane({ roleId })` |
| `team_dissolve` | 停整批、报产出，但**不清理 worktree**（读 `.plans/<role>/findings.md`）|
| `secret_check` | **只回有无，不回值**（`src/main/secrets.ts`）|
| `skill_categorize` | 只写分类配置，**不碰 skill 文件本身** |
| `dict_add` | 逐条校验，可拒收 |
| `wiki_archive_plan` ⏳ | **阻塞等用户**在弹窗里确认 |
| `canvas_snapshot` | 截图落盘到项目 `screenshot/` |
| `board_read`（角色工作流 P1）| **先 `refresh` 再 `read`**（`main/collabBoard.ts` 现算 + 落盘 `.eas/board.md`），拿到的板文永远是这一次算出来的；返回 `{ board, note?, path }`，`path` 已 `projectRootOf()` 归一到项目根 + `BOARD_REL`（不归一的话角色会话拿到的是它那棵 worktree 底下一个不存在的路径）。`read` 只在 1 秒内复用刚才那次 `refresh` 算出的 rows（省掉重复跑一整套 git），过期照常重算。数据来源与刷新时机见 [03](03-agent角色边界.md) 协同板段 |
| `merge_preflight`（角色工作流 P2）| **只读，不动工作区**。执行体 `mcpHandler.ts`（定位项目与 `board_read` 同一手法），事实来源 `main/mergeTools.ts`：冲突用 `git merge-tree --write-tree` 算，git < 2.38 时 `conflicts` 为 null 并附 `conflictNote`；撞车清单从协同板反查；`testCmd` 是对象 `{ value, source }` **永不为 null**，`source: 'none'` 才是「没有回归命令」。传入路径经 `projectRootOf()` 归一到项目根 —— 角色会话在 worktree 里调它，算的仍是整个仓库 |
| `repo_impact`（角色工作流 P2）| **只读**。执行体 `mcpHandler.ts`，事实来源 `main/mergeTools.ts` 调代码地图的 `analyzeProject` 建图（**取自主干工作区**，不是调用方的 worktree，分支新增文件会落在 `unknown`），**图按项目缓存 5 分钟**（`graphCache`）。`dependents.indirect` 只到第二层不是闭包；`suggestedTests` 只认同目录同名 `*.test.*`。路径同样 `projectRootOf()` 归一。渲染层只收非空字符串的 `files`，全滤掉了才报「files 不能为空」 |

⏳ = 在 `LONG_WAITS` 名单里。

> 增删工具时，[README](README.md) 索引表里的「N 个工具」也得手抄一遍，没有校验。
>
> **已移除**：`dict_pending`（`790e476 refactor(dict): 拆掉自动沉淀`）。
> 某个 agent 会话的工具面里还有它 = 会话缓存的旧工具面，不是代码库现状。

## 三个入口为什么拆开（2 个 MCP server + 1 个 shell 命令）

| 文件 | 是什么 / 为什么单独 |
|---|---|
| `mcp/eas-mcp.mjs` | 真正的 MCP server，本项目自身能力（零依赖手写 JSON-RPC，stdio 换行分隔）|
| `mcp/bizone-mcp.mjs` | **启动包装器，不是工具实现**：确保笔纵画板 App 在跑（没开则 `open -g -a`，最多等 12s），然后 `import()` 画板包内的 `mcpServer.js` 把 stdio 交给它。那些工具属于画板自己的代码，本项目不拥有 |
| `mcp/eas-plugin-shim.mjs` | **自家插件的转发 shim**（设计稿 2026-09-05 决定 #2）：harness 起的是它、不是插件本体；`initialize / tools/list / tools/call / resources/read` 原样 POST 到网关 `/plugin/rpc`，网关转给 `pluginHost.ts` 里**唯一**的插件进程。同一把 `x-eas-token`，缺 `EAS_TERM_PORT/TOKEN` 时 `tools/list` 回空（同 eas-mcp.mjs 纪律）。`EAS_PLUGIN` 由 `agent-mcp.json` 写死，`EAS_PROJECT` 塞进 `tools/call` 的 `_meta.eas.context.cwd` |
| `mcp/eas-secret.mjs` | **不是 MCP server，是 shell 命令**：`eas-secret run --group/--vars -- <cmd>` 向 `/secret-env` 取密钥注入子进程 env 后 exec，定位是「给运行中的终端补发凭证」，与 MCP stdio 协议无关。鉴权是在全局 `x-eas-token` **之上再加**一张每个 PTY 独有的 `x-eas-secret-token`（spawn 时下发），**两张都要过** —— 全局 token 每个终端都一样、还明文落在 `mcp-endpoint.json` 里，单靠它等于没门 |

## MCP server 怎么注册进用户的 CLI

| 目标 | 函数 | 写入策略 |
|---|---|---|
| `~/.claude.json` 的 `mcpServers` | `writeClaudeConfig()` | JSON 解析失败/结构异常时**绝不写**；写前备份 `.eas-backup` |
| `~/.codex/config.toml` 的 `[mcp_servers.eas-term]` | `writeCodexConfig()` / `writeCodexSection()` | 无 TOML 库，**逐行扫描定位替换**，不解析整份文件（避免丢注释） |
| App 内 AI 对话节点专用 | `agentMcpConfigPath(pluginId?)` | 生成 `agent-mcp.json` 配合 `--strict-mcp-config`，**只含 `eas-term` + `bizone-canvas` + 用户选中的一个插件** —— 插件过多会把系统提示词撑爆 |

- 安装时机：`registerMcpBridge()` 的 `listen` 回调里调 `setupAgents()`；
  **开发环境（`!app.isPackaged`）默认跳过**写全局配置，避免污染用户日常使用的打包版配置。
- opt-out 记在 `userData/mcp-optout.json`，`removeMcpConfig()` 一键移除并记 opt-out；
  `purgeLegacyDshMcp()` 清 0.4.27–0.4.30 误写进 DeepSeek Harness 的配置。
- **角色边界在 Codex 上**：内置工具走 `--disable <feature>`（`shell_tool` / `image_generation`，
  2026-09-05 实测前者生效），MCP 走 `-c mcp_servers.<名>.enabled=false`（名字必须存在）；
  `-c` 不校验键名，**写错静默无效**。
- **工具级精确禁用**（2026-09-06 阶段三第二项探针实测）：`-c mcp_servers.<名>.disabled_tools=[…]`
  能把指定工具从模型的工具面前摘掉（判据是延迟工具搜索结果，加了这条之后指定工具名不再
  出现，不是问模型"你还有这个工具吗"）。**只认精确工具名的数组，不认通配**——
  `caps.mcp.denyTools` 里写得出确切工具名的条目（`<server>__<tool>`）才会落成这条 `-c`，
  通配条目仍走上面那条按 server 名整个 `enabled=false` 的老路（`roleBinding.ts` 的
  `codexDisabledToolsArg()`）。**命名差异要注意**：Codex 给 MCP 工具的名字是
  `mcp__<server>.<tool>`（点号分隔），Claude 是 `mcp__<server>__<tool>`（双下划线）——
  两边的 deny 写法字面上长得像但分隔符不同，抄错会静默不匹配。
  ⚠️ 同 `skills.config` 一样，这条 `-c` 是**整键覆盖**用户 `~/.codex/config.toml` 里同一个
  server 已有的 `disabled_tools`，不是追加。
- **系统 skill 按路径禁用**（2026-09-06 阶段三探针）：Codex 内置 `image_gen` 本机实测从未
  进过工具清单，模型自称有的「imagegen 工具」其实是系统 skill
  `$CODEX_HOME/skills/.system/imagegen/SKILL.md`；真正摘掉它要走
  `-c 'skills.config=[{path="<SKILL.md 完整路径>",enabled=false}]'` ——
  **路径必须是 `SKILL.md` 文件的完整路径，写目录无效**（实测过）。
  ⚠️ **这个 `-c` 是整体覆盖用户 `~/.codex/config.toml` 里的 `skills.config`，不是追加** ——
  用户自己手写的 skills.config 会被这条一并冲掉，Eas-Term 没有做读用户配置合并。

## 契约红线

- `mcp/*.mjs` 的字段格式 —— 改了，用户 `~/.claude.json` 里已注册的旧配置连不上
- **插件面板协议的方法名只在 `src/shared/pluginProtocol.ts`**（以 `@modelcontextprotocol/ext-apps` 1.7.5 核对：协议 `2026-01-26`、`_meta["ui/resourceUri"]`、`text/html;profile=mcp-app`）；渲染层 `appsProtocol.ts` 与主进程 `pluginHost.ts` 都从它 import，规范再变只改那一处
- `/plugin/rpc` 只接受 `initialize / tools/list / tools/call / resources/read|list`；面板桥的 `eas/canvas.call` 只透传 `CANVAS_CALL_ALLOWLIST` ∩ 清单声明的工具，执行仍走 `invokeRenderer`（同一路径白名单）—— **不许绕过它直接给插件网关 token**
- `LONG_WAITS` 两处必须一致；四道超时闸的不等式不能破（③ 是两个独立常量，别只改一个）
- `approvalRoute.ts` 的 `hookResponseBody()` ↔ `resources/agent-hooks/responseBody.mjs`：
  跨进程无法 import，**两处注释互相钉死，改一处必须改另一处**；
  `APPROVAL_TIMEOUT_MS` ↔ hook 脚本里的 `FETCH_TIMEOUT_MS` 同理
