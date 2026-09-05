# 角色卡片 × 三个 harness 的绑定层

> 状态：**阶段一已实现**（见 [plans/2026-09-05-角色卡片三harness绑定层.md](../plans/2026-09-05-角色卡片三harness绑定层.md)）；阶段二、三未动。
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
（终端契约走文件、要 shell 引用）。

**一条硬规矩：报告是绑定的副产物，不是另写的说明。** 每条 `args` 都由某个 `BindingLine`
产生，测试断言两者一一对应。这样编辑器里那段「粒度差异」永远与真实参数一致。

### 6.3 绑定矩阵

| 意图 | Claude | Codex | omp |
|---|---|---|---|
| `write:false` | `--disallowedTools Write Edit NotebookEdit` · **hard**；报告附注「shell 未禁时 Bash 仍能写」 | `-s read-only` · **hard**（OS 沙箱，连 shell 写一起挡） | `--tools` 去掉 `write edit ast_edit` · **hard**；附注同 Claude |
| `shell:false` | `--disallowedTools Bash` · **hard** | `--disable shell_tool` · **hard**（今日实测） | `--tools` 去掉 `bash` · **hard** |
| `imageGen:false` | `--disallowedTools mcp__*image* mcp__*dalle* …`（沿用 roles.ts 那组通配） · **hard** | `--disable image_generation`（**待验**，验前标 degraded）＋ 通配匹配到的 server 整个 `enabled=false` | 无内置生图；通配匹配到的 server 从 `session/new` 剔除 · **degraded** |
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
  不再手写。
- **对话工具栏**：起会话前若该角色在当前 CLI 上有 `degraded` / `unsupported` 行，
  角色名旁加一个可 hover 的小标记，展开列出那几行。**只在有降级时出现**，不常驻。
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

