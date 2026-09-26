# AI 对话原生任务卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有执行清单插件的活动计划呈现为挂在所属 AI 对话模块右上角的原生极简任务卡，用户验收完成后收起，并能安全终止本次 AI 执行与计划。

**Architecture:** 保留 `resources/plugins/execution-plan` 作为唯一写入者和三 CLI MCP 工具端。宿主签发稳定模块身份，插件对模型工具与原生卡片私有请求分别鉴权；主进程协调原生卡片读写、现有会话中断和计划终态，渲染层只拿所属模块的窄快照。

**Tech Stack:** Electron 主进程/IPC、React、TypeScript、Node stdio MCP/JSON-RPC、项目内 JSON 原子写与 CAS、`node --test`、electron-vite。

**Spec:** `docs/superpowers/specs/2026-09-25-native-chat-task-card-design.md`

## Global Constraints

- 首版只覆盖 Eas-Term 受管 AI 对话的 Claude、Codex、OMP；不接手动终端 PTY，不增加模型轮次。
- `.eas/execution-plans.json` 仍只由插件写入；宿主在每次写前执行 `guardDir/guardPath`、插件启用/安装根与当前会话归属校验；不能改变 `src/main/index.ts` 既有注册顺序。
- 模型只能使用原有五个公开计划工具；验收、完成与终止均为宿主/用户私有请求，不能让模型自报模块、项目、验收或终止身份。
- `reported_done` 与 `accepted` 分开；只有全部 `accepted` 且当前 AI 轮已结束才标 `completed` 并收起；终止不删除对话/历史，也不停止其他节点。
- 老 `archived`/无模块归属的库记录要能读取，不能因新字段缺失而覆盖损坏库；无法可靠绑定的旧记录只留在详情历史，不自动挂到别的 AI 节点。
- UI 沿用当前对话设计系统；右上角小窗在窄节点/分屏退化，不能挡住输入、审批、错误和“停止生成”；状态有文字与键盘语义。
- Task 5 的视觉实现先按 `design-router` 路由检查视觉规范；本机未找到其所指的 `visual-router/SKILL.md` 时记录该限制，直接对齐仓库现有 AI 对话 token/组件，不凭空引入另一套风格。
- UI/行为类任务完成前按 `open-app-verify` 构建、打开隔离实例亲眼验证；构建、测试失败原样报告。

## Review Focus

1. **同一项目两个对话节点**：A 的计划不能在 B 显示或被 B 验收/终止。Task 2 的归属测试、Task 3 的 IPC 越权测试、Task 6 的真机双节点验收覆盖。
2. **最后一项验收与模型追加步骤并发**：CAS 只能成功一边；不能把新步骤藏在“已完成”历史里。Task 1 的并发测试与 Task 4 的结束竞争测试覆盖。
3. **按终止后 ACP cancel 超时/Claude 进程退出未知**：不能先写 `terminated` 或偷偷自动重试。Task 4 的不确定完成测试覆盖。
4. **应用重启后会话 ID 变化**：同一持久画布节点恢复卡片、别的节点不冒出；无归属老计划不自动认领。Task 2 的绑定测试与 Task 6 的重启真机验收覆盖。
5. **插件停用/热替换、坏库、只读项目**：卡片报可理解的错误，不把失败当空态或补写一份新库。Task 1/3 的错误测试与 Task 6 的隔离实例验证覆盖。

## 文件与接口地图

