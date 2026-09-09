# 03 · Agent 角色边界图

> 分两半读，**别串味**：
> **3A** 是产品能力 —— Eas-Term 托管起来的 agent 各自能干什么，边界由**代码**强制。
> **3B** 是开发纪律 —— 改这个仓库的 agent（你）的禁区，边界靠**文档**约束，没有代码兜底。

---

# 3A · 产品内 agent 角色边界

## 角色（`src/main/roles.ts` 的 `BUILTIN_ROLES`，落盘 `~/.eas/roles.json`，用户可改）

每个角色是**可执行配置**（模型 / effort 按 harness 分键、能力意图 `caps`、原始逃生口 `raw`、contract 文本），
不是人设文案。翻译逻辑只在 `shared/roleBinding.ts` 一处：`bindRole(bounds, kind)` → 各家参数 + 报告行
（`hard` / `soft` / `degraded` / `unsupported`）。
`contract` 经 `--append-system-prompt-file`（Claude）或内联单行（Codex，无对应文件参数）下发。

> ⚠️ **存档 version 2 反向不兼容**：被 0.4.78 及更早版本读到会把 `caps` 整份丢掉（那版按 v1
> 清洗且不看 `version`），勘探员/验官的写保护（以及自建角色勾的任何能力边界）会静默解除而界面看着一切正常 ——
> 回滚旧版前先从 `.eas-backup` 取回（细节见 `src/main/roles.ts` 文件头）。

