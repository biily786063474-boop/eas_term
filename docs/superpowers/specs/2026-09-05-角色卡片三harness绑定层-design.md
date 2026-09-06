# 角色卡片 × 三个 harness 的绑定层

> 状态：**阶段一、二已实现；阶段三第一项已实现**（见 [plans/2026-09-05-角色卡片三harness绑定层.md](../plans/2026-09-05-角色卡片三harness绑定层.md)）。
> 读之前先读 [10 模块领地图](../../architecture/10-模块领地图.md) 与
> [03-3A 产品内 agent 角色边界](../../architecture/03-agent角色边界.md#3a--产品内-agent-角色边界)。
> 本稿里标「**今日实测**」的结论来自 2026-09-05 在本机对 Codex 0.147.0 / omp v18.0.11 /
> Claude Code 当前版的真实探针，命令附在第十一节，可复跑。

---

## 用户原话（2026-09-05）

> 那你需要根据三个 cli 的架构去做匹配设计，先写规划，让角色卡片适用于三个不同的 harness。

背景：用户先在别的项目里问过「Claude 不同 session 怎么规范角色与权限」，回到本项目后确认
我们的角色卡片（`~/.eas/roles.json`）是 harness 层的东西，与 `.claude/agents/*.md` 不是一套；
现在要把它在 Claude Code / Codex / omp（界面上叫「默认 harness」）三条路上都落实。

---

## 一、一句话概括

**角色卡片改成用「能力意图」描述（能不能写文件、能不能跑命令、能不能生图、禁哪些 MCP），
由一个纯函数的绑定层按每个 harness 的真实架构翻译成参数，并把「哪些是硬约束、哪些降级了、
哪些做不到」如实报告给界面。**

现在的卡片用 Claude 的工具名当通用词汇，另外两个 harness 只能猜着对，而且猜不到的部分是
静默丢掉的。改完之后角色定义不再绑定任何一家的词汇，三条启动路径共用一份翻译逻辑。

---

## 二、现状盘点：三条路各自怎么落

角色四要素（model/effort · contract · tools）目前在**三处**各写一遍翻译逻辑：
AI 对话节点走 `agentChat/adapters/{claude,codex}.ts` 与 `agentChat/omp/paths.ts`，
终端节点走 `CanvasAgentBar.tsx` 的 `buildClaudeCmd / buildCodexCmd`（omp 不走终端）。

| 要素 | Claude | Codex | omp |
|---|---|---|---|
| model / effort | `--model` / `--effort` | `-m` / `-c model_reasoning_effort=` | **角色里存不下**：`AgentKind` 只有 `claude \| codex`，`sanitize()` 的 `strMap` 只读这两个键 |
| contract | 对话：`--append-system-prompt`；终端：`--append-system-prompt-file` | `-c instructions=` 压成单行 | `--append-system-prompt=` |
| `tools.deny`（内置工具名） | `--disallowedTools` **硬**（工具从上下文消失） | **无处可去，静默丢**（adapter 注释如实写了） | `--tools` 白名单做减法，**硬**；Claude 名字靠大小写不敏感碰巧对上 `write/edit/bash` |
| `tools.deny`（`mcp__*image*` 通配） | 硬 | 丢 | 丢（`ompToolsFor` 只认 OMP_TOOLS 里的名字） |
| `tools.denyServers` | 展开 `mcp__<名>__*` | `-c mcp_servers.<名>.enabled=false` | `session/new` 名单里剔掉 |
| `tools.allow` | `--allowedTools`：**这是免审批清单，不是白名单**，不限制别的工具 | 丢 | 丢 |
| 写保护的逃生口 | Bash 仍能 `sed` 改文件 | 无写保护 | bash 仍能改文件 |
| 恢复会话 | tools 重拼、契约不重放 | `-c` 全部重拼 | 不适用 |

**今日实测补进来的事实**（改变设计判断的四条）：

1. **Codex `-s read-only` 是操作系统级沙箱**，连 shell 一起罩住 —— 这是三家里唯一把
   「Bash 逃生口」也封住的写保护。现在 `StartOpts.sandbox` 恒为 `workspace-write`，
   界面只展示不可选，角色也不驱动它。**Codex 上明明有最硬的写保护，我们一直没用。**
2. **`codex exec --disable shell_tool` 真的摘掉 shell 工具**（模型回 `NO_SHELL_TOOL`，
   对照组回 `EAS_SHELL_OK`）。Codex 不是「没有工具级开关」，是内置工具走 feature 开关、
   MCP 工具走 `mcp_servers.<名>.disabled_tools / enabled_tools`（键已被 0.147 接受，
   过滤效果待验）。
3. **Codex 的 `-c` 不校验未知键**：`-c bogus_field_xyz=1` 照常起会话。
   adapter 注释里「实测报 unknown configuration field」在 0.147 已不成立，
   后果是**写错键名静默无效**。三种指令键 `instructions` / `developer_instructions` /
   `model_instructions_file` 全部生效（分别按指令回了 MANGO / PINEAPPLE / KIWI），
   其中 `model_instructions_file` 是**整份替换**基础指令，不能拿来放契约。
4. **Codex 0.147 自带 `image_generation` 内置工具（feature stable、默认开）**，
   与 `hooks`（事件名 PreToolUse / PermissionRequest / PostToolUse…，读 `hooks.json`，
   带信任机制）。前者直接顶到生图红线上：现在选「画师」用 Codex，内置生图**完全没被拦**。
   → 2026-09-06 十四节推翻：那是 feature flag，内置工具从未进工具清单。

---

## 三、为什么现在的做法不够

1. **词汇绑死 Claude。** `tools.deny` 里写的是 `Write` / `NotebookEdit` / `mcp__*image*`，
   omp 靠大小写巧合、Codex 完全对不上。加第四个 harness 时只会更糟。
2. **静默丢弃。** 三处翻译各自决定「认不出的丢掉」，用户在编辑器里看到的是一份配置，
   实际生效的是三份不同的子集，而界面没有一处能告诉他差在哪。
3. **最硬的约束没用上。** Codex 的 OS 沙箱、`--disable shell_tool`、内置生图开关，
   都比 Claude 的 `--disallowedTools` 硬，一个都没接。
4. **三处重复。** 同一条「变长参数要放最后」「恢复时 tools 要重拼」的教训在
   `claude.ts` 和 `CanvasAgentBar.tsx` 各写一遍，靠注释互相引用同步。
5. **`allow` 字段是误导。** 它在 Claude 里是「免审批」，用户按字面会以为是「只许这些」。
   没有任何内置角色用它。
6. **model/effort 对 omp 是黑洞。** 角色存不下 omp 的模型选择，选了角色再选 omp 等于
   只剩契约。

---

## 四、目标与非目标

**目标**

- 角色定义 harness 中立：用能力意图描述，不出现任何一家的工具名。
- 每个意图在三家上都有明确的落法，分四档如实标注：硬 / 软 / 降级 / 不支持。
- 三条启动路径（对话 adapter · 终端命令 · omp ACP）共用一份纯函数绑定层，`node --test` 裸跑。
- 界面上能看到「这张卡在这个 harness 上到底生效了什么」。
- 旧的 `roles.json`（version 1）自动迁移，用户自建角色不丢。

**非目标**

- 不做按路径的写权限（「只能改 `src/foo/` 下的文件」）。三家都没有原生支持，
  要靠 hook 或 worktree，另立项。
- 不改审批机制（Claude PreToolUse hook / omp 双通道 / Codex 无审批）。
- 不做会话中途换角色（2026-09-03 已定：换角色 = 重开）。
- 不把 `team_spawn` 的自由标签 `role` 和角色卡合并 —— 只加一个可选的 `roleId` 透传。

---

## 五、三条路线与推荐

**A · 最小补丁**：保留现有 schema，只在三个 adapter 里各补映射（Codex 加沙箱与 shell 开关），
再在编辑器里手写一段「粒度差异」说明。
优点：改动最小。缺点：词汇仍是 Claude 的，第三处重复不解决，说明文字与代码迟早脱节
（编辑器里现在那段说明已经落后于代码：它说「Codex 没有工具级开关」）。

**B · 意图模型 + 绑定层（推荐）**：schema 升到 v2，角色用 `caps` 描述意图；新建
`shared/roleBinding.ts` 一个纯函数把 `(role, harness)` 翻成参数与诚实报告；三条路径都改成
调它。编辑器的差异说明改为**从报告渲染**，不再手写。
优点：解决第三节全部六条；报告由代码生成，不会脱节。缺点：要迁移 `roles.json`，
改动面覆盖 shared / main / renderer 三层。

**C · 各家原生角色文件**：Claude 用 `--agents '{...}' --agent <id>`，Codex 用
`-p <profile>` 配置层，omp 用 `--config` 覆盖文件。每张卡物化成三份原生文件。
优点：最贴各家架构。缺点：要往用户的 `$CODEX_HOME` 写 profile 文件（污染他的配置目录），
Claude 的 `--agent` 与 `--resume` 组合行为未验，三份文件的生命周期管理是新的一整块。
**C 里唯一值得单独考虑的是 Codex profile**，作为 B 的可选后续。

**推荐 B。** 它是「一份定义、多份绑定」这个模式的直接实现，也是用户那段对话里自己得出的
结论（「角色正文通用、权限执行各家各写」）。

---

## 六、设计

### 6.1 角色数据模型 v2

```ts
export type AgentKind = 'claude' | 'codex' | 'omp'   // 扩一个键（只影响角色的 model/effort 映射）

export interface AgentRole {
  id: string; name: string; desc: string
  group: 'main' | 'output'; color: string
  kind: AgentKind | 'auto'
  model?: Partial<Record<AgentKind, string>>      // omp 填 selector（`provider/model`），不是裸 id
  effort?: Partial<Record<AgentKind, string>>     // omp 填 thinking 档位
  contract: string
  /** 能力意图。缺省一律 = 允许；只写要收紧的那几项 */
  caps?: {
    write?: false          // 不许改文件
    shell?: false          // 不许跑命令
    imageGen?: false       // 不许生图（红线）
    mcp?: {
      denyServers?: string[]   // 精确 server 名
      denyTools?: string[]     // 工具名或通配（`*image*`），不带 `mcp__` 前缀
    }
  }
  /** 逃生口：某家独有、意图模型表达不了的原始参数。只在对应 harness 生效，报告里标「原始」 */
  raw?: Partial<Record<AgentKind, { deny?: string[] }>>
  builtin?: boolean
}
```

三条取舍：

- **`caps` 只能收紧，不能放开。** 值域是 `false`，没有 `true`，缺省即允许。
  这样「一张空卡 = 杂役」这条不变式在类型上成立，也避免出现「角色把 CLI 默认关掉的东西打开」。
- **`allow` 删除。** 免审批清单不是角色的事（审批有自己的机制）。
- **`raw` 是明确标注的逃生口**，不是默认通道。它存在的理由与 `runner` 相同：不给出口的系统会被绕过。

### 6.2 绑定层 `src/shared/roleBinding.ts`

零依赖、electron-free、`node --test` 裸跑（同 `omp/launch.ts` 2026-09-03 拆依赖的理由）。

```ts
export type Enforcement = 'hard' | 'soft' | 'degraded' | 'unsupported'

export interface BindingLine {
  cap: 'write' | 'shell' | 'imageGen' | 'mcp' | 'contract' | 'model' | 'effort'
  level: Enforcement
  how: string        // 给人看的一句话：「-s read-only（OS 沙箱，连 shell 一起罩住）」
}

export interface RoleBinding {
  claude?: { args: string[] }                                   // 追加到 argv 末尾（变长参数在最后）
  codex?:  { args: string[]; sandbox?: 'read-only' }            // sandbox 单列，adapter 决定放哪
  omp?:    { tools: string[]; dropServers: string[]; appendSystemPrompt?: string }
  report: BindingLine[]
}

export function bindRole(role: AgentRole, kind: AgentKind, ctx: BindingContext): RoleBinding
```

`BindingContext` 只带绑定时才知道的事实：`resume: boolean`（契约不重放）、
`knownMcpServers: string[]`（做通配到 server 名的降级匹配）、`surface: 'chat' | 'terminal'`
（终端契约走文件、要 shell 引用）。阶段三加了 `codexHome?: string`（Codex 的配置目录，
`CODEX_HOME` 或 `~/.codex`，由调用方算好传入）——`imageGen:false` 摘 Codex 的 imagegen
系统 skill 要拼它的绝对路径，见第十四节。

**一条硬规矩：报告是绑定的副产物，不是另写的说明。** 每条 `args` 都由某个 `BindingLine`
产生，测试断言两者一一对应。这样编辑器里那段「粒度差异」永远与真实参数一致。

### 6.3 绑定矩阵

| 意图 | Claude | Codex | omp |
|---|---|---|---|
| `write:false` | `--disallowedTools Write Edit NotebookEdit` · **hard**；报告附注「shell 未禁时 Bash 仍能写」 | `-s read-only` · **hard**（OS 沙箱，连 shell 写一起挡） | `--tools` 去掉 `write edit ast_edit` · **hard**；附注同 Claude |
| `shell:false` | `--disallowedTools Bash` · **hard** | `--disable shell_tool` · **hard**（今日实测） | `--tools` 去掉 `bash` · **hard** |
| `imageGen:false` | `--disallowedTools mcp__*image* mcp__*dalle* …`（沿用 roles.ts 那组通配） · **hard** | 有 `codexHome`：`--disable image_generation`（feature 生效但内置本就不在工具清单）＋ 按 SKILL.md 完整路径摘掉 `imagegen` 系统 skill（`skills.config`）＋ 通配匹配到的 server 整个 `enabled=false` · **hard**（阶段三，2026-09-06 探针）；没有 `codexHome`：同上但不摘 skill · **degraded** | 无内置生图；通配匹配到的 server 从 `session/new` 剔除 · **degraded** |
| `mcp.denyServers` | `mcp__<名>__*` · hard | `mcp_servers.<名>.enabled=false` · hard | 名单剔除 · hard |
| `mcp.denyTools` | `mcp__<pattern>` 通配 · hard | 首批：pattern 与 server 名匹配则整关 · **degraded**；后续 `disabled_tools` 精确过滤（待验） | 同 Codex 首批 · degraded |
| `contract` | 对话 `--append-system-prompt`（三段拼一条，规矩不变）；终端 `--append-system-prompt-file` | `-c instructions=` 单行（维持现状；`developer_instructions` 已验可用，作为备选） | `--append-system-prompt=` |
| `model` / `effort` | `--model` / `--effort` | `-m` / `-c model_reasoning_effort=` | 建会话后 `session/set_config_option`（`model` / `thinking`），走已有的 `paramChange:'acp-config'` 通道 |
| `raw.<kind>.deny` | 原样追加 `--disallowedTools` | 原样追加 `-c`？**不接** —— Codex 没有工具名 deny，raw 对它只能是 `--disable <feature>` 列表 | 原样从 `--tools` 减去 |
| 恢复会话 | caps 重拼、契约不拼 | caps 重拼、契约重拼（`-c` 无害） | 不适用 |

矩阵里的每个格子对应 `bindRole` 的一条 `BindingLine`，测试用内置八个角色 × 三家做快照。

**对话节点上 Codex 的沙箱冲突**：`StartOpts.sandbox` 目前没人设，恒为默认。规则定为
「角色 `write:false` → `read-only`，否则维持默认 `workspace-write`」，角色是唯一来源。
终端节点上 Codex 之前**有意不拼** sandbox（用户取消了权限档位），本稿建议只在
`write:false` 时拼 `-s read-only`，其余照旧不拼 —— 见第八节待决项 2。

### 6.4 诚实报告进界面

- **角色编辑器**（`CanvasRoleEditor`）：把现在手写的两段「粒度不同」说明换成三列矩阵，
  每行一个意图，每格显示 `level` 图标 + `how`。数据来自 `bindRole(role, kind, {resume:false, …})`，
  不再手写。**已实现（2026-09-05）** —— `.re-matrix` 由 `capMatrix()` 渲染，手写落法已全删。
- **对话工具栏**：起会话前若该角色在当前 CLI 上有 `degraded` / `unsupported` 行，
  角色名旁加一个可 hover 的小标记，展开列出那几行。**只在有降级时出现**，不常驻。
  **已实现（2026-09-05）** —— `RolePicker` 的 `.rolepick-warn`，内容由 `degradedLines()` 给。
- 文案按 [[eas-term-失败要说人话]]：一句原因，不堆术语。例：「Codex 上生图限制降级为
  按 MCP server 名整个关闭；内置生图开关尚未验证。」

### 6.5 三条启动路径收口

| 路径 | 现在 | 改后 |
|---|---|---|
| 对话 · Claude | `claude.ts buildArgs` 自己拼 deny | 调 `bindRole(...).claude.args` 追加到末尾 |
| 对话 · Codex | `codex.ts buildArgs` 只接 denyServers | 调 `bindRole(...).codex`，`sandbox` 由它给 |
| 对话 · omp | `paths.ts ompAcpArgs` + `launch.ts readMcpServers(denyServers)` | `ompAcpArgs` 收 `binding.omp.tools`；`readMcpServers` 收 `binding.omp.dropServers` |
| 终端 · Claude/Codex | `CanvasAgentBar` 两个 build 函数各自拼 | 调同一个 `bindRole(...)`，只在最外层做 `shq()`。**`CanvasAgentBar` 2026-09-03（commit `5734a00`）起无 UI 入口**，这两个 build 函数仅与绑定层保持同步以便回滚 |
| 手机端 `phone/provider.ts` | 不带角色 | 不变（非目标），但它走同一个 `StartOpts`，将来接上零成本 |
| `team_spawn` | `role` 是自由标签 | 加可选 `roleId`，命中则把该角色的 caps/contract 塞进 `StartOpts` |

`StartOpts` 的 `roleTools` 改为 `roleCaps`（v2 形状），IPC 边界的 `safeRoleTools` 改成
`safeRoleCaps`，三条清洗规矩原样保留（不是对象→当没给；混进非字符串→整条丢；空数组→没有）。

### 6.6 `roles.json` 迁移 v1 → v2

在 `roles.ts` 的 `load()` 里做，一次性，写回前照旧留 `.eas-backup`：

| v1 | v2 |
|---|---|
| `tools.deny ⊇ {Write, Edit}` | `caps.write = false` |
| `tools.deny ∋ Bash` | `caps.shell = false` |
| `tools.deny` 里 `mcp__*` 开头的项 | 去掉前缀进 `caps.mcp.denyTools`；恰好是 roles.ts 那组生图通配 → 收敛为 `caps.imageGen = false` |
| `tools.denyServers` | `caps.mcp.denyServers` |
| 其余认不出的 deny 项 | `raw.claude.deny`（不丢，标原始） |
| `tools.allow` | 丢弃，写一条日志 |
| `version: 1` | `version: 2` |

内置角色直接改成 v2 写法（`scout` / `inspector`：`caps.write=false`；`illustrator`：
`caps.imageGen=false`；其余不变）。用户改过的内置项按上表迁移，`reconcileBuiltins` 逻辑不动。
**`builder.desc` 那句「唯一有写代码权限的角色」顺手改掉**（图纸 03 点名的错话）。

### 6.7 错误处理

- `bindRole` 是纯函数，不抛：输入缺字段就当允许，输出永远是合法参数。
- omp 白名单减到空时留 `read`（沿用 `ompToolsFor` 的兜底，理由不变：空 `--tools=` 会让 `session/new` 整个失败）。
- Codex 的 `-c` 不校验键名（今日实测），所以**绑定层是键名的唯一出处**，测试对每个 Codex 键做字面断言，防手误。
- 迁移失败（JSON 坏、写不回）→ 用内存里迁移好的结果继续，下次启动再写；同现有 `reconcileBuiltins`。

### 6.8 测试

**`node --test`（裸跑）**
- `roleBinding.test.ts`：八个内置角色 × 三家的参数快照；每条 args 有对应 `BindingLine`；
  `resume:true` 时契约不出现、caps 仍出现；omp 减到空留 `read`；Codex 键名字面断言。
- `roles.test.ts`（新）：v1 → v2 迁移的每一行；`allow` 丢弃有日志；坏条目不拖垮整份。
- `adapters.test.ts` / `launch.test.ts`：改成断言「调了 bindRole 并把结果放对位置」，
  变长参数仍在最后那条保留。

**真机验证（隔离配置目录，绝不在真实 `~/.codex` / `~/.claude` 上测，见 [[eas-term-测登录别毁凭证]]）**

| 场景 | 判据 |
|---|---|
| 勘探员 · Claude | `system:init` 的 `tools[]` 不含 Write/Edit |
| 勘探员 · Codex | 让它写文件 → stderr `patch rejected: writing is blocked by read-only sandbox` |
| 勘探员 · omp | ACP `session/new` 后工具清单无 write/edit |
| `shell:false` · Codex | 复跑第十一节探针 → `NO_SHELL_TOOL` |
| 画师 · Codex | `--disable image_generation` 后让它生图 → 报无此工具（**这一条决定该格子是 hard 还是 degraded**） |
| 恢复会话 · Claude | `--resume` 后 `tools[]` 仍无 Write |
| 编辑器矩阵 | 与 `bindRole` 输出逐格一致（CDP 读 DOM 比对） |

---

## 七、分阶段

**阶段一 · 内核（可独立发版）**
`AgentKind` 扩 omp → schema v2 + 迁移 → `shared/roleBinding.ts` + 测试 → 三个 adapter 与
omp launch 改调绑定层 → Codex 沙箱 / shell 开关接上 → omp model/effort 接上。
界面暂时只改编辑器里那两段说明的措辞（防止说错），矩阵 UI 放阶段二。

**阶段二 · 界面与旁路**
编辑器三列矩阵 → 工具栏降级标记 → 终端路 `CanvasAgentBar` 改调绑定层 → `team_spawn` 加 `roleId`。

**阶段三 · 待验项转正（每项先实测再改矩阵档位）**
Codex `--disable image_generation` 效果 → Codex `mcp_servers.<名>.disabled_tools` 精确过滤 →
Codex hooks（`hooks.json` + 信任机制）能否做逐次审批与写拦截 →
Claude 侧用 PreToolUse hook 拦 Bash 里的写操作（封 `write:false` 的逃生口）。

---

## 八、待决项（本该当面问的，我按下面的假设写了）

1. **删 `allow` 还是改名 `autoApprove`（仅 Claude）？** 假设：删。没有内置角色用它，
   审批另有机制。要留的话进 `raw.claude`。
2. **终端节点上的 Codex 要不要在 `write:false` 时重新拼 `-s read-only`？** 之前用户取消了
   终端的权限档位（`buildCodexCmd` 注释）。假设：只在 `write:false` 时拼，其余照旧不拼。
   不拼的话「勘探员 + 终端 + Codex」等于没有写保护，矩阵里会标 `unsupported`。
3. **勘探员 / 验官要不要默认 `shell:false`？** 开了才真封死写文件的逃生口，
   但会让它们跑不了 `grep` / `git log`。假设：**不开**，矩阵附注说明；用户自建角色随意。
4. **Codex 契约键维持 `instructions` 还是换 `developer_instructions`？** 两者今日都验证生效。
   假设：维持现状，避免无收益的变更；`developer_instructions` 记为备选。
5. **`imageGen` 要不要作为一等意图？** 假设：要。它对应用户的第一条红线，
   而 Codex 0.147 内置生图默认开着，不做一等公民就没地方接 `--disable image_generation`。

---

## 九、评审团

| 视角 | 结论 |
|---|---|
| 完成性 | 三条路径、三家 harness、八个内置角色全覆盖；阶段三留的是「能力存在但未验」的项，不是漏项 |
| 体验 | 用户改一张卡，三家同时生效；降级只在有降级时提示，不常驻噪音 |
| 安全 | Codex 从「无写保护」变成三家里最硬的；`caps` 只能收紧不能放开；raw 逃生口有标注 |
| token 成本 | 零新增：契约文本不变，参数拼装在进程外；绑定层纯函数无 IPC |
| 维护 | 三处重复归一；说明文字由代码生成不会脱节；加第四个 harness = 矩阵加一列 |
| 风险 | 迁移改用户文件（有备份、逐条 sanitize）；Codex `-c` 不校验键名（测试字面断言兜底） |

---

## 十、要同步的图纸（与实现同一个 commit）

- `03-agent角色边界.md` 3A：**现在那段「AI 对话节点不套用角色 tools，`StartOpts` 里根本没这个字段」已经过时**
  （`roleTools` 早已在 `StartOpts` 里），本次一并改写为 caps + 绑定矩阵。
- `10-模块领地图.md`：`shared/` 加 `roleBinding.ts`。
- `11-MCP工具网络.md`：Codex 段补 `disabled_tools` / `--disable` 两条开关。
- `13-所有权矩阵.md` 跨文件同步清单：加「改 `caps` 字段 → 改 `roleBinding` 矩阵 → 改编辑器矩阵测试」。
- `docs/cli-headless-接口实测.md`：今日 Codex 0.147 补测已追加。

---

## 十一、今日探针（可复跑）

macOS 没有 `timeout`，用 `perl -e 'alarm N; exec @ARGV' --` 代替。全部在 `/tmp` 下、
`--ephemeral --skip-git-repo-check -s read-only`，不落会话文件。

```bash
# 未知键不报错（对照：缺失的指令文件会早退报错）
codex exec --ephemeral --skip-git-repo-check -s read-only -c 'bogus_field_xyz=1' "hi"

# 三种指令键都生效
codex exec ... -c 'developer_instructions="Reply with exactly the single word PINEAPPLE and nothing else."' "hi"   # → PINEAPPLE
codex exec ... -c 'instructions="Reply with exactly the single word MANGO and nothing else."' "hi"                 # → MANGO
printf 'Reply with exactly the single word KIWI and nothing else.\n' > /tmp/i.md
codex exec ... -c 'model_instructions_file="/tmp/i.md"' "hi"                                                        # → KIWI（整份替换）

# 摘掉 shell
codex exec ... --disable shell_tool "Run the shell command: echo EAS_SHELL_OK. If you have no way to run shell commands, reply exactly NO_SHELL_TOOL."  # → NO_SHELL_TOOL

# MCP 工具级过滤键被接受（效果待验）
codex exec ... -c 'mcp_servers.x.command="echo"' -c 'mcp_servers.x.disabled_tools=["a"]' -c 'model_instructions_file="/tmp/missing.md"' "hi"  # 走到读文件报错，说明键已通过解析

# feature 清单（image_generation / hooks / shell_tool 都在）
codex features list
```
---

## 十二、阶段一真机验证（2026-09-05）

隔离实例：`npm run build` + `node scripts/verify-app.mjs --seed`（临时 `--user-data-dir`，CDP 9333），
跑 JS 用 `node scripts/eval-in-app.mjs`。会话一律经 `window.api.agentChat.start({cli, cwd, message,
skipApprovalHook:true, roleBounds})` 起（走的就是对话节点那条 IPC），cwd 是 `/tmp/eas-rolecheck`
（临时 git 仓库，Codex 不吃非 git 目录）。进程参数靠 0.15s 轮询 `ps -ww -eo pid,command` 抓，
因为短会话的进程活不过一次手敲。**没有让任何 CLI 生成图片**（红线），第 6 条改成问它有没有那个工具。

| # | 场景 | 结果 | 看到了什么 |
|---|---|---|---|
| 1 | 首启读旧 `roles.json` | ⚠️ 前提不成立，其余通过 | **用户机器上 `~/.eas/roles.json` 本来就不存在**（`~/.eas/` 里只有 `dict-*.json` 与 `agent/`），没有 v1 存档可迁、也无从备份；按裁定不造夹具。改核「内置角色 → 界面 → 落盘」这条链：`roles:list` 回 8 个角色，**没有一个带 `tools`**，`scout`/`inspector` 是 `caps:{write:false}`、`illustrator` 是 `caps:{imageGen:false}`；角色编辑器里勘探员的三枚开关读出「不许改文件 = 亮 / 不许跑命令 = 灭 / 不许生图 = 灭」；点保存后 `~/.eas/roles.json` 落成 `version: 2`、8 个角色无一带 `tools`。验证后已把它挪成 `~/.eas/roles.json.verify-2026-09-05`，恢复成验证前「没有这个文件」的状态 —— 正式版 0.4.78 还跑着，它那套 v1 清洗读到 v2 会把 `caps` 整个丢掉，等于把勘探员的写限制卸了。**v1→v2 迁移本身真机没验到**，只有 `rolesSchema.test.ts` 的单测钉着 |
| 2 | 勘探员 · Claude 对话节点 | ✅ | 进程参数末尾 `--disallowedTools Write Edit NotebookEdit`；问「你的工具清单里有没有 Write 工具」→「**没有**。我当前的工具清单里没有 Write 工具（有 Read、Bash、Agent 等，Write 和 Edit 目前不在其中）。」<br>**另有一条要记的**：先前让它「把 hello 写进 `/tmp/eas-rolecheck/out.txt`」，它**用 Bash 写成功了**（事件是 `exec.start`/`exec.done`，文件真出现）—— 正是 `bindRole` 那句「Bash 未禁，模型仍可用命令改文件」的真机复现，也正是编辑器那条橙色提示要说的事 |
| 3 | 勘探员 · Codex 对话节点 | ✅ | 参数 `codex exec --json --sandbox read-only …`；让它用 shell 写文件 → 回「失败。报错原话：`zsh:1: operation not permitted: /tmp/eas-rolecheck/out2.txt`」，文件确实没被创建。**不是简报预期的 `writing is blocked by read-only sandbox` 那句** —— macOS 上拦下来的是 seatbelt，报的是 OS 的话；判据（写不进去）成立 |
| 4 | 勘探员 · 默认 harness | ❌ 未验证 | 隔离实例里 omp 起不来：先报「这个版本的安装包里没有随附 omp 可执行文件」（把二进制拷进 `resources/omp/mac-arm64/` 后过了这关），再报「还没配好模型服务商」。`userData/omp` 是 `verify-app.mjs` 的**禁复制**项（凭证），补种 `omp-setup.json` 只过得了第一道 `ompLaunchGate`，第二道要 omp 自己列得出模型。**进程压根没 spawn，`--tools=` 无从观察**；那条减法目前只有 `launch.test.ts` 的单测钉着 |
| 5 | 自建角色勾「不许跑命令」· Codex | ✅ | 参数 `codex exec --json --sandbox workspace-write --disable shell_tool …`；让它 `echo EAS_SHELL_OK` → 回 `NO_SHELL_TOOL` |
| 6 | 画师 · Codex | ✅（结论：**维持 `degraded`**）| 参数含 `--disable image_generation`。**没让它生成任何图片**，只问「你有没有图像生成类工具？只回答有或没有，不要调用任何工具」→ **「有」**；追问工具名 → **`imagegen`**。也就是说 `--disable image_generation` 没把内置生图摘掉（或至少模型仍认为它在），`roleBinding.ts` 里 `imageGen` × codex 那格**维持 `degraded`**，本任务不动档位（升档属阶段三）|
| 7 | 恢复会话 · Claude 勘探员 | ✅ | 同一条 `ps` 行里同时有 `--resume 737de5ef-0b53-4438-8b78-a98d1091796c` 与 `--disallowedTools Write Edit NotebookEdit`；`session.ready` 回的是同一个 CLI 会话 id；再问「有没有 Write」→「没有（当前直接可用的工具清单里没有 Write，延迟加载列表里也没有）。」—— 「回溯也要拼」那条注释成立 |
| 8 | 终端节点 ▶ 勘探员 · Codex | **N/A** | `CanvasAgentBar` 2026-09-03（commit `5734a00`）已下线：全仓库对它的 import 只剩 `CanvasRoleEditor.tsx` 取 `getProbe`，`<CanvasAgentBar` 只出现在 `PaneView.tsx` 的注释里；跑起来的实例里 `.agentbar` 与 `.ab-*` 各 0 个。**没有 UI 入口，就没有「终端里出现的命令」可看** |
| 9 | 编辑器 omp 列 | 一半 ✅ 一半未验证 | 前半通过：在勘探员的「默认 harness」输入框填 `anthropic/claude-sonnet-4-5` → 保存 → 落盘文件里 `scout.model = {"claude":"opus","omp":"anthropic/claude-sonnet-4-5"}` → 关掉重开编辑器，值还在。后半未验证：同第 4 条，omp 会话起不来，`session.ready` 的 model 无从核对 |

**验证过程里踩到、值得留下的两条**

- **先确认连的是哪个实例。** 机器上残留着上一轮任务的孤儿 `verify-app.mjs`（ppid=1）占着 9333，
  第一次连上去验的其实是**主仓库的旧代码** —— `roles:list` 回的是 v1 的 `tools`，
  看起来像「caps 根本没生效」。判据有两条，都要落在 worktree 上：`/json/list` 里那个 page 的 url、
  以及 electron 进程的 cwd（`lsof -a -p <pid> -d cwd`）。
- **`~/.eas/` 不跟随隔离目录**（`roles.ts` 用 `os.homedir()`，`--user-data-dir` 管不着它）。
  所以在隔离实例里点「保存角色」写的是**用户真实的** `~/.eas/roles.json`，
  而用户的正式版正读着同一个文件。要验落盘就得连带把文件恢复回去。


---

## 十三、阶段二真机验证（2026-09-05）

隔离实例：`npm run build` + `node scripts/verify-app.mjs --seed`（临时 `--user-data-dir`，CDP 9333），
跑 JS 用 `node scripts/eval-in-app.mjs`，hover 与截图另用 CDP `Input.dispatchMouseEvent` /
`Page.captureScreenshot`（一次性脚本，没进仓库）。开始前先杀掉上一轮留下的孤儿实例
（`lsof -i :9333` 抓到一个 ppid 已飘走的 Electron，临时目录 `eas-verify-XIyNWd`），
并按第十二节那条判据确认连的是 worktree：进程 cwd = `…/terminal-wt/roles-phase2`、
page url 指向该 worktree 的 `out/renderer/`。

**全程没有点保存**，`~/.eas/roles.json` 自始至终不存在（只有第十二节挪走的
`roles.json.verify-2026-09-05`），验完复查过一次。**没有起任何真实 CLI 会话**
（只建对话节点、不发消息），也**没有碰多 agent 开关**。
验证用的对话节点建在 `工作流程skill组合规范` 这个空 Frame 上（`addAgentNode`）。

| # | 场景 | 结果 | 看到了什么 |
|---|---|---|---|
| 1 | 打开画师的编辑器 | ✅ | `.re-matrix tbody tr` **3 行**（不许改文件 / 不许跑命令 / 不许生图），表头是 `Claude` `Codex` `默认 harness`。「不许生图」行 Claude 格 `.re-lv` = **「硬」**（`--disallowedTools mcp__*image* … mcp__*stable*diffusion*`），Codex 格 = **「降级」**（`--disable image_generation（2026-09-05 实测未摘掉内置生图…）：无匹配`），omp 格 = 「降级」。画师只点亮了 imageGen，所以另两行带 `tr.off`（压暗预览），生图行不带 —— 与 `capMatrix` 的「未点亮按假设点亮预览」一致。截图 `/tmp/verify1-matrix.png` |
| 2 | 点亮「不许改文件」→ 再点亮「不许跑命令」 | ✅ | 点亮前 write 行 `off=true`；点亮「不许改文件」后 **`tr.off` 消失**（`off=false`），Claude 格 how = `--disallowedTools Write Edit NotebookEdit；Bash 未禁，模型仍可用命令改文件`（**含 Bash**）；再点亮「不许跑命令」后同一格变成 `--disallowedTools Write Edit NotebookEdit`（**不再含 Bash**）。那句橙色提示要说的事，矩阵自己就说清楚了。改完点「取消」退出，没落盘 |
| 3 | 对话节点选画师 + Codex | ✅（「换行」那半未触发，见下） | 工具栏 CLI 从下拉里换成 `Codex` 后，角色名「画师」右边**出现 `.rolepick-warn`**，徽章文字「降级」，可见（`rect` 在视口内）。用真实指针 `mouseMoved` 悬上去 → `.app-tooltip` 出现，文本 = `不许生图：--disable image_generation（2026-09-05 实测未摘掉内置生图，模型仍自称有 imagegen 工具，仅按名关 MCP server）：无匹配`，**含「不许生图」**。截图 `/tmp/verify3-warn.png` |
| 4 | 同一节点切回 Claude | ✅ | 只动 CLI 下拉、角色仍是画师：`.rolepick-warn` 数量 **1 → 0**。工具栏读回「Claude Code」+「画师」，标记消失 |
| 5 | 选勘探员 + 任意 CLI | ✅ | Claude 下 `.rolepick-warn` = 0；Codex 下把 8 个内置角色逐个套一遍，**只有画师有标记**，勘探员等 7 个都是 `null`。原因也核到了：勘探员矩阵里点亮的「不许改文件」行三家都是**「硬」**，而它那行「不许生图」虽然 Codex/omp 显示「降级」却带 `tr.off`（没点亮）—— `degradedLines` 只数**真点亮**的能力，不数预览行 |
| 6 | `team_spawn` 带 `role_id: 'scout'` | ❌ **未验证（需真实 MCP 调用）** | 按裁定**没有**去打开用户项目的多 agent 开关、也没有调真实 `team_spawn`。弹窗那条路也走不通：`TeamBatchHost` 的数据源 `batchRequest.ts` 是模块级 store，`askForBatch` / `__resetBatchState` 都**没有挂到 `window`**，页面上下文里没有合法入口塞一份 spec 进去。这条目前靠 Task 4 的单测钉着：`batchSpec.test.ts` 四条（不填就没有 `roleId` 字段 / `role_id` 与 `roleId` 两种键都收 / 不在已知角色卡里整批拒并列出可用 id / 不传 `knownRoleIds` 时只透传不校验）+ `teamRoster.test.ts` 一条（`roleId` round-trip，重派找得回那张卡）|

**这一轮新踩到、值得留下的三条**

- **`.ac-ctxbar-name` 一查 51 个，能看见的只有 3 个。** 所有 tab 的所有 leaf 都渲染在同一个容器里
  （PaneLayer 那条老规矩），没被 Frame 引用的只是 `display:none`。按 `getBoundingClientRect()`
  真比视口筛过再动手，否则点到的是别的项目的工具栏。
- **`addAgentNode(frameId)` 会静默返回 `undefined`** —— 如果那个 Frame 的 `projectId` 已经不在
  `projects` 里（画布上有 23 个 Frame，只有 21 个的项目还在）。它拿 `projectId` 去反查新建的 leaf，
  项目不存在时 `tab.projectId` 落成 `null`，反查落空。**先确认 Frame 的项目还在**，别对着空列表怀疑自己。
- **工具栏那个 CLI 是组件内 `useState`，不是 store。** `setAgentCli(...)` 写的是 `pane.cli`，
  而 `RolePicker` 收的 `cli` 来自组件里的 `selected` —— 直接调 store 会看到「`pane.cli` 已经是 codex，
  界面还写着 Claude Code，标记也不出来」。要换 CLI 只能点那个下拉（`.canvas-ctxmenu`）。

**一处如实记下的落差**：判据 3 原本还要求 tooltip「有换行」。真机上**没有任何一对（内置角色 × CLI）
能凑出两行** —— 逐个扫过：Claude 上三个意图全是「硬」（0 行降级），Codex / omp 上只有画师的
「不许生图」一项降级（1 行）。多行那条路（`warn.map(...).join('\n')` + `.app-tooltip`
的 `white-space: pre-line`，两处都已确认在）**代码在、真机没触发**；要触发得自建一个同时踩中
两项降级的角色，而那要写用户真实的 `~/.eas/roles.json`，本轮不做。

---

## 十四、阶段三探针（2026-09-06）

第十二节判据 6 当时只结论到「模型自称有 `imagegen` 工具，`--disable image_generation`
没能让它松口」，把档位维持在 `degraded`、升档留给阶段三。这一节把「为什么松不了口」
摸清楚，并据此把 Codex 的 `imageGen:false` 从 degraded 升到 hard。

**实测环境**：本机 Codex 0.147.0。证据日志在 `/tmp/codex-trace-*.log`、`/tmp/codex-ts-*.log`、
`/tmp/fake-openai-*.json`（探针脚本本身不进仓库，按下面的命令现场复跑）。**没有让任何一次
探针真的生成图片** —— 全部只问模型「有没有这个工具」或直接读请求体/事件日志。

### 1. 内置 `image_gen` 工具在本机从未进入模型的工具清单

三种鉴权模式都验了，结论一致。下面每条命令都带着公共基底 flags
（`--ephemeral --skip-git-repo-check -s read-only`——一次性会话、跳过 git 仓库检查、
全程只读沙箱，纯探针不需要写权限），照抄能逐字复跑：

```bash
# 自定义 provider：起一个记录请求体的本地 HTTP 服务当假端点（脚本本身不进仓库），
# 对照有无 --disable image_generation
codex exec --ephemeral --skip-git-repo-check -s read-only \
  -c 'model_provider="fake"' -c 'model_providers.fake.name="fake"' \
  -c 'model_providers.fake.base_url="http://127.0.0.1:<port>/v1"' \
  -c 'model_providers.fake.wire_api="responses"' \
  "hi" >/tmp/codex-trace-1.log 2>&1
# 加一次 --disable image_generation 再跑一遍，diff 请求体里的 tools 数组 —— 完全一致：
# exec_command, write_stdin, list_mcp_*, update_plan, request_user_input,
# request_plugin_install, apply_patch, view_image, tool_search, web_search

# API key 模式：同一个假端点，换成 apikey 鉴权 + 关掉请求压缩方便直接读明文请求体
codex exec --ephemeral --skip-git-repo-check -s read-only \
  -c preferred_auth_method="apikey" \
  -c openai_base_url="http://127.0.0.1:<port>/v1" \
  --disable enable_request_compression \
  "hi" >/tmp/codex-trace-2.log 2>&1
# tools 清单同上，仍然没有 image_gen

# ChatGPT 登录模式（真实后端）：RUST_LOG=trace 打出服务端回显的 response.tools，
# 同样没有 image_gen；再让模型自己 tool_search 一次
codex exec --ephemeral --skip-git-repo-check -s read-only \
  "搜索 'image_gen built-in image generation gpt-image'，tool_search limit 20，
只列出返回的工具名，不要调用任何工具"
# 返回的全是 MCP / codex_apps 工具，没有内置生图

# 对照组：--disable shell_tool 时 exec_command / write_stdin 确实从清单消失，判据有效
codex exec --ephemeral --skip-git-repo-check -s read-only --disable shell_tool "..."
```

### 2. `--disable image_generation` 确实生效——只是生效的东西本来就不在清单里

```bash
codex features list --disable image_generation
# image_generation 的 effective state：true → false
```
turn 日志里的 feature 集合同步少了 `ImageGeneration`。**这条 --disable 因此仍然保留**：
它把 feature 的 effective state 真的扳成了 false，只是本机这个内置能力从未进过工具清单，
所以摘不摘它，模型能不能生图这件事本身不受影响。

### 3. 模型嘴上说的「imagegen 工具」是系统 skill，不是内置工具

请求体的 `### Available skills` 段里列着 `$CODEX_HOME/skills/.system/imagegen/SKILL.md`。
读它的内容：教模型优先调用内置 `image_gen`，若不可用则兜底跑 `scripts/image_gen.py`
（脚本内部读 `OPENAI_API_KEY` 直接调 OpenAI 的图片接口）。第十二节判据 6 里模型答的
「有，工具名 imagegen」，指的就是这个 skill 声称自己会做的事，不是一个真实存在的工具。

### 4. 按路径禁用系统 skill——路径必须精确到 `SKILL.md` 文件

```bash
codex exec --ephemeral --skip-git-repo-check -s read-only \
  -c 'skills.config=[{path="/Users/biily/.codex/skills/.system/imagegen/SKILL.md",enabled=false}]' \
  "..."
# 请求体里 imagegen 的提及次数：2 → 0，`### Available skills` 段不再列它
```
**写目录无效**（实测过，`path` 指到 `.../imagegen/` 这一层不生效，必须是 `SKILL.md` 本身
的完整路径）。这是本次升级到 hard 的真正依据：feature 开关摘不掉内置能力（因为它本来
就没上桌），系统 skill 才是模型嘴里那个「imagegen 工具」的来源，摘掉它才是真的把
「模型自认为会生图」这件事掐掉。

### 5. 残余：环境里的 `OPENAI_API_KEY`

若子进程环境里带 `OPENAI_API_KEY`（Eas-Term 的 `PROBE_ENV` 是展开的 `process.env`，
从终端起 app 会继承外部 shell 的环境变量），即便 skill 被摘掉、模型手上没有现成的
「叫我生图」的指令，它仍可能自己手搓一条命令去跑 `image_gen.py`（脚本还在磁盘上，
Bash 没被禁）。这与「`write:false` 留着 Bash 仍能改文件」是同一类逃生口——只在
`bindRole` 的报告行里如实注明（`若环境有 OPENAI_API_KEY，skill 的 CLI 兜底仍可被手动跑`），
**不因此把判定档位往下调**。

### 落地

按上面 1–5 条，`shared/roleBinding.ts` 的 `imageGen:false` × Codex 分支改为：
`--disable image_generation`（保留，理由见第 2 条）+ 有 `codexHome` 时按 `SKILL.md`
完整路径摘掉 imagegen 系统 skill（`-c 'skills.config=[...]'`，导出为
`codexSkillsConfigArg()`）+ 按名关匹配到的 MCP server；有 `codexHome` 时档位升级为
**hard**，没有时维持 **degraded** 并在 `how` 里如实写人话「未摘掉 imagegen 系统 skill
（这条路径拿不到 Codex 配置目录）」，不再是「调用方未给 codexHome」这种内部黑话。
`codexHome` 由 `main/agent.ts` 新导出的 `codexHome()` 算（`CODEX_HOME` 或 `~/.codex`，
`codexServers()` 复用同一个函数），`session.ts` 起 Codex 会话时算好塞进
`StartOpts`/`SessionRecord`，跟 `knownMcpServers` 一样要原样带过 restart。

**评审修复（2026-09-06）**：初版只有对话节点（`session.ts`）会算 `codexHome` 塞进
`StartOpts`，渲染层的 `RolePicker`（对话工具栏降级徽章）与 `CanvasRoleEditor`
（能力矩阵）拿不到——于是「画师 × Codex」真实会话已经是 hard，界面却照旧显示成
degraded。修法：`main/agent.ts` 新增 IPC `agent:codexHome`（返回 `codexHome()`），
`preload/index.ts` 的 `agent` 命名空间照 `codexServers` 的写法加 `codexHome()`；
两个组件各用一个 `useState<string | undefined>` + `useEffect` 取一次，传进
`degradedLines` / `capMatrix` 的 ctx。现在拿不到 codexHome、因此仍是 degraded 的
只剩终端命令条 `CanvasAgentBar` 那条**已下线**路径——它的 `buildCodexCmd` 故意不传
`codexHome`（见该文件内注释：无 UI 入口，只求类型跟 `roleBinding` 同步，不求真的
摘掉过 skill）。

**已知副作用**：`-c skills.config=[...]` 是**整体覆盖**用户 `~/.codex/config.toml`
里的 `skills.config`，不是追加——如果用户自己也手写了这个键，会被这条整个覆盖掉。
未做「读用户配置再合并」，属于阶段三的已知取舍，不是遗漏。

**Windows 路径未实测**：`codexHome` 若形如 `C:\Users\x\.codex`（含反斜杠），拼
`SKILL.md` 路径时跟着 `codexHome` 自己出现的分隔符走（`codexHome.includes('\\')
? '\\' : '/'`），测试里断言过 `C:\Users\x\.codex` → `C:\Users\x\.codex\skills\.system\
imagegen\SKILL.md`（经 `codexSkillsConfigArg` 转义后是合法 TOML），但没有在真实
Windows 机器上跑过 `codex` 验证这条路径真的能被读到。

### 十四·附 · 真机核对（2026-09-06，隔离实例 CDP，代码 b44a3ce）

| 核对项 | 看到了什么 |
|---|---|
| `window.api.agent.codexHome()` | 返回 `/Users/biily/.codex`，IPC 通 |
| 画师的编辑器矩阵「不许生图」行 | Claude 格「硬」；**Codex 格「硬」**，how 以「--disable image_generation（feature 生效状态实测为 false；本机内置 image_gen 本就不在工具清单）+ 摘掉 imagegen 系统 skill…」开头；默认 harness 格「降级」 |
| 画师 + Codex 的对话节点 | 角色按钮 aria-label「角色：画师」，**无** `.rolepick-warn` 徽章 |
| 画师 + 默认 harness 的对话节点（对照） | aria-label「角色：画师（部分限制在当前 CLI 上打了折扣）」，徽章「降级」，tooltip「不许生图：无内置生图；图像类 MCP server 按名整个不连」—— 证明徽章机制活着，Codex 上消失是档位真的升了 |
| adapter 生成的 `-c skills.config=[{path="/Users/biily/.codex/skills/.system/imagegen/SKILL.md",enabled=false}]` 实跑 | Codex 接受；假端点抓到的模型请求里 `imagegen` 提及 0；`codex features list --disable image_generation` 该项 effective=false |

未验：`team_spawn role_id` 仍无真实 MCP 调用；Windows 路径分隔符只有单测。

### 十四·附二 · 用户决定（2026-09-06）

> 用户原话：「画师也不关：把画师卡的『不许生图』默认取消，Codex 的 imagegen 在所有角色下都在，红线只靠契约文字兜着。」

- `builtinRoles.ts` 的 `illustrator` 删掉 `caps: { imageGen: false }`，desc 改「视觉产出。生图走用户指定路径」；契约文字不变。
- `caps.imageGen` 开关与上面探针得出的 Codex 落法（关 feature ＋ 摘系统 skill ＋ 按名关 server，hard）**全部保留**，只是内置角色不再默认用它；自建角色勾了照常生效。
- 老 v1 存档里画师若带着七个 `mcp__*image*` 通配，迁移仍忠实落成 `imageGen=false`（文件里明写的），要放开得在编辑器里手动灭掉。
- 快照测试 `builtinRoles.test.ts` 改为断言画师**无 caps**，并单独钉一条「imageGen 开关对自建角色仍有效」。
