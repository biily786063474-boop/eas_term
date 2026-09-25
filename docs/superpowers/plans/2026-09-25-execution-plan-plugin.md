# 执行计划插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让受管 Claude、Codex、OMP 对话在同轮用后台插件建立与推进可见的任务清单，同时保留用户验收、项目隔离与零额外模型轮次。

**Architecture:** 随包插件负责 MCP 工具、项目内持久化与面板；主进程负责真实会话/轮次身份、写路径授权、插件生命周期及事件回执；渲染层只显示由结构化回执或持久化数据确认的进度。执行计划作为第三个基础 MCP 服务追加，不占现有手选插件槽。

**Tech Stack:** Electron 主进程 TypeScript、React、Node stdio MCP `.mjs`、项目 `.eas` JSON、`node --test`、electron-vite。

**Spec:** `docs/superpowers/specs/2026-09-25-execution-plan-plugin-design.md`

## Global Constraints

- 只覆盖 Eas-Term 受管 AI 对话节点中的 Claude Code、Codex、OMP；不接终端 PTY CLI。
- 同轮调用模型可见工具；不增加分类模型轮次、不自动重发用户任务。
- 后台插件不能占手选业务插件位；时间线/看板仍可同时使用。
- 项目数据只写 `.eas/execution-plans.json`；所有写路径先经主进程 `guardDir`/`guardPath`，插件端再防软链与损坏覆盖。
- `accepted` 首版只能由用户面板操作设置，模型工具不能设置。
- 不改变 `src/main/index.ts` 的 `whenReady()` 注册顺序，不改 Claude 私有任务库，不放宽现有沙箱规则。
- UI/行为声称完成前，依 `open-app-verify` 构建并打开隔离开发实例亲眼验证；不得覆盖正式 `/Applications/Eas-Term.app`。
- 同步更新 `docs/architecture/10-模块领地图.md`、`03-agent角色边界.md`、`11-MCP工具网络.md`、`13-所有权矩阵.md` 中受影响的内容并同 commit 提交。

## Review Focus

1. **同项目不同会话同时更新**：旧 `version` 必须冲突，不可后写覆盖前写；Task 1 的并发测试。
2. **软链/坏 JSON/超大文件**：必须报错且原文件字节不变；Task 1 的文件安全测试。
3. **伪造项目、session、turn 或迟到回执**：主进程拒绝，不能改当前轮提示；Task 3、5 的鉴权测试。
4. **Codex 重启、安全分叉重试及 Claude/OMP 常驻进程**：同一用户轮保持同一幂等键，下一轮换键；Task 4、5 的装配/重试测试。
5. **插件关闭、替换、失败或问答不需计划**：不注入错误工具/提示，不把未建计划写成任务失败；Task 4、5、6 的 UI 与生命周期测试。

## File map / dependency boundaries

| 单元 | 文件 | 唯一职责 |
|---|---|---|
| 领域/存储 | `resources/plugins/execution-plan/lib/store.mjs`, `store.test.ts` | 数据校验、状态机、项目文件原子 CAS、按来源轮次幂等 |
| MCP 入口/面板 | `resources/plugins/execution-plan/plugin.json`, `server.mjs`, `ui/panel.html`, `ui/icon.svg`, `lib/server.test.ts` | 工具协议与 UI，绝不自认会话/验收身份 |
| 受管轮次 | `src/main/agentChat/executionPlanTurns.ts`, `executionPlanTurns.test.ts` | 会话轮次签发、真实执行事件、回执、提醒状态 |
| 宿主授权 | `src/main/pluginHost.ts`, `src/main/mcpBridge.ts`, `src/main/agentChat/session.ts` | 验证租约、固定项目、插件 RPC、基础 MCP、三 CLI 提示 |
| 事件/UI | `src/shared/agentChat.ts`, `src/renderer/src/features/agentChat/{reduce.ts,MessageList.tsx,AgentChatView.tsx,agentChat.css}`, 对应测试 | 进度入口、提醒、面板开启与用户验收 |
| 工程图纸 | `docs/architecture/{10-模块领地图,03-agent角色边界,11-MCP工具网络,13-所有权矩阵}.md` | 把新增边界/交叉修改纳入 AI 导航 |

