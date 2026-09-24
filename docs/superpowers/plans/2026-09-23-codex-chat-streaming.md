# Codex AI 对话原生流式正文 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Codex AI 对话里即时显示原生正文增量，并用原生完成消息校准最终文本。

**Architecture:** 保留 `session.ts → codexCapabilityLaunch → eas-codex-launcher → codex-task-bridge → codexEvents → ChatEvent → reduce` 链路，仅给桥接层增加受约束的内部 `item.delta` JSONL，再翻译为现有 `text.delta`。不迁移传输、IPC 或 UI 组件。

**Tech Stack:** Electron 主进程、Node JSON-RPC/JSONL、TypeScript、React 归约器、node:test。

**Spec:** `docs/superpowers/specs/2026-09-23-codex-chat-streaming.md`

## Global Constraints

- Codex 托管对话的 app-server 及原生目标生命周期已经存在，不改 `turn/start` 次数、`thread/goal/get` 或自动继续语义。
- 不改沙箱、角色能力、MCP、用户配置合并、密钥、审批策略、CLI 登录及模型目录探测。
- 新增的内部事件仅用于展示，不入最终对话历史；旧 CLI 不产 delta 时保持整段完成事件行为。
- 不新增外部依赖、出站或持久化字段；不触及终端 Codex、Claude、omp。
- UI 行为完成前须 `npm run check`、`npm run build`、隔离实例打开并观察；真实模型验收先征得用户对额度消耗的确认。

## Review Focus

1. 外来 `threadId` 的 delta 不得进入当前对话（Task 1）。
2. 同一 turn/item 完成后的迟到 delta 不得污染下一个气泡（Task 1）。
3. `turnId`/`itemId`/`delta` 缺失或类型错误时不得生成正文（Task 1）。
4. 有 delta 又有完整完成文本时，最终气泡不能重复或截断（Task 2）。
5. 旧 Codex 不发 delta 时，原本的整段回复、工具、图片和目标连续轮次不退化（Tasks 1–3）。

### Task 1: 桥接原生正文增量，隔离线程与 item 生命周期

**Files:**
- Modify: `mcp/codex-task-bridge.mjs`（`notification` 分支）
- Test: `src/main/codexTaskBridge.test.mjs`

**Interfaces:**
- Consumes: 原生通知 `{method:'item/agentMessage/delta', params:{threadId,turnId,itemId,delta}}`。
- Produces: 外层现有 JSONL `emit({type:'item.delta',item:{id:turnId+':'+itemId,type:'agent_message',delta}})`；不产生 `turn.completed`。

- [x] **Step 1: 写失败测试**：在现有 `fixture()` 上发同 item 的两个 delta、完成项、迟到 delta，断言仅前两个 `item.delta` 依序出现、完成项依旧出现；再发外来线程、空 delta、非字符串 ID，以及下一原生 turn 使用同名 item，断言作用域互不污染。保留 `turn/start` 只调用一次与原生目标继续的既有断言。
- [x] **Step 2: 看红**：`node --test src/main/codexTaskBridge.test.mjs`，预期新增断言因缺少 `item.delta` 失败。
- [x] **Step 3: 最小实现**：在 `notification` 当前线程过滤之后、`item/started|completed` 分支之前识别精确方法名；仅接受非空字符串 `turnId/itemId/delta`，拒绝 `finished.has(turnId)` 或 `seenItems.has('item/completed:'+turnId+':'+itemId)`，再 `emit` 上述内部事件。不改 `active`、`finished`、`revision`、`checkGoal` 与 RPC。注意完成 item 的去重键仍由原有分支维护。
- [x] **Step 4: 看绿**：重跑该文件测试；对比已有连续目标、失败、取消、MCP 事件测试均绿。
- [x] **Step 5: 阶段自查**：`git diff -- mcp/codex-task-bridge.mjs src/main/codexTaskBridge.test.mjs`，确认只新增展示事件及测试，未触碰计费/任务控制分支。

