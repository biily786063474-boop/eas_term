# Codex AI 对话原生流式正文 · 共生依赖与设计

**目标**：Codex 在 AI 对话中收到原生正文增量时立即显示；最终文本仍以原生完成事件为准。不是把完整回复逐字播放成假流式。

## 关键勘查结论

当前托管 AI 对话**已经在启动器内部使用 Codex app-server**，并非需要从 `exec` 整体迁移：`session.ts` 构造 `codex exec --json` 风格参数 → `codexCapabilityLaunch(..., {taskLifecycle:true})` → `mcp/eas-codex-launcher.mjs` 将参数交给 `mcp/codex-task-bridge.mjs` → 原生 `codex app-server` JSON-RPC。桥接层对外继续发旧 JSONL，`codexEvents.ts` 翻译为跨 CLI 的 `ChatEvent`。现状桥接层只转 `item/started`、`item/completed`，**丢了 `item/agentMessage/delta`**；翻译层也没有对应分支。已安装 Codex 0.153.4 生成的协议 Schema 确认该通知的 `threadId`、`turnId`、`itemId`、`delta` 都是必填字符串。

因此最小改动是补全现有事件链，不重做会话传输。正式软件版本是否与本机 CLI 一致，仍需打包实机验证。

## 共生依赖图与不可触碰边界

1. **启动与安全**：`session.ts` 的 `sessionMcpServers`、角色约束、`codexCapabilityLaunch`、`eas-codex-launcher.mjs` 负责用户配置安全合并、受管环境与子进程所有权。流式改动只发生在已有桥接输出；不绕过 launcher、不改 `approvalPolicy:'never'`、沙箱、模型、MCP 装配、密钥或角色能力。
2. **任务生命周期**：`codex-task-bridge.mjs` 的 `thread/goal/get`、`active`/`finished`、`revision`、`turn/start` 超时不重试及 `turn.completed` 唯一收口，是原生目标连续轮次和计费幂等边界。正文 delta 只更新展示，不影响这些状态；不能把首个消息完成当整项任务完成。
3. **会话续接与取消**：`sessionState.planSend` 仍按 Codex 单次外层进程重启，并用 `resumeId` 续接；`session.ts` 的运行时准入、`wireProc`、中断、自动恢复、窗口/空闲回收依旧持有外层进程。不得为了流式改成常驻新进程，也不得在中断后自动补发用户输入。
4. **事件协议**：桥接层仅将匹配当前 `threadId`、合法 `turnId/itemId` 的非空 delta 包装为一条内部 JSONL 事件；`codexEvents.ts` 将其翻译成已有 `text.delta`。`item.completed(agent_message)` 仍产 `text.done`，作为权威最终文本。多轮/同名 item 按桥接层现有 `turnId:itemId` 作用域隔离；外来线程和完成后迟到事件丢弃。
5. **UI 与记录**：`features/agentChat/reduce.ts` 已将 `text.delta` 累积到当前气泡，`text.done` 覆盖而非重复追加；`session.ts` 只把最终文本入历史/时间线，`transcript.notePartial` 维护手机端的单格半句。主进程 IPC/preload/renderer 无须新增事件类型或 CSS。收到多段正文时，每段以其 `text.done` 收口，下一段另开气泡。
6. **范围隔离**：终端入口不启用 `taskLifecycle`，Claude 的 stream-json 和 omp 的 ACP 不经该桥接层；`adapters/index.ts` 顺序、CLI 探测/登录、模型目录短命 app-server 均不改。

## 预期行为与故障降级

- 原生 delta 到来立即展示；完成事件校准最终文本，避免重复气泡。
- 旧版 CLI 不发 delta 时保持现有整段回复行为，不因“无 delta”认定失败或重试模型调用。
- 空 delta、非字符串字段、外来线程、已收口的同一 item 的迟到 delta 不显示。任何中断/失败都按现有会话生命周期处理；不把部分文本伪装成已完成。
- 不记录原始正文到生命周期日志，不新增外部网络请求或产品依赖。

## 验收矩阵

1. 桥接层夹具：同一 item 多个 delta → completed，输出顺序、原文拼接及最终一致；多 turn 同名 item、外来 thread、空/坏数据、完成后迟到事件。
2. 翻译层：内部 delta → `text.delta`，完成 → `text.done`；旧 `item.completed` 夹具不变；工具、图片、usage 事件不回归。
3. 归约层：增量同泡、最终覆盖、分段气泡、工具调用中插、失败/打断后 busy 归零；复用已有测试，必要时补一条 Codex 事件串端到端回放。
4. 全量 `npm run check`、`npm run build`；隔离构建应用实际用 Codex AI 对话验证首字先于整轮结束、续聊、取消和无增量退化。真实模型调用会消耗用户额度，验收时先说明并取得确认。

## 明确不做

- 不把终端 Codex、Claude、omp 改道；不迁移完整会话协议或新增审批 UI。
- 不合成定时“打字”动画，不把思考流、工具输出误当回答正文。
- 不为了“流式成功”改变原生目标、自动继续、权限或计费边界。
