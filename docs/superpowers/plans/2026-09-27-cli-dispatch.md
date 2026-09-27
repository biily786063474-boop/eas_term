# 多 CLI 错峰调度 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans（本会话顺序实施）；若用户选择分工则用 subagent-driven-development。

**Goal:** 三家托管 CLI 共用默认 2 并发、1000ms 实际派发间隔的可取消队列。
**Architecture:** 主进程统一轮次调度，复用资源门和现有任务展示；生命周期代次令牌防重复释放。进程启动成功不代表轮次完成。
**Design:** docs/superpowers/specs/2026-09-27-cli-dispatch-design.md（已确认）
**Execution:** 推荐本会话顺序实施，最后独立审查；执行方式待确认。

## 1. 隔离与核心
- [ ] 读 using-git-worktrees 及架构03历史修复区、10、13、17；fetch main，新建独立工作树 fix/cli-dispatch-20260927，不动主工作区脏文件。
- [ ] 记录基线并运行 npm run check。扫描 session.ts 的 deliverMessage/restartAndDeliver/writeStdin/acp.deliver/自动恢复/slash，列出所有触发模型轮次的入口。
- [ ] 新增 runtime/cliTurnQueue.ts 与测试，注入单调时钟和 timer。接口 enqueue(job)、cancel(key)、finish(key)、setLimit(n)、snapshot()、dispose()；job 包含 key/sessionId/projectId/start/cancelRunning。key 为会话+递增代次。
- [ ] 先写红测试：2并发，第一项立即开始，第999ms仍一项，第1000ms第二项开始；第三项直到真实 finish 才开始。重复 finish 不释放新轮次。运行 node --test src/main/runtime/cliTurnQueue.test.ts 确认红后实现。
- [ ] 项目轮转、项目内FIFO；等待最多128项，每会话最多一等待项，满载返回明确错误。同步预留后启动；取消运行项先标记，真实确认结束才释放；dispose清timer且拒绝新项。
- [ ] 覆盖公平性、队满、重复key、取消与派发竞态、start抛错、调小不强停、调大仍遵守间隔、旧key迟到、定时器清理。运行专项至绿。

## 2. 三路接线与结束确认
文件：agentChat/session.ts；新增 cliTurnDispatch.ts/test.ts；必要时修改 adapters 与 omp/transport.ts 的回调归属。
- [ ] 先写三路夹具失败测试：首轮、复用会话、手机发送、自动恢复都进统一入口；取消/批准控制消息不排队。
- [ ] 拆 enqueue 与 dispatchNow。沿用既有 planSend/busy 校验，入队后IPC立即返回；保留未派发正文供 message.unsent 恢复，派发后不得自动重放未知结果。
- [ ] 资源门与并发门都满足才允许实际派发。资源等待采用可取消准备阶段，实际传输入口同步提交1000ms间隔，不能预先计时后集中发送。
- [ ] 真实 turn.done、进程close、确认取消携带代次释放；UI合成turn.done、slash静默回执、未确认fatal不得误释放。异常回调必须幂等。
- [ ] 排队不启动执行/首响应计时；取消排队不写stdin/ACP，关闭会话/窗口只清所属项，退出不自动重放。授权等待首版占额并明确提示。
- [ ] 测试：三路三会话最多两项；后续消息无旁路；取消零传输；旧进程回调不释放新项；运行取消未确认第三项不启动；自动恢复无重复入队。
- [ ] 核查父任务等待托管子任务的路径，禁止持有全部许可再等子任务导致死锁；不能安全交接时明确拒绝嵌套调度并保留状态，不无限等待或静默突破上限。

## 3. 配置和等待反馈
文件：shared/runtimeResources.ts、shared/agentChat.ts、main/runtime/stateStore.ts/test.ts、controller.ts、ipc.ts、preload/index.ts、RuntimeSettingsPage.tsx、agentChat/reduce.ts/test.ts、ChatToolbar.tsx。
- [ ] 先测旧配置迁移、非法输入与持久失败，再加 cliConcurrency：缺省2、整数1–8。保持 mode/stoppedPlugins，固定路径仍过guard，不改变损坏文件fail-closed。
- [ ] 新 runtime:setCliConcurrency IPC校验调用方和值；落盘成功后更新运行值，失败保持旧值并报错。同步preload契约。
- [ ] 新 dispatch.status 事件含key、queued/running/cleared、排位与原因，不含正文。旧代次不能覆盖新状态，历史加载不恢复为活动等待。
- [ ] 设置沿用现有主题：省网络1、均衡2、自定义1–8；排队显示“等待调度”与取消，不承诺预计时间。监控合并启动/轮次显示，不重复算任务。
- [ ] 验证配置恢复、调低不中断、排位更新、取消、旧事件、窄窗口；保持已有低频监控，不增加高频渲染。

## 4. 验收与收尾
- [ ] npm run check 与 npm run build，失败原样记录，不放宽超时掩盖问题。
- [ ] open-app-verify：新增 scripts/verify-cli-dispatch.mjs，以真实隔离Electron和三路协议夹具测同时发送、1秒实际传输间隔、并发峰值、取消零发送、完成推进、调参、重启不重放。
- [ ] 实际操作设置与等待反馈，亮暗主题留图，断言及截图存 docs/verification/cli-dispatch/ 并提交所属Frame。
- [ ] 更新架构10/13/17；独立审查后仅提交本任务并默认推送分支，不擅自合并或发版。
- [ ] 真实在线三家端到端与Windows未跑则写未验证，夹具不冒充在线结果。

## Review Focus
- 资源等待结束集中发送：任务2核对实际传输时间。
- 合成完成/迟到事件误释放：任务2代次测试。
- 调低并发误杀任务：任务1及3测试。
- 排队取消丢草稿或仍发送：任务2零传输断言。
- 父子任务死锁：任务2嵌套路径测试。

## 自审
设计覆盖：任务1并发/间隔/公平/队列边界；任务2全入口/生命周期/超时/恢复；任务3持久化/反馈；任务4实机与隔离。无网络代理、新出站或额外LLM调用。不承诺精确带宽限制。