### Task 2: 翻译 delta 到公共事件并验证 UI 收口

**Files:**
- Modify: `src/main/agentChat/codexEvents.ts`
- Test: `src/main/agentChat/codexEvents.test.ts`
- Test: `src/renderer/src/features/agentChat/reduce.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `item.delta` JSONL。
- Produces: 现有 `{k:'text.delta',text:string}`；`item.completed(agent_message)` 保持 `{k:'text.done',text:string}`。

- [x] **Step 1: 写失败测试**：向 `createCodexTranslator().push()` 依次喂两个 `item.delta` 与一条 `item.completed`，断言 `text.delta` 两次、`text.done` 一次，且坏事件/空字符串产 `[]`；用真实既有 `codex-exec-write.jsonl` 断言旧完成路径不变。给 `reduce.test.ts` 加“Codex 两 delta + 完成 + 下一段 delta + 完成”的串行回放，断言两个最终气泡、首泡只出现一次且文本取完成项权威值。
- [x] **Step 2: 看红**：`node --test src/main/agentChat/codexEvents.test.ts src/renderer/src/features/agentChat/reduce.test.ts`，预期新增翻译断言失败。
- [x] **Step 3: 最小实现**：`codexEvents.ts` 的 `translate()` 增加 `case 'item.delta'`，仅当 `item.type==='agent_message'` 且 `typeof item.delta==='string' && item.delta.length>0` 时返回 `[{k:'text.delta',text:item.delta}]`；不修改工具、图片、usage、`item.completed` 路径。
- [x] **Step 4: 看绿**：重跑这两个文件测试及 Task 1 测试；确认归约器不需产品代码修改。
- [x] **Step 5: 阶段自查**：检查原生思考/工具输出没有被翻译成正文，完成项仍为权威版本。

### Task 3: 全链路回归、图纸与隔离应用验收

**Files:**
- Modify: `docs/architecture/10-模块领地图.md`、`docs/architecture/16-AI对话公共协议.md`
- Create: `docs/verification/codex-streaming/README.md`（仅验证记录，不存敏感正文）

**Interfaces:**
- 输入：Task 1–2 已有事件链；输出：测试/构建/应用证据。

- [x] **Step 1: 更新图纸**：在两份图纸的 Codex 托管桥接段注明 `item/agentMessage/delta → item.delta → text.delta`、`item.completed → text.done`，强调终端入口和原生目标控制不变。
- [x] **Step 2: 全量检查**：`npm run check`；记录通过/跳过/失败原数，不以局部测试冒充全量。
- [x] **Step 3: 构建**：`npm run build`；确认打包仍包含桥接脚本且无新增依赖。
- [x] **Step 4: 隔离应用**（用户允许一次真实验收，已见正文在运行中分段增长、完成后收口）：按 `open-app-verify` 用独立 `--user-data-dir` 打开本构建，进入 Codex AI 对话界面，确认可用的启动/登录/续聊/停止入口及无渲染错误；以不调用真实模型的夹具验证窗口接收事件。若要真实提问证明首字提前出现，先报告会消耗额度并取得用户确认。
- [x] **Step 5: 对照依赖图复核**：用 `git diff --name-only` 确认无 `session.ts`、`sessionState.ts`、launcher、IPC/preload、Claude/omp/终端改动；记录未验证的平台或在线模型场景。
- [x] **Step 6: 提交仅在用户要求时执行**：不得把构建包、真实对话或密钥写进仓库。

## 自检

- 规格的启动/安全、任务生命周期、续聊取消、事件协议、UI 记录及范围隔离分别由“不改清单”与 Task 1–3 的断言/差异审查覆盖。
- 五项 Review Focus 均在相应任务的新增测试或已有连续目标测试中有判据。
- 无新 CLI/IPC 类型、自动重试或额外付费调用。