**集成注意：** `projectRootOf`（`src/shared/roleWorktree.ts`）仅用于识别主项目/worktree，不能替代 `guardDir`；`pluginHost.ts` 的 `timelineParams` 是写路径授权参考；`mcpBridge.ts` 已有 `CapabilitySessions`，不得新造可由模型自报的身份字段。`src/main/agentChat/session.ts` 的 OMP 启动与 Claude/Codex 重启是不同路径；所有路径都应走同一轮次对象。

### Task 1: 数据模型与原子存储

**Files:** Create `resources/plugins/execution-plan/lib/store.mjs`, `resources/plugins/execution-plan/lib/store.test.ts`.

**Interfaces:**
- `createPlan(cwd, trusted, input)`：`trusted={sessionId,turnId}`，`input={title,steps:[{title,criterion}]}`；返回 `{planId,version,steps:[{stepId,...}]}`。
- `getPlan(cwd, planId)`, `listPlans(cwd,{sessionId?,limit?,offset?})`, `updateStep(cwd,trusted,{planId,stepId?,status?,title?,criterion?,append?,evidence?,expectedVersion})`, `archivePlan(cwd,trusted,{planId,expectedVersion})`, `acceptStep(cwd,{planId,stepId,accepted,expectedVersion})`。`stepId` 缺省仅允许 `append` 新步骤；已有 `reported_done` 步骤不可改标题/判据，只能追加依据或撤回后改。
- 所有 mutator 返回新 `version`；失配抛带 `code='VERSION_CONFLICT'` 的错误；`createPlan` 对同一 `sessionId+turnId` 幂等。

- [ ] **Step 1: 写失败测试（状态、幂等、CAS、损坏/软链/超大、并发）。** 使用 `mkdtempSync` 的临时项目根，覆盖 `createPlan(root,{sessionId:'s',turnId:'t'},...)` 两次 ID 相同、下一轮 ID 不同、旧版本更新冲突、`accepted` 只能经 `acceptStep`、两个 Promise 并发更新仅一方成功、`.eas` 或目标文件软链/坏 JSON/超过 4 MiB 时写入拒绝且原字节不变。测试代码骨架：

  ```ts
  const first = await createPlan(root, { sessionId:'s', turnId:'t' }, { title:'交付', steps:[{title:'实现',criterion:'测试通过'}] })
  assert.equal((await createPlan(root,{sessionId:'s',turnId:'t'},{title:'重复',steps:[{title:'X',criterion:'Y'}]})).planId, first.planId)
  await assert.rejects(updateStep(root,{sessionId:'s',turnId:'t'}, {planId:first.planId,stepId:first.steps[0].stepId,status:'reported_done',expectedVersion:0}), {code:'VERSION_CONFLICT'})
  ```

- [ ] **Step 2: 跑测试确认红。** `node --test resources/plugins/execution-plan/lib/store.test.ts`；预期模块未找到/断言失败，而非测试未运行。
- [ ] **Step 3: 最小实现。** `store.mjs` 用 `fs.lstatSync` 检查 `.eas`/目标文件及父链软链，4 MiB 上限，严格 JSON schema；每项目串行 Promise 锁、写临时文件 `wx` → `fsync` → `rename`，只在成功读取与 `expectedVersion` 相同后写。状态仅允许 `pending → in_progress/blocked/reported_done`、`blocked → in_progress/pending`、`in_progress → blocked/reported_done`，撤回 `reported_done → in_progress`；已完成依据保留历史。以 `crypto.randomUUID()` 生成 ID，不接受调用参数里的 ID 或验收字段。关键写入顺序：

  ```js
  return withProjectLock(cwd, async () => {
    const db = readStrict(cwd)
    if (db.version !== input.expectedVersion) throw Object.assign(new Error('计划已由其他会话更新'), {code:'VERSION_CONFLICT'})
    const next = mutate(db, input)
    await atomicReplace(cwd, next)
    return next
  })
  ```