| 单元 | 责任与预计文件 |
|---|---|
| 插件状态机 | `resources/plugins/execution-plan/lib/store.mjs`、`server.mjs` 与对应测试：`ownerKey`、终态、私有卡片读写；旧数据兼容 |
| 身份与授权 | `src/main/executionPlanOwner.ts`（新）、`executionPlanAuthorization.ts`、`agentChat/session.ts`、`mcpBridge.ts`、`renderer/App.tsx`、`store/canvas/persist.ts`、`agentChat/AgentChatView.tsx`：桌面节点 ID 绑定、启动前画布落盘与租约覆盖 |
| 原生卡片宿主 | `src/main/executionPlanCardHost.ts`（新）、`pluginHost.ts`、`preload/index.ts`、`shared/agentChat.ts`：窄 IPC、插件生命周期/写路径守卫 |
| 中断协调 | `src/main/agentChat/session.ts` 与 `executionPlanStop.ts`（新）：复用现有 interrupt，等待可靠结果，失败部分状态 |
| 原生 UI | `src/renderer/src/features/agentChat/PlanCard.tsx`（新）、`AgentChatView.tsx`、`MessageList.tsx`、`agentChat.css`：右上角任务卡、确认/收起/窄节点 |
| 图纸与验证 | `docs/architecture/{03,10,11,13}-*.md`、相关集成测试、隔离实例截图/日志 |

### Task 1: 插件归属字段、完成/终止状态与原子写

**Files:** Modify `resources/plugins/execution-plan/lib/store.mjs`, `resources/plugins/execution-plan/server.mjs`, `resources/plugins/execution-plan/ui/panel.html`; Test `resources/plugins/execution-plan/lib/store.test.ts`, `lib/server.test.ts`.

**Interfaces:** `PlanOwnerKey = 'node:' + nodeId | 'session:' + sessionId`，仅由宿主经 `_meta.eas.context.ownerKey` 传入。新增 `cardForOwner(cwd, ownerKey) -> {planId,title,status,version,steps:[{stepId,title,status,accepted}]} | null`、`cardAccept(cwd,{ownerKey,planId,stepId,accepted,expectedVersion,completeNow})`、`completePlan(cwd,{ownerKey,planId,expectedVersion})`、`terminatePlan(cwd,{ownerKey,planId,expectedVersion})`；所有写保持现有 `mutate` 项目锁、跨进程锁及 CAS。`createPlan` 的新计划保存 `ownerKey`；旧记录允许缺它，但卡片不匹配。

- [ ] **Step 1: 写失败测试。** 增加：A/B 同项目不同 `ownerKey` 创建后各只查到自己的活动计划；模型用 A 身份 `get/update/archive` B 计划均拒绝，`plan_list(allSessions:true)` 也不能逃出 owner；缺 owner 的旧 schema=1 记录仍可 `getPlan`，但 `cardForOwner` 为 null；`cardAccept` 只接受 `reported_done`，最后一项在 `completeNow=true` 时同一事务落 `completed`；`completeNow=false` 保持 active；`completePlan` 只在全验收时成功；`terminatePlan` 不改已完成历史；并发追加步骤与完成只能有一边成功。现有详情面板测试须确认 completed/terminated 显示明确历史终态且不再露出验收/归档按钮。示例断言：

  ```js
  const a = await createPlan(root,{sessionId:'s-a',turnId:'t-a',ownerKey:'node:n-a'},seed)
  assert.equal(cardForOwner(root,'node:n-b'),null)
  await assert.rejects(updateStep(root,{sessionId:'s-b',turnId:'t-b',ownerKey:'node:n-b'},
    {planId:a.planId,stepId:a.steps[0].stepId,status:'in_progress',expectedVersion:a.version}),/归属/)
  ```
- [ ] **Step 2: 跑红。** `node --test resources/plugins/execution-plan/lib/store.test.ts resources/plugins/execution-plan/lib/server.test.ts`；预期新测试因私有卡片函数/owner 校验不存在而失败。
- [ ] **Step 3: 最小实现。** `validPlan` 的字段白名单增可选 `ownerKey`，计划状态允许 `active|archived|completed|terminated`；`createPlan` 必须由可信 identity 得到非空 owner，不能从 input 取。模型读写用同一 `assertOwner(plan, identity.ownerKey)`；`plan_list` 即使 allSessions 仍按 owner 限定；`cardForOwner` 仅返回匹配 owner 的最新 active 计划及窄步骤字段；`cardAccept` 在 `mutate` 一次事务里改 accepted，并在 `completeNow && steps.every(s=>s.accepted)` 时改状态。`completePlan` 再读最新版本并检查全部 accepted；`terminatePlan` 对相同 owner 的已终止请求幂等，其余终态拒绝。详情面板把三种终态分别标“已归档/已完成/已终止”，操作按钮只给 active；插件 server 的 `tools/list` 仍严格只有原五个公开工具。
- [ ] **Step 4: 跑绿并提交。** 重跑 Step 2 与 `git diff --check`；预期 0 失败。`git add resources/plugins/execution-plan && git commit -m 'feat: scope plans to chat owners and add terminal states'`。