> **写权限只由 `caps.write` 决定，跟角色名没关系。** 内置角色里有代码兜底的只剩一处：
> `scout` / `inspector`：`caps.write=false`（Claude 去 `Write`/`Edit`/`NotebookEdit`；
> Codex `-s read-only`，OS 沙箱连命令行写入一起挡；omp `--tools` 去 `write`/`edit`/`ast_edit`）；
> **Claude 上现在是两道闸（阶段三第三项，2026-09-06）**：第一道 deny 三个内置写工具；
> 第二道是 `--settings` 附一条 PreToolUse hook（`resources/agent-hooks/eas-write-guard.mjs`），
> 按命令模式拦 Bash 里的写操作（重定向、`tee`、`sed -i`/`--in-place`/`perl -pi`、
> `rm`/`mv`/`cp`/`mkdir`/`touch` 等、git 写子命令、包管理安装、`find -delete`/`-exec`、
> `curl -o`/`wget`/`tar -x`/`unzip` 这类会落文件的命令，2026-09-06 评审后再加上
> 换行/单个 `&` 分段、`sudo`/`env`/`nohup`/`xargs`/`nice`/`timeout`/`(...)`/`bash -c "…"`/
> `eval "…"` 这类包装词与子 shell 绕过；**最终复审又补上**：包装词自己带的选项
> （`sudo -u x rm y`、`nice -n 10 rm x`、`timeout 5 rm x`）、段首裸赋值（`FOO=1 rm x`）、
> 引号感知的分段器）——补的正是"Bash 未禁时模型仍可用命令改文件"这个逃生口。
> 只在 `shell` 没有一起禁掉时才附这道闸（`shell:false` 时 `--disallowedTools Bash`
> 已经挡死，守卫是死重量）。
>
> 这道闸按字符串模式匹配，不是 Codex 那种内核级沙箱。**已知漏网清单**（如实记录，
> 不是遗漏；与 `resources/agent-hooks/eas-write-guard.mjs` 文件头、spec 十四·附四
> **逐字同口径**，改一处要三处一起改）：
>
> - 写操作藏在**外部脚本文件**里（`bash foo.sh`、`python3 script.py`）——这里只看得到调用它的那一行命令，看不到脚本内容；
> - `cat <<EOF > file` 这类 heredoc 之外的花样组合，或者用变量拼出来的重定向目标；
> - **heredoc 喂解释器 stdin**（`python3 - <<EOF`）——要写的内容在后面几行里，命令行这一行看不出写意图；
> - 任何用引号/转义把写意图藏起来、让字符串匹配失焦的命令；
> - **引号里的 awk/perl 重定向**（`awk '{print > "out"}' f`）——判重定向前先剥掉成对引号里的内容（为的是不误拦 `grep -c ">" f`），真的重定向被一起剥掉了；
> - **间接/远端执行**：`ssh host rm x`、`docker run … rm`、`osascript`、`defaults write`——真正落盘的不是本机这一条命令，命令词是 ssh/docker/osascript；
> - **`apt-get install` / `npx create-*`**：装包与脚手架会落一堆文件，不在 `npm|pnpm|yarn|bun|pip|brew|cargo` 那份安装子命令清单里；
> - `rmdir`、`git branch <name>`（创建/列出分支，不含 `-d`/`-D`）等不在简报列出的写命令词清单里，按简报字面执行，不额外扩大匹配范围；
> - `sh|bash|zsh -c "…"` / `eval "…"` 的递归判断只剥一层「整段被一对引号包住」的最外层引号，嵌套引号或转义（`bash -c "echo \"x\" > f"`）按字面切，取出来的可能不是原本想递归判断的那条命令；
> - 包装词的选项表（`WRAPPER_OPTS_WITH_ARG`）只列到常用的那几个，遇到没列进去的「吃一个独立参数」的冷门选项会在参数上停错位置，那一条仍会放行；
> - **hook 起不来 = 静默放行**：node 兜底路径找不到可执行文件、脚本自己抛异常、Windows 上的兜底路径——Claude Code 的 PreToolUse hook 只有明确输出 deny 才拦，跑不起来 / 报错 / 没输出一律当「本 hook 无意见」放行，且没有任何用户可见的信号（**Windows 未实测**）。
>
> **omp 仍只有第一道**（`--tools` 去写工具，Bash 未禁的话同样能绕）。
> `illustrator`：**2026-09-06 起不再默认勾 `caps.imageGen`**（用户原话「我不要去缩减 Codex 的原生能力」，
> Codex 自带的 imagegen 系统 skill 在所有角色下保留），生图红线只靠契约文字兜着。
> `caps.imageGen` 开关本身保留给自建角色，落法：Claude 通配 deny，**hard**；omp 按名不连，degraded；
> Codex 侧 2026-09-06 阶段三探针升级：内置 `image_gen` 本机实测**从未进过工具清单**
> （`--disable image_generation` 前后 tools 清单完全一致），模型嘴上说的「imagegen 工具」
> 其实是系统 skill `$CODEX_HOME/skills/.system/imagegen/SKILL.md`；现在**关 feature（保留）
> + 按 SKILL.md 完整路径摘掉这个系统 skill（`skills.config` 的 `-c`）+ 按名关 MCP server**，
> 拿得到 `codexHome` 就是 **hard**：对话节点由 `session.ts` 起会话时算好塞进 `StartOpts`，
> 渲染层的 `RolePicker`（对话工具栏降级徽章）与 `CanvasRoleEditor`（能力矩阵）2026-09-06
> 起也经新增 IPC `agent:codexHome` 各取一份。拿不到——现在只剩终端命令条 `CanvasAgentBar`
> 那条已下线路径（它自己的注释写明故意不传 codexHome）——就退回 **degraded**。残余逃生口：子进程环境若带
> `OPENAI_API_KEY`，skill 的 CLI 兜底仍可被手动跑——与「write:false 留着 Bash 仍能改文件」
> 同一类逃生口，只在报告里如实注明，不因此改判定档位。其余角色的"不碰生产代码"（`prototyper`）、
> "不污染代码项目"（`writer`）**只是 contract 里的提示，不是强制**；角色还落盘在用户可改的
> `~/.eas/roles.json` —— 所以"某某角色是唯一能写码的"这句话在任何时刻都不成立。
>
> ⛔ **别为了让这句话成立去给其余角色补 deny**：`e2e` 必须能写码（它就是一条会话跑完 TDD
> 的角色）、`prototyper` 要写 `docs/prototype/` 下的 HTML、`writer` 要写成稿、`runner` 是
> **刻意无限制**的逃生口（`roles.ts` 注释原话："不给逃生口的系统会被绕过"）。要收紧先问用户。