- [ ] **Step 4: 跑绿与提交。** `node --test resources/plugins/execution-plan/lib/store.test.ts && git diff --check`；预期 0 失败。`git add resources/plugins/execution-plan/lib && git commit -m 'feat: add guarded execution plan store'`。

### Task 2: 插件清单、MCP 工具与面板协议

**Files:** Create `resources/plugins/execution-plan/{plugin.json,server.mjs,ui/panel.html,ui/icon.svg,lib/server.test.ts}`.

**Interfaces:** `server.mjs` 消费宿主注入的 `_meta.eas.context={cwd,sessionId,turnId}`（具体字段由 Task 3 授权注入）；暴露 `plan_create`, `plan_get`, `plan_list`, `step_update`, `plan_archive`；面板私有 `panel/list`, `panel/get`, `panel/accept`, `panel/update`, `panel/archive`；`ui://execution-plan/panel`。写工具禁止 `accepted`、`project`、`sessionId`、`turnId` 参数。

- [ ] **Step 1: 写协议失败测试。** 通过 stdio 启动 `server.mjs` 发 `initialize`/`tools/list`，断言五个且仅五个模型工具；`plan_create` 未注入可信 `_meta` 返回 `isError:true`；向工具 args 伪造 `accepted:true`/`cwd:'/tmp'` 不能改变真正的写目标；面板方法不出现在 `tools/list`。示例断言：

  ```ts
  assert.deepEqual(names.sort(), ['plan_archive','plan_create','plan_get','plan_list','step_update'])
  assert.equal(callWithoutHostMeta.isError, true)
  ```

- [ ] **Step 2: 跑红。** `node --test resources/plugins/execution-plan/lib/server.test.ts`；预期缺 server/协议断言失败。
- [ ] **Step 3: 实现插件。** 清单按 `resources/plugins/board/plugin.json` 形状声明 `mcp`、`panels`、`ui://` 与图标；stdio 处理 `initialize`、`tools/list`、`tools/call`、`resources/list/read`，工具 schema 使用 `additionalProperties:false`，标题/判据限长、步骤数 2–20、列表 `limit<=50`。`step_update` 的 `append`/待办步骤改名走同一工具，不另造并行写接口。只从主进程覆盖后的 `_meta.eas.context` 取身份；面板私有接受 `panel/accept`，工具调用分支永不调用 `acceptStep`。所有写回执 `{id,version,...}` 有界，错误结构化为 `isError`。协议分流关键分支：

  ```js
  if (m.method === 'tools/call') return sendToolResult(callModelTool(m.params))
  if (m.method === 'panel/accept') return sendResult(acceptStep(panelCwd(m.params), m.params))
  if (m.method === 'resources/read' && m.params?.uri === 'ui://execution-plan/panel') return sendPanelHtml()
  ```
- [ ] **Step 4: 跑绿与提交。** `node --test resources/plugins/execution-plan/lib/{store,server}.test.ts && git diff --check`；预期通过。`git add resources/plugins/execution-plan && git commit -m 'feat: add execution plan MCP plugin'`。

### Task 3: 主进程租约、项目授权与面板私有操作

**Files:** Modify `src/main/mcpBridge.ts`, `src/main/pluginHost.ts`, `mcp/eas-plugin-shim.mjs`; Create `src/main/executionPlanAuthorization.ts`, `src/main/executionPlanAuthorization.test.ts`; extend `src/main/pluginAuthorization.test.mjs` or add `src/main/executionPlanHost.test.ts`.

**Interfaces:** `authorizePlanCall(authenticatedContext, currentTurn, guardedProjectRoot)` 返回 `{cwd,sessionId,turnId}`；`currentTurn` 从 Task 5 的同一会话轮次表读，不从 HTTP body 读。`mcpBridge.ts` 在 HTTP 路由上只对 `name==='execution-plan'` 调 `capabilitySessions.authenticate(lease)`，将得到的可信上下文作为 `pluginRpcFromShim(body, trustedContext?)` **独立第二参数**传入，避免 `pluginHost → mcpBridge` 循环依赖；面板 `panel/accept` 从面板会话的 `PanelCtx` 绑定项目，不使用模型工具通道。

