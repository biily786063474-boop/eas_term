# 执行清单「缺少有效项目或轮次」修复验收（2026-09-30）

分支 `fix/plan-turn-self-initiated-20260930`，基线 main `dd5b72bc`。

## 症状（用户反馈「执行清单时好时坏」）
清单工具报「执行清单缺少有效项目或轮次」：同一轮里前面正常、某个时刻之后全部失败并持续到本轮结束，用户发下一条消息后恢复。
清单停在半路，做完的步骤勾不上。

## 根因
后台任务（`run_in_background` 的 shell、子 agent）在本轮 `result` **之后**才跑完时，Claude 收到 `task_notification` 自己续一轮；
`session.ts` 在 `background.wake` 上补了 `turn.start`，但开执行清单轮次的 `ensurePlanTurn` 只在三条用户发送路径上，
续上的那一轮没有轮次（上一轮 `turn.done` 已经 `endPlanTurn`），`pluginHost.ts` 的 `activePlanTurn` 为空，报上面那句。
后台在本轮进行中跑完时通知并入当前轮、不补轮次，所以不出错——这就是「时好时坏」。

## 修复
- `executionPlanTurns.ts`：轮次带 `continuation` 标记。续轮结束不发 `plan.missing`（清单通常在用户那一轮已建，续轮多半只是收尾）；
  用户在续轮进行中发消息，发送路径的 `ensurePlanTurn` 清掉标记，这一轮归用户、照常判断。
- `session.ts`：`background.wake` 补 `turn.start` 之前 `ensurePlanTurn(…, { continuation: true })`。

## 验证
- 复现测试 `src/main/agentChat/planTurnSelfInitiated.test.ts`：真实录制的 `__fixtures__/claude-background-shell.jsonl`
  驱动 `session.ts` 真实的 `handleEvent` / `wireProc` 与真实 `executionPlanTurns`。改前「续轮说话时有轮次」失败；改后 3 项通过。
- `npm run check`：4289 项，4269 通过、19 跳过、1 失败——`capabilityPtyLauncher` 真终端 Ctrl-C 计时测试，
  不在改动范围、机器负载 5–6，单独重跑 12/12 通过（合并 oss/publish-desk 时也出现过同一偶发）。
- **真实 Claude 端到端**（`scripts/verify-plan-turn-wake.mjs`：隔离配置目录 + 临时项目，用本机 Claude 登录，不改凭证；
  判据是项目 `.eas/execution-plans.json`，不看 AI 自述）：让 AI 建两步清单、起后台 `sleep 20`、勾第一步后结束本轮，
  后台跑完 CLI 自己续一轮时勾第二步。
  - 修复版：第一轮结束（AI：「本轮结束，等后台完成通知后再勾选第二步」），约 9 秒后续轮里 `step_update` 成功，第二步 `reported_done`。**通过**。
  - 对照组（两个文件临时换回 main、重新构建，同一脚本）：续轮里 `step_update` 报「执行清单缺少有效项目或轮次」，第二步停在 `pending`。**复现原问题**。
  - 界面上「已执行但未建清单」只出现在用户那一轮下面，续轮不重复提示。
  - 三趟真实模型调用共约 $1.4（第一趟因临时目录是 `/var` → `/private/var` 链接，报「执行清单项目不匹配」作废，脚本已改用 realpath）。

## 未验证 / 另记
- Codex、omp 目前不产生 `background.wake`，未涉及。
- 顺带发现：项目路径经过符号链接登记、而 CLI 跑在真实路径时，清单报「执行清单项目不匹配」。与本问题无关，未改，另行评估。
