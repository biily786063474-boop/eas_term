# 内置能力插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 随包分发一个内置能力插件，统一 Eas-Term 工具、Bizone 连接器和按需指引；受管 Claude/Codex/omp 会话免逐端配置。

**Architecture:** 现有 pluginHost 增加仅由主进程注册的可信内置服务绑定，基础能力不占业务插件选择槽。会话从同一能力清单生成独立配置与受管连接租约，普通插件仍无网关凭证、画布权限不扩张。Bizone 通过共享正式 MCP 客户端获取 schema，写操作用持久请求日志避免断线重放。

**Tech Stack:** Electron / TypeScript / Node stdio JSON-RPC / 本地受鉴权 HTTP / React 现有插件面板。

**Spec:** docs/superpowers/specs/2026-09-07-builtin-capability-bundle-handoff.md

## Global Constraints

- 保留用户规则、第三方配置、主动禁用和角色权限；仅迁移有可靠归属证据的托管段。
- 不改变 whenReady 注册顺序；所有外部写文件入口仍经过 fsGuard。
- 不自动重试可能已执行的写调用，尤其是付费生成；实服务费用必须先报价确认。
- 0.4.84 使用冻结的 07c6c6b 构建独立发布；本改造另发新版，未完成实际三端包验收不宣称完成。
- 外部启动的 CLI 不读取默认用户目录端点来获得本软件权限。

## Task 1 · 证据与统一清单

**Files:** `docs/verification/builtin-capabilities/diagnosis.md`; create `src/shared/builtinCapabilities.ts`, `src/shared/builtinCapabilities.test.ts`, `resources/plugins/eas-capabilities/bundle.json`。

**Interfaces:** `CapabilityModule = 'workbench'|'bizone'|'guidance'`；`CapabilityState` 分别携带 enabled、dependency、session 状态；`SessionMcpServer` 含 name/command/args/env/envVars，`assembleCapabilityServers(base, selected)` 合并启用基础服务和单个业务插件并拒绝名称冲突。

- [x] 核对运行包与父子进程环境，真实 initialize/tools/list 对照证明 Codex 环境传递缺口（0 vs 37）。
- [x] 先写纯函数断言：禁用模块不装配；业务插件保留基础能力；名称冲突拒绝；输入清单不可被返回对象修改。
- [x] 实现版本化内置定义和上述纯接口，运行 `node --test src/shared/builtinCapabilities.test.ts`。

```ts
assert.deepEqual(assembleCapabilityServers([{enabled:false,server:canvas}],[]), [])
assert.deepEqual(assembleCapabilityServers([{enabled:true,server:canvas}],[business]).map(s=>s.name), ['eas-term','business'])
assert.throws(()=>assembleCapabilityServers([{enabled:true,server:canvas}],[canvas]))
```

## Task 2 · 受管会话装配与连接租约

**Files:** create `src/main/capabilitySessions.ts` + tests；modify `mcpBridge.ts`, `agentChat/session.ts`, `adapters/codex.ts`, `shared/agentChat.ts`, `shared/roleBinding.ts`, `pty.ts`；create lightweight managed CLI launcher under `mcp/`。

**Interfaces:** `createCapabilitySnapshot({sessionKey,cli,cwd,ptyId?,agentSessionId?,pluginId?})` 返回独立配置路径、服务器列表、指引与租约环境；`revokeCapabilitySession(sessionKey)` 销毁租约。配置信息不含令牌日志，Codex 用 env_vars 显式转发租约定位参数。

- [ ] 以缺环境的正式 Codex 行为作为失败回归，补新建/恢复/重启/两会话不同业务插件、中文空格路径的配置断言。
- [x] 用每会话文件替代共享 agent-mcp.json；Codex 显式装配同源基础服务器并保留角色 disabled_tools/enabled=false。
- [ ] AI 对话与 PTY 均注入受管租约，退出撤销；固定实例身份加运行代次处理端口/token 更新，不扫描其他实例凭证。
- [ ] PTY 入口在本软件 PATH 中使用独立 launcher，原 CLI 参数原样保留；外部终端不会命中该入口。
- [ ] 新增无模型 MCP handshake 探针，日志仅记录 sessionKey/模块/阶段/工具数/错误类别。

## Task 3 · 可信内置宿主及 Bizone 恢复

**Files:** create `src/main/builtinCapabilityHost.ts`, `src/main/bizoneConnector.ts`, `src/main/capabilityRequestJournal.ts` + tests；modify `pluginHost.ts`, `mcpClient.ts`, `mcpBridge.ts`；create `mcp/eas-capability-shim.mjs`；规范化工作台 schema 单一来源。

**Interfaces:** 主进程启动时调用 `registerBuiltinService(name, factory)`；可信服务可直接绑定 `invokeRenderer`，普通插件无法注册该身份。Bizone 使用同一 HostRegistry、单个正式 MCP 客户端；`RequestJournal.begin(id,operation)` 持久记录 submitting，完成后写 result，未知状态只允许 query/reconcile。

- [ ] 先测普通插件伪造内置名/请求令牌失败，基础服务调用不经过自身 shim，防代理循环。
- [ ] 工具目录从正式 Bizone MCP 读取并记录依赖版本；工具调用时按需拉起画板，检测 token 变化重建客户端，未安装/未登录分开报告。
- [ ] 模拟“服务接受生成后断线”，重连查询同一 node/task 身份，断言付费提交次数恰为 1；应用重启加载 journal 后仍不得自动 submit。
- [ ] 两项目并行调用在服务端绑定会话上下文，拒绝跨项目伪造；工作台写路径继续使用既有执行体。