- [ ] **Step 1: 写失败鉴权测试。** 用可注入 `CapabilitySessions`、`guardDir/guardPath` 替身验证：有效租约+当前 turn 通过；PTY 父租约、撤销租约、不同 session、`body.project` 伪造、缺 turn、指向别的项目的路径都失败。另测 panel session 失效/插件替换后 `panel/accept` 失败，模型 RPC `panel/accept` 返回 method-not-found。示例：

  ```ts
  assert.deepEqual(authorizePlanCall({agentSessionId:'s',project},{sessionId:'s',turnId:'t'},project), {cwd:project,sessionId:'s',turnId:'t'})
  assert.throws(() => authorizePlanCall({agentSessionId:'other',project},{sessionId:'s',turnId:'t'},project))
  ```

- [ ] **Step 2: 跑红。** `node --test src/main/executionPlanAuthorization.test.ts src/main/executionPlanHost.test.ts`；预期失败。
- [ ] **Step 3: 实现边界。** `mcpBridge.ts` 在现有 `/plugin/rpc` HTTP 分支调用租约认证（复用 `capabilitySessions.authenticate`），而不是让 `pluginHost.ts` 反向 import 它；shim 仅为 `execution-plan` 附上 env 中的租约，不附全局网关 token 到插件。`pluginHost.ts` 先从已认证上下文得到受管 session，再从轮次表查当前 turn，再 `guardDir(projectRootOf(context.project))` 与 `guardPath(<root>/.eas/execution-plans.json)`；用 `withEasMeta` **覆盖**调用者的 `_meta.eas`，不 merge 其中身份。插件禁用/替换、shim 失活及排队后身份失效都在真正写前重验。`tools/call` 成功且 result 非 `isError` 才广播/记回执；`panel/*` 白名单只走已打开面板的 `panelRpc`，面板写入再核对所属项目和当前安装根。边界顺序：

  ```ts
  const identity = capabilitySessions.authenticate(body.planLease) // mcpBridge HTTP 路由
  const result = await pluginRpcFromShim(body, identity)
  // pluginHost 内：
  const turn = activePlanTurn(identity.agentSessionId)
  const trusted = authorizePlanCall(identity, turn, guardedProjectRoot)
  const full = withEasMeta(params, trusted) // 覆盖不可信 _meta.eas
  ```
- [ ] **Step 4: 跑绿与提交。** `node --test src/main/executionPlanAuthorization.test.ts src/main/executionPlanHost.test.ts src/main/pluginPopupSecurity.test.mjs && git diff --check`；预期通过。`git add src/main/mcpBridge.ts src/main/pluginHost.ts src/main/executionPlanAuthorization* mcp/eas-plugin-shim.mjs && git commit -m 'feat: authorize plan calls with managed session lease'`。

### Task 4: 基础 MCP 装配与三 CLI 同轮提示

**Files:** Modify `src/main/mcpBridge.ts`, `src/main/agentChat/session.ts`; Create `src/main/executionPlanGuidance.ts`, `src/main/executionPlanGuidance.test.ts`; extend `src/main/ompCapabilityPlugin.test.ts`, `src/main/agentChat/processHandoff.test.ts`.

**Interfaces:** `executionPlanEnabled()` 由 `findPlugin('eas:execution-plan')` + `pluginIdEnabled` + 包完整性计算；`executionPlanGuidance(enabled)` 输出短提示或空串。`sessionMcpServers(pluginId)` 在 base 中追加名称 `execution-plan`，selected 仍只有一个，停用时不追加。

