# Codex 原生路由超时安全自动恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对已明确失败且无可见执行活动的 Codex 工作区路由超时，保留旧线程、从失败轮之前分叉，最多自动重试 2 次，并让用户看到恢复进度。

**Architecture:** 在 `mcp/codex-task-recovery.mjs` 放纯判据和固定脱敏错误；`codex-task-bridge.mjs` 管一次进程内的原生终止确认、健康探测、分叉和最多两次新轮；现有 launcher 仍只拥有一个子进程代次。新增一条固定的 retry 状态事件，经 Codex translator 进入 reducer，让 MessageList 的现有 busy 提示换文案；不改代理、登录、沙箱和其他 CLI。

**Tech Stack:** Electron / Node ESM / TypeScript / React；Node 内置 test runner；Codex app-server JSON-RPC v2。

**Spec:** `docs/superpowers/specs/2026-09-23-codex-safe-auto-retry-design.md`

## Global Constraints

- 原始尝试之外最多 **2 次**自动付费 `turn/start`；任何 ACK 不明或状态不明不重发。
- 只认原生 terminal `turn/completed.status=failed` 且错误文本精确等于 `workspace routing discovery timed out`；仅原生 error 通知不够。
- 本轮只能观察到 userMessage；assistant delta、reasoning、命令、文件、MCP、未知 item、新增 token usage 任一出现就不分叉。
- active goal、其他 active turn、取消、进程退出、分叉失败、旧 CLI 不支持 `beforeTurnId` 都失败关闭。
- 用 `thread/fork.beforeTurnId` 排除失败轮并保留旧线程；绝不调用 `thread/revert`，不自动清理凭证、改代理或修改 Codex。
- 只输出固定错误类别和重试次数；不记录原生任意错误正文、提示词、路径、URL 或凭证。
- 隔离 worktree：`.worktrees/codex-safe-retry-20260923`；不启动、关闭、替换正式 `/Applications/Eas-Term.app`。
- 本机 Node 26 的 `electron-rebuild` 报 `require is not defined in ES module scope`；用 `npm exec --yes --package=node@22 -- …` 执行安装后的 postinstall、检查和构建，不改 package lock。Node 22 基线 `npm run check`：3617 pass、19 skip、0 fail。

## Review Focus

1. 原生 `error` 先到、terminal completed 永不到：Task 2 测 5 秒后失败且 `turn/start` 仍为 1。
2. 失败轮收到 token usage 或 assistant delta：Task 1/2 测不分叉、不重发，即使错误文案精确匹配。
3. 用户在退避、探测或分叉过程中按停止：Task 2 测无后续 `turn/start`、计时器与进程代次均结束。
4. `thread/fork` 不支持 `beforeTurnId` 或 ACK 丢失：Task 2 测无盲目备用重试，旧 resumeId 保留。
5. 分叉继承历史 token 和新线程 ID：Task 3/4 测不重复计费、不重复可见提问，下一条消息恢复新线程。

---

### Task 1: 纯资格判据与脱敏错误类别

**Files:**
- Create: `mcp/codex-task-recovery.mjs`
- Create: `src/main/codexTaskRecovery.test.mjs`
- Modify: `mcp/codex-task-error.mjs`
- Modify: `src/main/codexTaskError.test.mjs`

**Interfaces:**
- Produces: `ROUTE_TIMEOUT`、`MAX_ROUTE_RETRIES`、`isRouteTimeout(message)`、`mayRecoverRouteTimeout({terminal,activitySeen,usageAdvanced,goalStatus,activeTurnCount,attempts,aborted})`、`routeTimeoutFailure(attempts)`。
- `goalStatus=null` 表示确认没有 goal，`undefined` 表示查询失败；后者必须拒绝。 `activitySeen` 由桥对原始 item/delta 观察形成，不由 UI 事件推测。

- [ ] **Step 1: 写失败测试。** 测精确错误为 true；前后加 URL、401、大小写变体为 false；`attempts=2`、活动／用量／goal／取消／两个 active turn 为 false；`routeTimeoutFailure(0|1|2)` 的 UI 文案只含固定中文和真实次数。