## Task 4 · 指引同源、状态及迁移

**Files:** `resources/plugins/eas-capabilities/` 规则与面板；`agentRules.ts`, `agentSkill.ts`, `rulesRefresh.ts`, `plugins.ts`, `pluginManifest.ts`；create `src/main/capabilityMigration.ts` + tests。

- [ ] 将包启用、依赖可用、会话工具就绪分三层展示；由同一状态生成短指引，不因文档存在而宣称工具可用。
- [ ] 详细说明按需读取，受管会话追加指引而不覆盖项目/角色正文；使用指引禁用仍生效。
- [ ] 带备份、归属校验、幂等迁移旧托管段，迁移失败不阻断启动；第三方同名/自改段保持原样并报告冲突。
- [ ] 仅在新链路握手通过后移除重复托管注册，记录回退恢复命令与备份哈希。

## Task 5 · 实际包验收与发布

**Files:** `scripts/verify-builtin-capabilities.mjs`；`docs/verification/builtin-capabilities/`；架构图纸 10/11/12/13。

- [ ] 新建、恢复、切 CLI、业务插件+基础能力、两个 Frame 并行：三端真实工具调用把同一 PNG 放入预期 Frame，保存调用参数/结果与截图。
- [ ] 重启应用/画板、端口/token 变化后自动恢复；旧租约撤销、禁用保持、外部终端零能力。
- [ ] 中文空格目录、精简 PATH、Mac/Windows 正式包验证；不能以开发构建或模拟响应代替。
- [ ] 付费断线幂等自动测试使用模拟服务；真实费用场景先报价，得到确认再做。
- [ ] 完整 check、独立审查、签名公证和安装包冒烟通过后发布；如实列出任何未完成的平台/实服务验证。

## 实施前审查补充契约（必须随对应任务验证）

1. PTY 只提供父级受管入口身份，每次 CLI 调用再申请子租约，绑定该次实时 cwd、PTY 和 Frame；同一终端两个 CLI 的租约互不撤销。launcher 处理 POSIX/Windows 与登录 shell PATH，绝对路径/alias 直达原 CLI 不依赖 PATH 拦截，应通过会话注入的原生配置入口覆盖；无法覆盖的调用方式必须报告，不偷偷改用户 alias。
2. 定位文件不是授权。租约密钥由当前所属宿主签发，经认证后才续期；实例ID只防串实例，旧代次请求一律拒绝。应用重启的新受管会话重新签发，旧独立存活进程没有读取新凭证的默认权限。PTY 不可靠识别轮次时，只恢复 MCP 连接，不重启 CLI、不回放输入。
3. bindRole 前将全局与本次基础/业务服务名合并为 knownMcpServers，之后再编译角色限制。必须测试干净全局配置下的禁整个基础服务、禁单工具和重启后限制保持。
4. 生成日志使用持久逻辑操作ID，不用 JSON-RPC 的瞬时 id。出站前持久化操作ID、参数摘要、nodeId/可用taskId和 submitting 状态。若正式 Bizone 没有按操作ID查询/幂等接口，断线后的记录保持 unknown 并阻止自动重发；只在查询有可靠匹配证据时认领。覆盖服务接收后客户端崩溃、响应丢失、换 RPC ID 重试，绝不把重连等同重新执行。

## 2026-09-08 实施记录

- 已查明 Codex env_vars 根因，真实 Codex app-server 握手列出 37 个工具；不是仅参数推断。
- 分支 `feat/builtin-capabilities` 从 90f295a 继续，保留原用户 dirty 文件。0.4.84 已独立发布，本改造不在该包。
- AI 对话接入工作台租约/现有宿主；PTY 父子租约、三端启动入口和指引/设置已接线，但仍缺正式包实际调用验收。笔纵生产组合、完整状态确认与迁移尚未完成。
- 审查补齐 restart 角色过滤、缺省 close、异步撤销、旧连接迟到关闭及在飞引用问题。HTTP/stdio、Frame AST、连接器与请求日志测试通过；正式包模型调用尚未开始。
- Windows 日志文件 fsync + 原子替换覆盖进程崩溃；目录 fsync 不可用时不承诺突然断电的元数据耐久性。

### 2026-09-08 补充回归与未完成范围

- `EAS_TEST_NATIVE_CODEX=/opt/homebrew/bin/codex npm run check`：2686/2686，通过全部类型/约束检查，0 跳过；原生 probe 不调用模型。当前 owned Codex launcher 实际运行 `--version` 返回 0.153.4。
- 真实 PTY Ctrl-C 重复投递先复现后修复；真实 HTTP 子租约隔离/慢请求撤权、手机首轮节点绑定、Codex 用户配置与受管配置分离均有回归。
- 启动不再覆盖全局 MCP 表/规则，旧 opt-out 只用于首次迁移偏好；新开关的明确重新启用不被旧标记压回去。
- 用户于 2026-09-08 已允许联动修改笔纵 MCP 请求身份/查询协议，并要求在笔纵仓库留痕；正在实施。正式包 `get_generation_status` 无请求/任务 ID，不能自动认领原生成；没有付费生成调用。
- 具体剩余工作和证据等级见 `docs/verification/builtin-capabilities/implementation-status.md`；迁移/回退说明见同目录 `migration-and-rollback.md`。没有宣称正式包三端验收或本改造发版完成。