- [ ] **Step 1: 写失败装配测试。** 分别模拟未选、选 board、选 timeline、停用插件，验证 base 计划服务存在/缺席；验证 Claude/Codex `capabilityGuidance` 与 OMP 受管提示均有相同语义，restart/resume 的配置快照仍含计划服务，但 PTY 通用配置不添计划服务。示例：

  ```ts
  assert.ok(sessionMcpServers('eas:board').some(s => s.name === 'execution-plan'))
  assert.ok(sessionMcpServers('eas:board').some(s => s.name === 'board'))
  ```

- [ ] **Step 2: 跑红。** `node --test src/main/executionPlanGuidance.test.ts src/main/agentChat/processHandoff.test.ts src/main/ompCapabilityPlugin.test.ts`；预期新增断言失败。
- [ ] **Step 3: 实现装配。** 复用 `easPluginMcpServer('eas:execution-plan')` 形成 base 条目，专用 `envVars` 只传网关、项目和租约；保留 `assembleCapabilityServers` 的名称冲突检测与 native snapshot。提示原文固定为「多步骤执行任务：开始操作前同轮调用 plan_create；延续任务用 plan_get/step_update；仅在工具成功回执后报告清单变化。普通问答和单步操作无需建计划。」仅在启用时注入各 CLI **受管**路径；OMP 配置若不支持该提示，沿现有 `ompSkillMarkdown` 的应用自有受管 skill 接线，不写用户全局配置。停用后新进程/重启不带工具也不带提示；已运行旧进程在新调用前由宿主拒绝，UI 报「插件已停用」，不声称即时撤掉 CLI 已缓存工具。base 组合形状：

  ```ts
  const plan = executionPlanEnabled() ? easPluginMcpServer('eas:execution-plan') : null
  const allBase = [...base, ...(plan ? [{ enabled:true, server:{...plan, envVars:['EAS_TERM_PORT','EAS_TERM_TOKEN','EAS_CAPABILITY_LEASE']}}] : [])]
  return assembleCapabilityServers(allBase, selected ? [{...selected,envVars}] : protectedNative)
  ```
- [ ] **Step 4: 跑绿与提交。** `node --test src/main/executionPlanGuidance.test.ts src/main/agentChat/processHandoff.test.ts src/main/ompCapabilityPlugin.test.ts && git diff --check`；预期通过。`git add src/main/mcpBridge.ts src/main/agentChat/session.ts src/main/executionPlanGuidance* src/main/agentChat/processHandoff.test.ts src/main/ompCapabilityPlugin.test.ts && git commit -m 'feat: attach plan plugin to managed AI sessions'`。

### Task 5: 轮次事实、幂等与漏建提醒

**Files:** Create `src/main/agentChat/executionPlanTurns.ts`, `src/main/agentChat/executionPlanTurns.test.ts`; Modify `src/main/agentChat/session.ts`, `src/main/pluginHost.ts`, `src/shared/agentChat.ts`; extend `src/main/agentChat/processHandoff.test.ts`.

**Interfaces:** `beginPlanTurn(sessionId,turnId)`、`notePlanExec(sessionId,turnId,{kind,tool})`、`notePlanReceipt(sessionId,turnId,{planId,version,summary})`、`endPlanTurn(sessionId,turnId,{interrupted})` 产出可序列化 `ChatEvent`：`plan.progress` 或 `plan.missing`；`retirePlanTurn(sessionId)` 清除迟到回执资格。每次**用户消息投递**生成 `turnId`；自动重试同一消息保留它，下一条用户消息换 ID。不要以每个 CLI 的原生 `turn.start` 次数生成 ID。

- [ ] **Step 1: 写失败状态机测试。** 普通无工具轮结束得到 `plan.missing` 的 `executed:false`；执行/编辑事件后为 `executed:true`；有成功 `plan_create` 则无提醒；失败工具回执仍提醒；相同回执去重；`end`/`retire` 后迟到回执被丢弃；安全分叉重试保留 `turnId`、新用户轮换 ID。示例：

  ```ts
  beginPlanTurn('s','t1'); notePlanExec('s','t1',{kind:'edit',tool:'apply_patch'})
  assert.deepEqual(endPlanTurn('s','t1',{interrupted:false}), {k:'plan.missing',executed:true})
  assert.equal(notePlanReceipt('s','t1',{planId:'p',version:1,summary:'2/3'}), null)
  ```