> **对话节点调 `bindRole`**（`StartOpts.roleBounds`，IPC 边界过 `safeRoleBounds`）；
> 终端命令条 `CanvasAgentBar` 2026-09-03（commit `5734a00`）起**无 UI 入口**，
> 其 `buildClaudeCmd` / `buildCodexCmd` 仅与绑定层保持同步以便回滚。
> `team_spawn` 派的会话**也能套角色卡**（2026-09-05）：`agents[].role_id` 经 `checkBatch` 校验后
> 走 `openAgentPane({ roleId })` 落到 `pane.roleId` —— **和用户在工具栏手选角色是同一条路**，
> 之后的绑定与契约下发完全一致，没有第二套逻辑。
> Codex 的 MCP 名下发前按 `knownMcpServers` 过滤（`session.ts` 起会话时读 `~/.codex/config.toml` 一次）
> —— Codex 对不存在的 server 名会拒绝启动。同一处 `session.ts` 也算好 `codexHome`
> （`CODEX_HOME` 或 `~/.codex`，`agent.ts` 的导出函数 `codexHome()`）随 `StartOpts` 传给
> `bindRole`，两个字段都要**原样带过 restart**——Codex 的 exec 每条消息都会触发 restart，
> `SessionRecord` 上都各存一份，`effectiveOpts` 都要回填，理由完全一致（丢了就从第二条
> 消息起悄悄退回未过滤 / 未摘 skill 的状态）。
> 对话节点的 MCP 工具面另由 `--strict-mcp-config` + `--mcp-config`（只含自家 server）决定，
> 与 `caps` 是两层，不是同一层。
> **`caps.mcp.denyTools`（mcpTools 那格）在 Codex 上 2026-09-06 阶段三第二项起分两类**：
> 写得出确切工具名的条目（形如 `<server>__<tool>`，不含 `*`）落成
> `-c mcp_servers.<名>.disabled_tools=[…]`，按工具名精确摘掉、不牺牲整个 server，档位 **hard**
> （探针实测：延迟工具搜索结果里指定工具真的消失，判据不是问模型）；其余形状（含 `*`，
> 或不是这个形状）维持原状，通配降级为按 server 名整个 `enabled=false` 关掉，档位 **degraded**。
> 两类同时出现时报告各出一行。精确条目同样按 `knownMcpServers` 过滤——server 不在清单就不
> 下发（Codex 对不存在的 server 名会拒绝启动），不是"下发了但没效果"。

> **界面文案一律从 `bindRole()` 的报告派生，不许在组件里手写落法。** 编辑器的能力矩阵
> （`CanvasRoleEditor` 的 `.re-matrix`，每行一个能力 × 每列一家 harness）来自
> `capMatrix(bounds, ctx)`；对话工具栏角色名旁的降级标记（`RolePicker` 的 `.rolepick-warn`
> 与它的 tooltip）来自 `degradedLines(bounds, kind, ctx)`。两个函数都在 `shared/roleBinding.ts`，
> 档位与能力名走同文件的 `LEVEL_LABEL` / `CAP_LABEL` / `HARNESS_LABEL`。
> 要改措辞就改那张表 —— **手写的文案会和真正下发的参数悄悄分家**，界面写着"已禁用"而参数没带上，
> 谁都看不出来（阶段一就分过一次）。`team_spawn` 的确认弹窗是例外中的例外：它只显示套的
> 角色卡**名字**（`TeamBatchModal` 拿 `roleId` 去 `roles` 里查），不展开落法。

## 角色隔离与协同板（`isolation` · 角色 worktree · `.eas/board.md`，P1 已实现）