### Task 2: 宿主签发稳定模块归属，不让模型/其他节点冒名

**Files:** Create `src/main/executionPlanOwner.ts`, `src/main/executionPlanOwner.test.ts`; Modify `src/main/executionPlanAuthorization.ts`, `src/main/mcpBridge.ts`, `src/main/agentChat/session.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/store/canvas/persist.ts`, `src/renderer/src/features/agentChat/AgentChatView.tsx`; extend `src/main/executionPlanAuthorization.test.ts`, `src/main/agentChat/processHandoff.test.ts`, `src/renderer/src/store/canvas/persist.test.ts`.

**Interfaces:** `resolvePlanOwner({userData,projects,cwd,agentNodeId?,agentLeafId?,sessionId}) -> {root,ownerKey}`；对画布节点，从 `canvas.json` 中确认 `frame.projectId` 所在项目根与 cwd 的 `projectRootOf(cwd)` 相同、节点 `pane.kind==='agent'`，返回 `node:<nodeId>`；临时分屏在无画布节点时返回 `session:<sessionId>`，仅当前会话有效。`TrustedPlanContext` 增 `ownerKey`，覆盖任意模型提供的 `_meta.eas`。桌面 `agentChat:start` 两条路径均传 `agentNodeId`，但主进程把它当查找提示而非可信授权。

- [ ] **Step 1: 写失败测试。** 固定两 Frame/同项目与异项目、`pane.kind==='agent'`、伪造其他节点 ID、缺失节点、工作树 cwd、临时 split leaf、重启换 sessionId 的 fixture；断言 A 的 owner 稳定为 `node:n-a`，B 为 `node:n-b`，跨项目/非 agent 拒绝，临时 split 是会话限定 `session:s-a`。断言 `preparePlanToolParams({_meta:{eas:{context:{ownerKey:'node:n-b'}}}},trustedA)` 返回 `node:n-a`。
- [ ] **Step 2: 跑红。** `node --test src/main/executionPlanOwner.test.ts src/main/executionPlanAuthorization.test.ts src/main/agentChat/processHandoff.test.ts`；预期缺归属解析/透传而失败。
- [ ] **Step 3: 最小实现。** 独立 owner 模块只读 `canvas.json`/`projects.json`，做大小/形状/真实路径检查；主进程 start 绑定 `agentNodeId` 与 `wcId`，受管租约上下文用已校验 owner；`authorizePlanCall` 不从 HTTP body/模型参数取 owner。桌面首次启动与失效 resume 重试都传 `nodeRef.split('|')[1]`；手机已有 agentNodeId 路径保持。`App.tsx` 当前防抖 500ms，刚建节点即发送会读到旧盘面：把现有 `buildScene()` 提成 `serializeCurrentCanvas(storeState)` 复用于 App 保存与对话首次 start；对话在 start 前 `await window.api.canvas.save(serializeCurrentCanvas(useStore.getState()))`，保存失败则不以未验证节点身份起计划服务。
- [ ] **Step 4: 跑绿并提交。** 重跑 Step 2、`npm run typecheck`、`git diff --check`；预期通过。`git add src/main/executionPlanOwner* src/main/executionPlanAuthorization* src/main/mcpBridge.ts src/main/agentChat src/renderer/src/App.tsx src/renderer/src/store/canvas/persist.ts src/renderer/src/features/agentChat/AgentChatView.tsx && git commit -m 'feat: bind execution plans to verified AI chat nodes'`。