- [ ] **Step 2: 跑红。** `node --test src/main/agentChat/executionPlanTurns.test.ts`；预期失败。
- [ ] **Step 3: 实现事件接线。** 在 `deliverMessage` 已成功接收用户消息的路径创建稳定 `turnId` 并绑定 `Live`，在 `handleEvent` 的 `exec.start` 与 `turn.done` 记事实；`turn.done` 只有未中断且无成功 `plan_create` 才发缺席事件，中断/致命错误显示「本轮未完成」而不是漏建判断。插件 host 在入站时捕获该轮 `turnId`，完成后仍以捕获的 `turnId` 回执，不能晚到后拿新的活动 turn；成功回执通过主进程回调发 `plan.progress`。`plan_create` 来源轮次与回执均来自当前 `Live`，不用正文关键词。`ChatEvent` 用可选新变体，不改变现有事件结构/注册顺序；恢复后 `plan.progress` 由项目文件重新查询，不从旧渲染历史推断。回执守门示例：

  ```ts
  const capturedTurnId = activePlanTurn(sessionId)?.turnId
  const result = await hosted.client.requestTracked('tools/call', trustedParams, timeout)
  if (capturedTurnId && !result.isError) notePlanReceipt(sessionId,capturedTurnId,receiptOf(result))
  ```
- [ ] **Step 4: 跑绿与提交。** `node --test src/main/agentChat/executionPlanTurns.test.ts src/main/agentChat/processHandoff.test.ts src/main/agentChat/isolationBaseline.test.ts && npm run typecheck`；预期通过。`git add src/main/agentChat/executionPlanTurns* src/main/agentChat/session.ts src/main/pluginHost.ts src/shared/agentChat.ts && git commit -m 'feat: track plan receipts and missing-plan turns'`。

### Task 6: 对话进度入口、漏建提示与完整面板

**Files:** Modify `src/renderer/src/features/agentChat/{reduce.ts,MessageList.tsx,AgentChatView.tsx,agentChat.css}`; Create `src/renderer/src/features/agentChat/ExecutionPlanEntry.tsx`, `executionPlanEntry.test.ts`; Modify `resources/plugins/execution-plan/ui/panel.html`; extend `src/renderer/src/features/agentChat/reduce.test.ts`.

**Interfaces:** `ChatView.plan` 是最近的 `{planId,done,total,currentTitle,version}` 或 `null`；每轮 `Turn.planMissing?:'neutral'|'executed'`。`ExecutionPlanEntry` 接收 `summary`, `onOpen`; `AgentChatView` 通过已有 `PluginPanel` 以 `pluginId:'eas:execution-plan',panelId:'main',cwd` 在对话内弹层打开，不创建画布节点。

- [ ] **Step 1: 写失败 UI 测试。** `reduce.test.ts` 推 `plan.progress` 后摘要变更、推 `plan.missing` 后只在当前 assistant 轮显示；历史回放不凭文案推计划。`executionPlanEntry.test.ts` 用 `renderToStaticMarkup` 验证 `2/5`、当前步骤、待验收文案和 `aria-label`；插件停用/面板失败显示可重试状态。示例：

  ```ts
  r.push({k:'plan.progress',plan:{planId:'p',done:2,total:5,currentTitle:'验证',version:3}})
  assert.equal(r.view().plan?.done,2)
  ```