```js
assert.equal(isRouteTimeout('workspace routing discovery timed out'), true)
assert.equal(isRouteTimeout('workspace routing discovery timed out at https://secret.example'), false)
assert.equal(mayRecoverRouteTimeout({
  terminal: {status:'failed', error:{message:ROUTE_TIMEOUT}, id:'turn-a'},
  activitySeen:false, usageAdvanced:false, goalStatus:null,
  activeTurnCount:0, attempts:0, aborted:false
}), true)
assert.equal(mayRecoverRouteTimeout({
  terminal: {status:'failed', error:{message:ROUTE_TIMEOUT}, id:'turn-a'},
  activitySeen:true, usageAdvanced:false, goalStatus:null,
  activeTurnCount:0, attempts:0, aborted:false
}), false)
```

- [ ] **Step 2: 跑红灯。** `node --test src/main/codexTaskRecovery.test.mjs src/main/codexTaskError.test.mjs`；预期缺少导出或断言失败。
- [ ] **Step 3: 最小实现。** `isRouteTimeout` 使用字符串严格相等，不 `includes`；`mayRecoverRouteTimeout` 逐个守卫；`routeTimeoutFailure` 只接受 0–2 的整数并返回固定 `Error('Codex workspace-routing-timeout:'+attempts)`。让 `codexTaskFailureKind` 映射为 `workspace-routing-timeout`，`codexTaskFailure` 用固定中文及次数，不回显原生文本。
- [ ] **Step 4: 跑绿灯及旧回归。** `node --test src/main/codexTaskRecovery.test.mjs src/main/codexTaskError.test.mjs src/main/codexTaskBridge.test.mjs`；预期全绿。
- [ ] **Step 5: 提交。** `git add mcp/codex-task-recovery.mjs mcp/codex-task-error.mjs src/main/codexTaskRecovery.test.mjs src/main/codexTaskError.test.mjs && git commit -m "feat(codex): classify safe routing timeout recovery"`。

### Task 2: 原生桥的终止确认、健康探测与安全分叉