角色卡新增字段 `AgentRole.isolation?: 'worktree' | 'none'`（`src/shared/types.ts`），**不推断**——
和下面 `team_spawn` 的 `agents[].isolation` 是同一条纪律的两处独立实现，互不 import。内置角色里
`e2e` / `builder` / `prototyper` 默认 `'worktree'`，其余默认 `'none'`；`CanvasRoleEditor` 编辑器
「起会话时」给出两档开关，用户可改，改了写回 `~/.eas/roles.json`。

**建树时机与命名**：不在主进程 `agentChat:start` 里建（spec 原计划如此），改到**渲染层首发消息前**
——`AgentChatView` 先调 IPC `role:worktreeAdd(projectPath, roleId)`（实现在
`src/main/teamWorktreeOps.ts`，与 `team_spawn` 那套建树逻辑共文件不共前缀），因为 pane 要先知道
分支名才能画徽标、才能落 persist。目录与分支命名判断层在 `src/shared/roleWorktree.ts`（纯函数）：
`.worktrees/<roleId>-<6 位短 id>`，分支 `eas/<roleId>/<id>`——与团队派活的 `eas-team/…` 前缀区分开，
`git branch` 一眼分得清哪条是角色会话自己开的。cwd 不是 git 仓库时不静默降级：弹「这个目录不是
git 仓库，「<角色名>」会直接改主工作区，要继续吗？」确认，取消则不起会话，继续则落在主工作区
（`effectiveCwd` 退回原 cwd）。

**协同板**：主进程模块 `src/main/collabBoard.ts`（`registerCollabBoardHandlers`——**别与看板插件的
`src/main/board.ts` 搞混**，两者同名字段但毫不相干）。它要知道会话表却不 `import session.ts`，
改经 `setSessionSource()` 注入一个取会话列表的函数，避免主进程模块间循环依赖。跑 git、解析
`git status --porcelain` 的封装在 `src/main/gitExec.ts`（`parsePorcelain`，electron-free，
`collabBoard.ts` 与 `teamWorktreeOps.ts` 共用同一份，别各自摞一份判断逻辑）：固定带
`GIT_OPTIONAL_LOCKS=0`（避免和 agent 自己正在 commit 抢 `.git/index.lock`）与
`-c core.quotePath=false`（避免中文路径被转义成八进制、板上乱码且 overlap 判不出来）。

渲染纯函数在 `src/shared/board.ts`（`renderBoard` / `findOverlaps` / `clipForPrompt`，零依赖可
`node --test`；时间列用**本地**时区 —— 板是给坐在这台机器前的人读的，别改回 `getUTC*`。
`findOverlaps` 先按分支去重再判「≥2」：同一条分支上开着两个活会话不算撞车），
落盘常量 `BOARD_REL = '.eas/board.md'`（**写在被管理项目的项目根下，不是本仓库
目录**）。IPC `board:refresh` / `board:read` 都先把传入路径 `projectRootOf()` 归一到项目根
（worktree 里的 cwd 会被剥到 `.worktrees/` 之前，防止在工作树底下又长出一份）。

**刷新时机四处**：会话 spawn 之后、每次 `turn.done`、进程 exit、用户手动 stop —— 都过 500ms
防抖 + 同一项目内的 in-flight 请求合并；`writeBoard` 只在有行、或文件已存在时才落盘（没起过写码
角色的项目不会凭空长出 `.eas/`）；`.eas/` 目录被写进目标项目的 `.git/info/exclude`（幂等，不改
用户自己的 `.gitignore`）。

**注入**：起会话那一刻，`StartOpts.boardText`（截断 ≤20 行）拼进三家系统提示末尾的
`## 协同板（起会话时的快照）` 一段；会话中途变化不推送（三家 CLI 都没有中途注入系统提示的通道），
靠 MCP 工具 `board_read`（先 `refresh` 再 `read`，返回 `{ board, note?, path, ledgers? }`，`ledgers` 只在传 `ledgers: true` 时带，`path` 归一到
项目根 + `BOARD_REL`）随时查最新的一份，见 [11](11-MCP工具网络.md)。