- [ ] **Step 2: 跑红。** `node --test src/renderer/src/features/agentChat/reduce.test.ts src/renderer/src/features/agentChat/executionPlanEntry.test.ts`；预期新增断言失败。
- [ ] **Step 3: 实现渐进 UI。** `ExecutionPlanEntry` 使用现有执行区低强调样式，点击/Enter 打开；无计划轮底部显示「本轮未建立执行清单」，执行过工具时显示「已执行但未建清单」，「让 AI 补建」只预填输入框，不自动发送。插件面板默认摘要+当前步骤，点击展开全部；`reported_done` 为勾选且标「模型报告完成 · 待验收」，`accepted` 单独标「已验收」；用户撤回/验收走 `panel/*`，所有错误显示明确状态并支持重试。按钮有键盘焦点与文字状态，禁止只靠颜色区别。对话入口语义：

  ```tsx
  <button type="button" className="ac-plan-entry" aria-label={`查看执行清单：${plan.done}/${plan.total}`} onClick={onOpen}>
    {plan.done}/{plan.total} · 当前：{plan.currentTitle}
  </button>
  ```
- [ ] **Step 4: 跑绿与提交。** `node --test src/renderer/src/features/agentChat/{reduce,executionPlanEntry}.test.ts && npm run typecheck && node scripts/check-css-balance.mjs && node scripts/check-accent-contrast.mjs`；预期通过。`git add src/renderer/src/features/agentChat resources/plugins/execution-plan/ui/panel.html && git commit -m 'feat: show execution plan in AI chat'`。

### Task 7: 跨路径验收、架构图纸与隔离实例

**Files:** Modify `docs/architecture/{10-模块领地图,03-agent角色边界,11-MCP工具网络,13-所有权矩阵}.md`; Add focused integration tests under `src/main/agentChat/` and `src/main/` only where Tasks 1–6 lacked coverage.

**Interfaces:** 无新运行时接口；验收以产品行为和构建产物为准。

- [ ] **Step 1: 先写端到端装配测试。** 从项目 fixture 启用计划插件，分别为 Claude/Codex/OMP 生成实际 MCP snapshot，断言工具可用且 board/timeline 仍在；创建→推进→验收→重启读回；停用、替换后旧 shim/面板失效；只读项目/坏库不写。至少检查下面这些断言：

  ```ts
  assert.ok(servers.some(s=>s.name==='execution-plan'))
  assert.ok(servers.some(s=>s.name==='board'))
  assert.equal(reopened.steps[0].accepted,true)
  ```

- [ ] **Step 2: 跑新增测试确认红后补齐接线。** `node --test src/main/agentChat/executionPlanIntegration.test.ts`；预期新增测试起初失败，补齐后通过，不用「跑不起来就删测试」的方式放行。
- [ ] **Step 3: 更新四份图纸。** 10 标后台插件与 `.eas/execution-plans.json` 所有权；03 标 `session.ts`/`mcpBridge.ts`/`pluginHost.ts` 同改风险、`whenReady` 不变；11 画 `AI CLI → shim → 租约鉴权 → host → plugin → 项目数据`；13 增跨文件同步清单和 UI/IPC/测试边界。
- [ ] **Step 4: 全量验证。** 使用仓库 Node 22：`npm run check && npm run build && node scripts/verify-app.mjs --seed && git diff --check`。任何失败原样记录，不能声称完成。调用 `open-app-verify` skill，从隔离 worktree 构建并打开**独立测试实例**，亲眼验证 Claude/Codex/OMP、选 timeline/board 时的清单入口、漏建提醒、3 步推进、用户验收、重启恢复、停用/替换；记录实例路径与可复现步骤。不要动正式 app。
- [ ] **Step 5: 提交并复核。** `git add docs/architecture src/main/agentChat src/main resources/plugins/execution-plan && git commit -m 'test: verify execution plan plugin integration'`；再运行 `git status --short`, `git log -5 --oneline` 和目标测试，汇报实测/未测项目。Windows CI 仅在后续推送/合并/发版阶段触发并跟踪到完成，不将 macOS 眼验冒充 Windows 结果。

## Execution handoff

建议 **Native / 单会话执行**：七项任务共享宿主身份与事件接口，频繁切换实现者容易漏掉生命周期约束；实施时用 `superpowers:executing-plans` 按任务跑 TDD，最后再做整分支审查。计划通过前不修改产品代码。