### Task 3: 原生卡片的窄宿主 IPC 与插件私有 RPC

**Files:** Create `src/main/executionPlanCardHost.ts`, `src/main/executionPlanCardHost.test.ts`; Modify `src/main/pluginHost.ts`, `resources/plugins/execution-plan/server.mjs`, `src/preload/index.ts`, `src/shared/agentChat.ts`, `src/main/index.ts`; extend `src/main/executionPlanHost.test.ts`, `resources/plugins/execution-plan/lib/server.test.ts`.

**Interfaces:** `registerExecutionPlanCardHandlers()` 只追加在 `registerAgentChatHandlers()` 后，不移动既有注册；`PlanCardRef={nodeId?:string;sessionId?:string}`，两者至少一个非空；`window.api.agentChat.planCardRead(ref)` 返回 `{kind:'empty'|'active'|'unavailable',card?,error?}`；`planCardAccept({...ref,planId,stepId,accepted,expectedVersion})` 返回同形结果。插件 server 的 `host/card-read|accept|complete|terminate` 只接受宿主注入的 `cwd,ownerKey`；`pluginHost.requestExecutionPlanCard(method,trusted)` 用独立短租约、启用/根/路径重验调用插件，不接受任意方法名。为测试导出不直接注册 IPC 的 `cardRead(input,deps)` 与 `cardAccept(input,deps)`。

- [ ] **Step 1: 写失败测试。** 模拟 main window/webContents、项目根、canvas node、插件开/关/替换、旧 shim、坏库/只读根；断言 A 节点 read/accept 仅到 A；伪造 B `nodeId` 或 planId、panel 私有 RPC/模型 shim 调 `host/card-*` 均拒绝；插件停用返回 unavailable 而非 empty；失败绝不创建/覆盖 `.eas/execution-plans.json`。示例：

  ```ts
  assert.deepEqual(await cardRead({senderId:7,nodeId:'n-a'},deps),{kind:'empty'})
  assert.equal((await cardAccept({senderId:8,nodeId:'n-a',planId:'p',stepId:'x',accepted:true,expectedVersion:1},deps)).kind,'unavailable')
  ```
- [ ] **Step 2: 跑红。** `node --test src/main/executionPlanCardHost.test.ts src/main/executionPlanHost.test.ts resources/plugins/execution-plan/lib/server.test.ts`；预期新接口不存在而失败。
- [ ] **Step 3: 最小实现。** `executionPlanCardHost` 从主进程解析 node→root/owner，临时分屏 `sessionId` 必须命中当前 sender 拥有的 Live；`guardDir(projectRootOf(cwd))` 和目标文件 `guardPath`；通过 `requestExecutionPlanCard` 调 server 的 host 私有方法，回包裁剪到卡片字段，不透传完整 DB/凭证。`cardAccept` 先取最新卡片做 owner/版本核对，本任务固定 `completeNow:false`；Task 4 接上 idle 判断与收尾。所有写沿插件 `mutate`。把两个 API 加到 preload/类型；`index.ts` 只**追加**新 register 调用，不调整旧顺序。
- [ ] **Step 4: 跑绿并提交。** 重跑 Step 2、`npm run typecheck`、`git diff --check`；预期通过。`git add src/main/executionPlanCardHost* src/main/pluginHost.ts src/preload/index.ts src/shared/agentChat.ts src/main/index.ts resources/plugins/execution-plan && git commit -m 'feat: expose guarded native plan card actions'`。

### Task 4: 可靠终止协调与最后验收后的安全收尾

**Files:** Create `src/main/agentChat/executionPlanStop.ts`, `src/main/agentChat/executionPlanStop.test.ts`; Modify `src/main/agentChat/session.ts`, `src/main/executionPlanCardHost.ts`, `src/preload/index.ts`, `src/shared/agentChat.ts`; extend `src/main/agentChat/executionPlanTurns.test.ts`, `src/main/agentChat/processHandoff.test.ts`.