**界面**：`BranchBadge.tsx` 在空态 `ac-ctxbar` 与对话态 `ChatToolbar` 都渲染；菜单三项——
「开终端」（`effectiveCwd`）、「合并到主干」（P2：在**同一 Frame** `addAgentNode` 起一个 `roleId:'merger'` 的合并官节点，
CLI 沿用本节点的；首条消息经 pane 的 `draft` **只预填不发送** —— 合并不可逆，得用户看一眼分支名再按发送；
`draft` 与 `initialMessage` 同构：`openAgentPane` 写入、`AgentChatView` 读后 `clearAgentDraft`，`persist.ts` 白名单不含它）、「删除 worktree」（有活会话禁用；
有未提交改动先拒、写清数量，二次确认走 force）。徽标变色的判据来自 `board.read().overlaps`
（两条**不同**活跃分支触及同一文件）。pane 的 `worktree?: { relPath, branch }`（`layout.ts` 的
`PaneState`）随 `persist.ts` 存读、画布恢复时 `canvasSlice.ts` 重建节点传给 `openAgentPane`，
重启实例后徽标还在 —— 前提是 `setAgentWorktree` 会 `paneSaveTick + 1` 把画布保存订阅叫醒，
见 [13](13-所有权矩阵.md) 的跨文件同步清单。

**换角色的闸门**：已有 `resumeId` 的节点换成 `isolation:'worktree'` 的角色时，
`AgentChatView` 的 `handlePickRole` 先弹确认，确认才清 `resumeId` 再换。
不清的话首发守卫（`!savedResumeId`）会当成「恢复旧会话」而不建树，这个 pane
从此静默跑在主工作区上 —— 与删 worktree 成功后一并清 `resumeId` 是同一条理由。

> **只读角色**（`scout` / `inspector`）不建 worktree、不上徽标；主工作区里**有角色**的会话才上
> 协同板（没有角色的普通会话不上板，有角色但落在主工作区的显示「主工作区」）。

## 多 agent 编排的闸门（`team_spawn` · `teamWorktree.ts` / `batchSpec.ts`）

**闸0** 调用者本身是团队成员 → 硬拒（成员不得再派活）· **闸1** Frame 多 agent 开关关着 → 拒
（事实查询，非模型判断）· **闸2** 批次合法（≤6 角色 · kebab-case · 不重名）· **闸3** 用户在界面
点头确认 · **闸4** 这个 agent 自己声明了 `isolation:'worktree'` 才建 `.worktrees/<批次id后6位>-<role>`
（分支 `eas-team/<同名>`），否则用原 cwd。任一步失败 → 回滚已建 worktree + 已起 agent。

- **闸 0 靠 `EAS_TEAM_ROLE` 环境变量判定**，不是猜测 —— 防子 agent 递归派活炸开。
- **要不要隔离是派活方自己填的**：`agents[].isolation` **只认严格的 `'worktree'`，没填 / 写错 /
  大小写不同一律 `none`**（`isolationOf` 与 `batchSpec.ts` 注释写着"**不猜**"）。**系统不会替你
  判断这个角色写不写代码** —— `roles.ts` 那套角色是 AI 对话工具栏上的角色轮播
  （`agentChat/RolePicker.tsx`，判断层在 `agentChat/carousel.ts`）用的，
  `team_spawn` 的 `role` 只是自由的 kebab-case 标签（同时是 `.plans/<role>/` 的目录名），
  **`role` 本身和那套角色卡没有任何代码关联** —— 要给派出去的 agent 套卡得另填 `role_id`（见 3A 角色段），
  而 `role_id` 也只决定契约与能力边界，**不决定 `isolation`**。
  **派写码 agent 忘填 `isolation:'worktree'` = 直接落进 E-07 那个静默覆盖，而且不会报错。**
- **限流闸是现算的**（读真实会话表看有没有活的 `owner:'team'` agent），**不用持久状态位**
  —— 教训写在注释里：存过状态导致永久锁死过一个 Frame。