**Files:**
- Modify: `mcp/codex-task-bridge.mjs`
- Modify: `src/main/codexTaskBridge.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `mayRecoverRouteTimeout`、`routeTimeoutFailure`。
- Produces: `runCodexTaskBridge` 额外可选 `recoverySleep(ms,signal)`，生产默认可取消计时；测试注入立即完成的 sleep。桥只发固定 `{type:'retry.status',attempt,max:2}` 与分叉后的 `thread.started`；上层不接触原生错误正文。

- [ ] **Step 1: 扩展 fixture 并写红灯。** fixture 对 `account/read` 回 `{account:{type:'chatgpt'},workspaceRouting:{backendOrigin:'https://example.test'}}`，对 `thread/fork` 回新 thread ID，按调用顺序给 `turn/start` 返回 a/b/c。测试一次失败后 RPC 顺序为 `goal/get → account/read → thread/fork(beforeTurnId=a) → turn/start(thread-b)`，emit 新 ID 一次，成功时总付费调用数为 2。

```js
const p=runCodexTaskBridge({
  proc:f.proc,cwd:'/tmp',prompt:'work',sandbox:'read-only',
  recoverySleep:async()=>{},emit:e=>events.push(e)
})
f.note('turn/started',{turn:{id:'a'}})
f.note('turn/completed',{turn:{id:'a',status:'failed',error:{message:ROUTE_TIMEOUT}}})
await tick()
assert.deepEqual(f.calls.filter(x=>x.method==='thread/fork').map(x=>x.params.beforeTurnId),['a'])
assert.deepEqual(f.calls.filter(x=>x.method==='turn/start').map(x=>x.params.threadId),['thread','thread-b'])
```

- [ ] **Step 2: 跑红灯。** `node --test src/main/codexTaskBridge.test.mjs`；预期新用例失败，旧 27 项仍应保持绿色。
- [ ] **Step 3: 最小状态机实现。** 在原生通知入口观察所有当前 turn 的 `item/started`、`item/completed`、`item/agentMessage/delta` 和 token usage；只对 userMessage 放行。精确路由 `error` 通知先等最多 5 秒 terminal completed；`turn/completed failed` 用只读 `thread/goal/get` 确认 null，再按 Task 1 判据。每次付费重试前按 5/20 秒退避，`account/read({refreshToken:false})` 用 20 秒 RPC 上限，每个阶段最多两次健康探测；成功后 `thread/fork({threadId,beforeTurnId})`，仅收到明确 `result.thread.id` 才换 `threadId`、发 `thread.started` 和一次 `turn/start`。每次新尝试都重建 `turnObserved` promise，不能沿用上一轮已 resolve 的 ACK 哨兵。
- [ ] **Step 4: 补齐安全红灯。** 故障矩阵逐项断言 `thread/fork` 和 `turn/start` 次数：delta、reasoning、commandExecution、fileChange、mcpToolCall、未知 item、token usage、active goal、其他 active turn、取消三个阶段、health 双失败、fork RPC 异常、fork ACK 不明、turn/start ACK 不明、只有 error 通知、terminal 超 5 秒、两次恢复均失败。任一不安全场景最终最多 1 次原始 `turn/start`；两次合格失败后最多 3 次总提交。
- [ ] **Step 5: 跑绿灯并提交。** `node --test src/main/codexTaskBridge.test.mjs src/main/codexTaskRecovery.test.mjs src/main/codexTaskError.test.mjs`；`git add mcp/codex-task-bridge.mjs src/main/codexTaskBridge.test.mjs && git commit -m "feat(codex): fork failed routing turns at most twice"`。

### Task 3: 用量与恢复指针不重复

**Files:**
- Modify: `mcp/codex-task-bridge.mjs`
- Modify: `src/main/codexTaskBridge.test.mjs`
- Modify: `src/main/agentChat/codexEvents.ts`
- Modify: `src/main/agentChat/codexEvents.test.ts`
- Modify: `src/shared/agentChat.ts`
- Modify: `src/main/agentChat/session.ts`
- Modify: `src/renderer/src/features/agentChat/reduce.ts`
- Modify: `src/renderer/src/features/agentChat/reduce.test.ts`

**Interfaces:**
- Consumes: Task 2 的新 thread ID、一次可见轮的终结事件。
- Produces: 只有**本次可归属的增量**进入 `turn.completed.usage`；未知保持未知，不把 fork 继承的 `tokenUsage.total` 整份再次累加。

- [ ] **Step 1: 写红灯。** 在 fixture 中给旧线程历史 total=1000、失败轮无新增、分叉线程首次报告 total=1000、成功重试后 total=1012；断言可见轮最多记 12 个新增 token，而不是 1012 或两次 1000。另测分叉线程的**首条**用量通知已经是 1012：没有可证明的基线时不能猜成 0、12 或 1012，应保持用量未知。断言失败轮不发 `turn.completed`；分叉后的 `thread.started` 使 translator `session.ready.sessionId` 变为新线程，旧提问不再新增。
- [ ] **Step 2: 跑红灯。** `node --test src/main/codexTaskBridge.test.mjs src/main/agentChat/codexEvents.test.ts`；预期新增断言失败。
- [ ] **Step 3: 最小实现。** 把新线程**发生付费重试之前**已观测到的 `tokenUsage.total` 保存为 baseline，之后只计算明确归属于当前轮的非负差量；若协议提供可信的整轮 usage 则优先使用。首条通知若发生在重试之后，不可倒推 baseline；归属或基线不明则不发数字 usage，并让 translator 保留未知，不使用当前 `?? 0` 伪装成零。将 `ChatEvent.turn.done.usage` 改为可选；`session.ts` 仅在 usage 存在时调用 `tally`，reducer 在缺失时保持 `usage:null`，不能将它显示成零。对无 usage 的失败尝试不产生 0 成本结论；对成功恢复仅发一次 `turn.completed`，保留现有 `session.ready` 作为 resumeId 唯一入口。
- [ ] **Step 4: 绿灯并提交。** `node --test src/main/codexTaskBridge.test.mjs src/main/agentChat/codexEvents.test.ts src/renderer/src/features/agentChat/reduce.test.ts`；`git add mcp/codex-task-bridge.mjs src/main/codexTaskBridge.test.mjs src/main/agentChat/codexEvents.ts src/main/agentChat/codexEvents.test.ts src/shared/agentChat.ts src/main/agentChat/session.ts src/renderer/src/features/agentChat/reduce.ts src/renderer/src/features/agentChat/reduce.test.ts && git commit -m "fix(codex): count only recovered turn usage"`。

### Task 4: 对话区的可取消恢复状态

**Files:**
- Modify: `src/main/agentChat/codexEvents.ts`
- Modify: `src/main/agentChat/codexEvents.test.ts`
- Modify: `src/shared/agentChat.ts`
- Modify: `src/renderer/src/features/agentChat/reduce.ts`
- Modify: `src/renderer/src/features/agentChat/reduce.test.ts`
- Modify: `src/renderer/src/features/agentChat/MessageList.tsx`
- Modify: `src/renderer/src/features/agentChat/AgentChatView.tsx`

**Interfaces:**
- Consumes: `{type:'retry.status',attempt:1|2,max:2}`。
- Produces: `ChatEvent {k:'retry.status';attempt:1|2;max:2}`；`ChatView.retry: {attempt:1|2;max:2}|null`；MessageList busy 提示只在 retry 存在时显示“连接波动，正在恢复（1/2）”。

- [ ] **Step 1: 写红灯。** translator 测只接受 1/2 且不把任意 message 字段透传；reducer 测 `retry.status` 保持 busy、`turn.done`／fatal error／用户 stop 后清空 retry；分叉 `session.ready` 不新增 user turn、不清掉进行中的恢复状态。
- [ ] **Step 2: 跑红灯。** `node --test src/main/agentChat/codexEvents.test.ts src/renderer/src/features/agentChat/reduce.test.ts`；预期新用例失败。
- [ ] **Step 3: 最小实现。** translator 固定映射 retry event；reducer 存临时 retry 并在终结事件清空；MessageList 复用 `ac-busy-hint`、`ThinkingOrb` 与现有停止按钮，不新增错误 notice、用户消息或 CSS 体系。AgentChatView 的 `EMPTY_VIEW` 补 `retry:null`；`ChatToolbar` 停止按钮不变。
- [ ] **Step 4: 绿灯并提交。** `node --test src/main/agentChat/codexEvents.test.ts src/renderer/src/features/agentChat/reduce.test.ts`；`git add src/main/agentChat/codexEvents.ts src/main/agentChat/codexEvents.test.ts src/shared/agentChat.ts src/renderer/src/features/agentChat/reduce.ts src/renderer/src/features/agentChat/reduce.test.ts src/renderer/src/features/agentChat/MessageList.tsx src/renderer/src/features/agentChat/AgentChatView.tsx && git commit -m "feat(agent-chat): show Codex recovery progress"`。

### Task 5: 全链路验收、架构图纸与失败说明

**Files:**
- Modify: `docs/architecture/10-模块领地图.md`
- Modify: `docs/architecture/03-agent角色边界.md`
- Modify: `docs/verification/codex-goal/resilience-2026-09-23.md`
- Modify: `scripts/verify-codex-goal-native.mjs`
- Modify: `scripts/verify-codex-goal-ui.mjs`

**Interfaces:**
- Consumes: Task 1–4 的桥、事件、UI。
- Produces: 可重复的 localhost Responses 故障验收与本地验证记录。

- [ ] **Step 1: 扩充本地夹具。** 用 fake app-server 注入原生 terminal 路由失败两次、`account/read` 先失败后恢复、`thread/fork.beforeTurnId` 排除失败轮；收集 `turn/start` 次数、thread ID、可见用户消息数、停止后的调用数。额外模拟 goal active、已输出文本和 ACK 不明，均断言不自动重试。localhost Responses 夹具只验新轮成功路径，**不**冒充能触发 Codex 帐号路由发现超时。
- [ ] **Step 2: 跑隔离原生验收。** `npm exec --yes --package=node@22 -- node scripts/verify-codex-goal-native.mjs`；必须报告真实输出，不把 localhost 夹具当在线验收。
- [ ] **Step 3: 全量门禁。** `npm exec --yes --package=node@22 -- npm run check`；`npm exec --yes --package=node@22 -- npm run build`。任何失败保留原样报告，不以忽略 postinstall 代替通过。
- [ ] **Step 4: 打开隔离应用亲眼验证。** 按 `open-app-verify` skill 在临时 userData / HOME 中打开本 worktree 构建；用 `verify-codex-goal-ui.mjs` 检查恢复时中性提示“1/2、2/2”、停止、成功与最终失败，人工查看截图。绝不关闭或替换正式版。
- [ ] **Step 5: 更新图纸和记录。** 在 10/03 号图纸写明“仅精确路由超时且无执行活动才可分叉；ACK 不明绝不重发；旧线程保留”；在 resilience 记录执行命令、测试计数、截图路径、未验证的真实在线／Windows／实际计费。
- [ ] **Step 6: 提交并复核。** `git add docs/architecture/10-模块领地图.md docs/architecture/03-agent角色边界.md docs/verification/codex-goal/resilience-2026-09-23.md scripts/verify-codex-goal-native.mjs scripts/verify-codex-goal-ui.mjs && git commit -m "test(codex): verify bounded routing recovery"`；`git status --short --branch`、`git diff origin/main --stat`，再请求代码审查。未获用户合并／发版指令，不合并、不替换正式应用。