**Interfaces:** `stopPlanFlow({senderId,...ref,planId,expectedVersion}) -> {kind:'terminated'|'stopped-unpersisted'|'stop-unconfirmed'|'unavailable',error?}`；`retryPlanTermination({senderId,...ref,planId})` 仅在宿主有该 sender/owner/plan 的已确认停止凭据或已确认无活跃轮时重试私有状态写入；`completeAcceptedPlan(ownerKey,planId)` 在对应 `turn.done`/重启恢复时仅在全 accepted、没有活跃轮次的条件下调用插件 `host/card-complete`。现有 `agentChat:interrupt` 保留外部语义，抽取同一执行体供本入口等待取消确认。

- [ ] **Step 1: 写失败测试。** 模拟 Claude/Codex kill→真实退出、OMP cancel→`turn.done(cancelled)`、取消超时、无在飞轮、插件写失败、重复点击、late `step_update`、两个节点同时跑、最后验收与新增步骤竞争、最后验收后连接致命退出。断言停止未确认不写 terminated；已停但写失败只返回 stopped-unpersisted 且 retry 不重启 AI；`turn.done`/致命退出令 busy 真正归零后才可 complete，仍 busy 时不能 hide；A 终止时 B 不受影响。
- [ ] **Step 2: 跑红。** `node --test src/main/agentChat/executionPlanStop.test.ts src/main/agentChat/executionPlanTurns.test.ts src/main/agentChat/processHandoff.test.ts`；预期协调函数/事件不存在而失败。
- [ ] **Step 3: 最小实现。** 把 `guardedOn('agentChat:interrupt')` 中的原有 kill/cancel/恢复抑制逻辑提炼为共享 `interruptManagedTurn`，不改其现有行为；新路径校验 sender `webContents.id`、会话 owner 与 plan owner，先 `retirePlanTurn` 禁止晚回执，等待退出/取消事件的有界确认，**不确定时不自动重试**。确认后调用插件 `host/card-terminate`；写失败返回可重试的部分状态并只保留短期主进程停止凭据。接上 Task 3 `cardAccept` 的真实 idle 判断：空闲时最后一项验收在同一事务 complete；忙碌时保持 active，`turn.done` 或致命退出后确认 busy 归零，再尝试 `host/card-complete`。若 CAS 失败则读最新卡片并保持可见；应用重启时无活跃轮且全验收可幂等补 complete。
- [ ] **Step 4: 跑绿并提交。** 重跑 Step 2、`npm run typecheck`、`git diff --check`；预期通过。`git add src/main/agentChat src/main/executionPlanCardHost.ts src/preload/index.ts src/shared/agentChat.ts && git commit -m 'feat: coordinate plan termination with AI interruption'`。

### Task 5: AI 对话右上角原生极简任务卡

**Files:** Create `src/renderer/src/features/agentChat/PlanCard.tsx`, `PlanCard.test.ts`; Modify `AgentChatView.tsx`, `MessageList.tsx`, `agentChat.css`; extend `src/renderer/src/features/agentChat/reduce.test.ts`, `executionPlanEntry.test.ts`.

**Interfaces:** `<PlanCard ownerRef={{nodeId?,sessionId?}} busy={...} refreshKey={...} onDetails={...}/>` 通过 preload 窄 API 读取与验收，回调使用现有 `requestConfirm` 二次确认再 `planCardStop`；`plan.progress`、`turn.done`、卡片操作结果触发刷新，不能靠正文词语或轮询。无 active 卡片返回 null；已完成/已终止自动收起。