- **删 worktree 前检查 `git status --porcelain`，有未提交改动一律拒删**；`team_dissolve`
  也只报告不清理，避免 `--force` 抹掉未 commit 的成果。
- `team_status(wait:true)` 最长挂 8 分钟；`team_send` 送不进已闲置 3 分钟被回收的会话。

## 逐次审批（Claude 独有）

`PreToolUse` hook（`resources/agent-hooks/eas-pretooluse.mjs`，独立进程）→ `POST /agent-approval/request`
阻塞等待 → mcpBridge 同一 HTTP server 上的 `approvalRoute.ts` 只留住完整 payload 并唤醒等待者
（**不碰"会话"概念**，理由见 3B 静默失效区）→ `agentChat/session.ts` 按 hook 带的 `eas_session_id`
点名找会话（找不到就丢弃）→ 该会话的 `approvalRegistry.fromHook()` 归一化（`kindOf`：Bash→exec /
Write·Edit·NotebookEdit→patch / 其余→tool）→ 渲染层弹审批卡 → `POST /agent-approval/resolve`
唤醒 hook。**超时 5 分钟 → 兜底一律 deny（安全底线）。**

- 只对带 `EAS_AGENT_CHAT_SESSION` 的会话生效，**其余 Claude 会话无声放行**。
- **Codex 没有逐次审批**（`capabilities.approval: []`），只有沙箱三档权限。
- 用 PreToolUse hook 而非 `--permission-mode`，因为 manual 模式是直接拒绝、不是等待。

## 运行时文件边界（`fsGuard.ts`）

**适用范围有限**：`guardPath`/`guardDir` 只在几处被调用 —— 写侧是 `fs.ts` 的各写操作、`snapshot.ts`
落快照、`agentChat/session.ts` 写 cwd 内的 hook 配置，读侧是 `phone/server.ts` 取文件给手机端。
**注入面（`agentRules.ts` / `agentHook.ts` / `agentSkill.ts` / `mcpBridge.ts` / `wiki/schema.ts`）完全
不经过它，直接写用户 home** —— 下表的"拒绝写用户 home"只对这几条通道成立，**不等于"app 写不到 home"**。

| | 范围 |
|---|---|
| ✅ 允许写 | `projects.json` 里每个项目根 + 知识库根（用户在界面上亲手选过的目录） |
| ❌ 拒绝写 | 其余一切：用户 home、系统目录、**别的项目的兄弟目录**、项目根本身（改名/删根走项目管理） |
| 防绕过 | `realResolve()` 先 `realpathSync` 到真实路径再比前缀（软链能击穿纯字符串前缀比对）；目标不存在时退到"最深的真实祖先" |
| 文件名校验 | `invalidNameReason()` 挡 `..` / 斜杠 / `:*?"<>\|` / 控制字符 / 超长 |

> **⚠️ 已知缺口**：`fs:readDir` / `readTextFile` / `readImageFile` / `openPath` / `showInFolder`
> **零路径校验**，理论上能读取、在 Finder 打开任意绝对路径。这是"读比写风险低"的设计取舍、
> 不是遗漏 —— 要补边界前先确认不会打断"拖任意文件进画布预览"这类既有用法。

## 密钥的真实边界（别误传）

- 密钥经 `pty.ts` 注入为**环境变量** → **同进程内任何命令（含 AI）`echo $KEY` 就能读到**。
  承诺的只是**不进对话、不进 jsonl、不进 shell history**，**没有**承诺"AI 读不到"。
