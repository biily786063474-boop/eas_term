# 16GB Device Adaptive Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start implementation before the design and this plan are reviewed.

**Goal:** 修正低内存设备上的误拦与首次消息失败体验，建立真实 16GB 基线，再按热点做可验证的内存适配。

**Architecture:** 先把系统压力与后台预算拆开，交互型启动只响应真正严重压力；调度结果使用结构化错误码。独立采集聚合进程内存基线，最后仅对实测热点做懒加载、暂停或缓存限额，不引入“16GB = 固定阈值”的硬编码。

**Tech Stack:** Electron 37、TypeScript、Node test runner、React；无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-26-low-memory-adaptive-design.md`；问题证据：`docs/diagnostics/2026-09-26-claude-first-message-timeout.html`。

## Global Constraints

- 从最新 `origin/main` 建隔离工作树；不得覆盖当前脏工作树。源码变更同一 commit 更新 `docs/architecture/10-模块领地图.md`、必要时更新 `03-agent角色边界.md`。
- 保留 `guardPath/guardDir`、`src/main/index.ts` 注册顺序及沙箱安全边界。
- 不杀活动 CLI/插件/未保存视图；不得把用户消息静默自动重发。
- 所有新增诊断不含消息正文、密钥、命令、项目路径；日志有限额和用户可删除路径。
- UI/行为改动必须构建、打开隔离应用亲眼验证，未验证不得声称完成。

## Review Focus

1. 首次样本 CPU 为空、样本过期、采样失败：不能让首次聊天误排队。
2. macOS warning/critical 与 Windows/Intel/旧 macOS 未校准：各自必须走明确且可测试的分支。
3. 60 秒超时与 CLI 进程刚好启动的竞态：消息最多投递一次，用户得到真实状态。
4. 用户切换/关闭 Frame、取消等待、重启应用：未发送的原文仍可找回，不留下假“运行中”。
5. 多个正在运行的 CLI、媒体预览和插件：不以回收资源为由中断活动任务。

---

### Task 1: 建立首聊准入回归与正确的压力分级

**Files:** Modify `src/main/runtime/controller.ts`; Test `src/main/runtime/controller.test.ts`, `src/main/runtime/agentStartupLifecycle.test.ts`; Review `src/main/runtime/policy.ts`, `manager.ts`, `readPlatformMetrics.ts`.

**Interfaces:** 输入 `Reading.memoryPressure` 保持 `normal | warning | critical | null`；输出给现有 manager 的 `critical` 仅在 `memoryPressure === 'critical'` 时为真。不要改变后台 50%/80% 策略，先隔离故障。

- [ ] 写失败测试：有效 16GB/arm64 样本为 warning 且 CPU 有效时，interactive Claude 首条消息应启动；critical 应等待；未校准/缺样本应直接走监测不拦。
- [ ] 运行定向测试，确认 warning 用例按现状失败。
- [ ] 最小改动修正压力映射；运行上述测试及整个 runtime 测试集。
- [ ] 审查是否存在第二处 warning→critical 映射；更新架构图纸并提交独立 commit。

### Task 2: 区分“队列超时”和其他启动超时

**Files:** Modify `src/main/runtime/scheduler.ts`, `startupFailure.ts`; Test `scheduler.test.ts`, `startupFailure.test.ts`; Review `sessionStartup.ts`, `agentChat/session.ts`.

**Interfaces:** 调度器抛可识别的 `WaitTimeoutError`/错误码；`startupFailure` 仅对该类型输出“等待资源超时”。保留原有取消与 fatal 语义，普通 `spawn timeout`、网络 timeout 必须保留真实错误类别。

- [ ] 先写失败测试，覆盖队列 timeout、spawn timeout、network timeout、cancelled 及非 Error 值。
- [ ] 运行失败测试；实现结构化分类，不匹配 `/timeout/i`。
- [ ] 跑 runtime 与 agentChat 相关测试，检查已有调用方没有依赖旧字符串；更新图纸并提交。

### Task 3: 首条消息失败后可安全重发

**Files:** Modify `src/renderer/src/features/agentChat/AgentChatView.tsx`, `src/shared/agentChat.ts`（仅在事件契约必须扩展时）；Test 对话状态/首发失败测试及 `scripts/verify-agent-chat-ui.mjs`；Review `src/main/agentChat/session.ts`.

**Interfaces:** `start ok` 与 `message dispatched` 必须有区分；未投递时保留原文与失败标记，给用户“重新发送”操作。操作需要用户点击且同一失败消息只能触发一次；不得自动发送或复用不确定的 in-flight 状态。

- [ ] 写失败测试：异步准入超时后原文可恢复、不会重复投递；取消和 Frame 卸载也能恢复。
- [ ] 实现最小 UI 状态与明确文案，不做全局消息队列重构。
- [ ] 运行测试、`npm run check`、`npm run build`；按 open-app-verify 构建并打开隔离应用，在同一 AI 对话位置验证 warning/critical/取消/手动重发。
- [ ] 更新对应图纸并提交。

### Task 4: 建立 16GB 资源基线（先测量，后优化）

**Files:** Modify `src/main/runtime/ipc.ts` 与 `src/shared/runtimeResources.ts` / `src/preload/index.ts`（仅当现有 monitor 无法安全承载聚合指标）；Create `scripts/verify-low-memory.mjs`; Test 新的诊断数据过滤/限频测试；Review `src/main/diagLog.ts`, `runtime/idleWatchdog.ts`.

**Interfaces:** 按需读取 `app.getAppMetrics()` 的进程类型、内存/CPU 聚合值；报告不含内容/路径；不增加渲染层常驻轮询。采集阶段：冷启动、空闲 3 分钟、首次 Claude 启动、3 Frame、媒体/3D 预览及收起后 3 分钟。

- [ ] 先写脱敏/限频测试，证明日志不会携带提示词、命令、密钥或项目路径。
- [ ] 复用现有 main 进程采样，建立脚本和一份机器可读基线；跑 8/16/32GB 或等效隔离环境矩阵。
- [ ] 在实体 16GB 设备复测；若暂时拿不到，标注“未现场验证”，不得进入“已适配”结论。
- [ ] 提交采集工具与匿名汇总，不提交原始用户数据。

### Task 5: 后台预算与热点优化（以 Task 4 结果分支执行）

**Files:** 先看基线再确定，候选：`src/main/runtime/policy.ts`, `resourceLedger.ts`, `manager.ts`; `src/renderer/src/features/workspace/PaneView.tsx`、媒体/网页/3D 面板与插件宿主对应文件。Test: 每个被选热点的生命周期与内存回收测试。

**Interfaces:** 用户交互型不受后台百分比阈值误拦；后台准入考虑真实压力/可用余量。仅暂停或释放可恢复的隐藏内容；关闭后再打开必须保持视图/会话/数据一致。

- [ ] 依据 Task 4 排名选前两项热点，记录每项基线/预期收益；不达标热点不改。
- [ ] 每项单独写失败测试→最小实现→定向与全量回归→隔离应用验收→独立 commit。
- [ ] 在相同 16GB 场景比较本软件进程组合峰值，目标下降至少 20%；检查首次消息时延、活动任务/数据完整性无回退。
- [ ] 若热点在插件或外部 CLI，自主软件无法安全卸载时只改启动时序/并发，不谎称能控制其内存。

### Task 6: 发布前验收闸

**Files:** `docs/verification/low-memory/` 新增脱敏报告；更新架构图纸与发布记录；不直接修改安装包。

- [ ] `npm run check`、`npm run build`、Mac/Windows 相应 CI 均通过；Windows 必须跟踪 Actions 至完成。
- [ ] 在隔离全新用户数据的正式打包应用中跑首次 Claude 发送、warning/critical/恢复、手动重发、多 Frame/媒体和退出重进；截图及资源曲线落本地验证目录。
- [ ] 记录 16GB 真实机前后对照；若缺设备，发布说明明确“16GB 现场未验收”。
- [ ] 只在全部验收后按 release skill 从最新 `origin/main` 发版；此计划本身不授权发版。