- [ ] **Step 1: 写失败 UI 测试。** 覆盖 3 步状态（待办、模型报告完成待验收、用户已验收）、按钮名称/`aria-pressed`、点验收后只调用一次 API、终止确认取消时 0 IPC、所有步骤验收且 busy 时“等待当前轮结束”、unavailable/error 与仅重试写入、窄节点折叠/键盘操作。静态测试断言 `MessageList` 不再重复渲染旧 `ExecutionPlanEntry`，但 `PlanMissingNotice` 保留。
- [ ] **Step 2: 跑红。** `node --test src/renderer/src/features/agentChat/PlanCard.test.ts src/renderer/src/features/agentChat/executionPlanEntry.test.ts src/renderer/src/features/agentChat/reduce.test.ts`；预期缺原生卡片而失败。
- [ ] **Step 3: 最小实现。** 卡片锚在 `.agent-chat-view` 标题/历史行下方右侧，宽度限制约 260–320px、内部有界滚动；窄节点用 `ResizeObserver` 或已有容器宽度状态收起为单行摘要，不挡审批/输入/停止。步骤只显示标题、待办/待验收/验收状态，终止为独立文字按钮；详情用现有插件面板次级入口。高优先级弹窗出现时卡片降层；减少动态效果下立即卸载。移除消息列表中的旧清单入口以免重复 UI，保留漏建提醒。
- [ ] **Step 4: 跑绿并提交。** 重跑 Step 2、`npm run typecheck`、`node scripts/check-css-balance.mjs`、`node scripts/check-accent-contrast.mjs`、`git diff --check`；预期通过。`git add src/renderer/src/features/agentChat && git commit -m 'feat: mount compact native plan card on AI chat'`。

### Task 6: 跨路径集成、图纸与隔离应用验收

**Files:** Modify `docs/architecture/03-agent角色边界.md`, `10-模块领地图.md`, `11-MCP工具网络.md`, `13-所有权矩阵.md`; Create `src/main/agentChat/nativePlanCardIntegration.test.ts` and only narrowly necessary fixtures.

**Interfaces:** 不新增运行时接口；验收以同一分支构建产物和项目数据为准。

- [ ] **Step 1: 写集成测试。** 从真实 `managedSessionMcpServers()` 生成 Claude/Codex/OMP 快照，验证计划工具与手选 board/timeline 共存；两节点同项目各建计划→模型报告→用户验收→完成/终止→重启读回；禁用/替换、损坏库、只读路径、旧无 owner 记录不冒卡；同一轮重试不重复创建，停止后迟到回执不复活。对 `src/main/index.ts` 注册顺序加基线断言，仅允许新注册追加。
- [ ] **Step 2: 先跑红后补测试接线。** `node --test src/main/agentChat/nativePlanCardIntegration.test.ts`；预期新增断言先失败；补齐前几 Task 漏的衔接，不删除失败测试放行。
- [ ] **Step 3: 更新四份图纸。** 10 写原生任务卡归属和插件唯一写入；03 写 `session.ts` 中断/重启禁区；11 画 CLI→租约→插件及原生 IPC→宿主私有方法；13 列跨文件同步与测试清单。图纸与代码同 commit。
- [ ] **Step 4: 完整验证并留证。** 用仓库 Node 22 跑 `npm run check && npm run build && git diff --check`。按 `open-app-verify` 在此隔离 worktree 使用 `scripts/verify-app.mjs` 构建并打开独立实例：两节点、右上角位置/窄节点、三步、最后验收收起、运行中/中断后终止、重启恢复、插件停用/替换。留截图与主/渲染日志；Claude/OMP/Codex 若认证/运行环境不足，逐项写“未验证”，不能称全路径真机通过。绝不动正式 app 或复制 secrets。
- [ ] **Step 5: 提交与复核。** `git add docs/architecture src/main/agentChat/nativePlanCardIntegration.test.ts` 加上本任务必要代码，`git commit -m 'test: verify native AI plan card integration'`；复查 `git status --short`、`git log -6 --oneline` 与目标测试。Windows CI 留到用户要求推送/合并/发版时再跟踪，不以 macOS 构建冒充。

## Execution handoff

建议 **Native / 单会话执行**：六项任务共享 ownerKey、插件 CAS、会话中断与渲染事件契约，频繁切换实现者容易漏掉停止次序与跨节点隔离；最后需要完整分支审查。实施前用户需先确认本计划与执行方式。