- 文件型密钥（SSH key / `.p8` / `.pem`）**不进环境变量**，取法却和文本型完全一样：
  `eas-secret run --vars <变量名> -- <命令>`（或 `--group <组名>` 整组取）——
  **`eas-secret` 没有 `--files` 这个参数**，敲了会以退出码 2 报"不认识的参数"
  （`src/main/secrets.ts` 的 `StoredVar.file` 注释里还留着 `--files` 的旧写法，别照它敲）。
  分流在主进程侧：`secretsForRun` 按库里的 `file` 标记把它从 `env` 剔出、放进响应的 `files[]`，
  `mcp/eas-secret.mjs` 再解成 `$HOME` 下 0700 目录里的 0600 文件，路径以 `<变量名>_PATH` 传入，
  照抄这个形式（**单引号 + `sh -c` 是关键**，否则 `$X_PATH` 会被调用方的 shell 先展开成空值）：
  `eas-secret run --vars SSH_ID_ALIYUN -- sh -c 'ssh -i "$SSH_ID_ALIYUN_PATH" root@host'`，
  命令结束或被信号打断即删。

---

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
| `src/main/secrets.ts` 的 `assertReady()` / seal-open checksum | 删 ready 断言 → 静默用错全局密钥桶；删 checksum → macOS AES-128-CBC 无认证，实测坏 1 bit 有 **62.9%** 概率静默解出错误内容而不报错 |
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

## 2026-09-07：对话恢复与能力更新补充

Codex exec 的 --sandbox 必须放在 resume 子命令之前，禁止为修恢复错误删去沙箱或改 stdin ignore。模型目录晚于进程退出返回仍可更新，但只能更新相同会话对象与请求代次。capabilities 缺席字段不清空其他能力，session.ready 未报模型不得从待应用选择填造实际模型。资源面板仅使用当前插件声明，不绕过宿主权限；详见 [16 号图纸](16-AI对话公共协议.md)。

启动模型的显式选择覆盖角色默认模型；没有显式选择保留角色默认。换模型时不把角色旧强度施加给新模型；首次启动与 resume 失败重试必须使用同一份 startupParams。

### 蓝图hover历史修复（2026-09-08）
BlueprintPanel的词条按钮必须有局部onMouseLeave；仅bp-view外层leave会让用户离开词条但仍在蓝图内部时弹窗残留。与普通词条行为一致。不要恢复成只监听面板离开。

### 2026-09-09 最大化恢复补充（历史修复区）
已用真实应用证实：兄弟模块 display:none 使几何归零；仅保留延时会在恢复时重新布局。CanvasFileNode/ComponentNode/FreeFileNode 改成保留尺寸 + visibility:hidden，PaneLayer 的 CanvasPlacement.concealed 保留视口内 sibling 布局（视口外裁剪与分屏 display:none 不改）。CanvasStage 使用既有 useHidingHolder 同步世界层的恢复时点，被恢复节点显式 visible，不搬父节点、不销毁 guest/PTY。
另有 GPU trace 的 ~115ms RasterDecoder 冷光栅化：共享 maximizeKeyframes 在收回期间锁定旧 width/height（两帧相等，非逐帧尺寸插值），只插值 transform，结束释放回 React 目标尺寸。放大仍用既有 FLIP。禁止改回“先把内容排成小尺寸再逆向放大”，也禁止写 el.style.transform 覆盖画布缩放。reduced-motion 跳过动画；持续 will-change 与去掉 Frame 毛玻璃的实验无收益，未保留。
复审补充：PaneView的布局尺寸还要乘canvasRect.scale才是动画视觉终点；否则50%/150%画布会在释放WAAPI后跳尺寸。仅PaneView传视觉w/h，画布世界内三个节点仍传世界坐标。useMaximizeFlip由四宿主显式maximized状态边界触发（不再用面积阈值猜），避免普通画布缩放/节点调整误启动动画；恒定布局只用于还原方向，与面积大小无关。zoom-endpoints.json验证动画末帧与释放后的边界误差<2px。

### 语音候选保护（2026-09-09，验收未完）
语音文本写入只能经编辑器适配接口；不得恢复“失焦随便追加末尾”、不得把跨框迟到结果写给新目标、不得自动回车执行。主进程 `stt:audio/stop` 校验录音所属 sender，VAD 在 Worker 中运行、队列有上限。切换录音或停止时失效旧异步定稿；采麦失败、卸载、处理错误均需释放设备。不得把 VAD 当成本人声纹识别；Windows 和实际噪声效果需分别验收。
