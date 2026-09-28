# Claude 后台任务运行中反馈 · 验收（2026-09-28）

问题：Claude Code 用 `run_in_background` 跑命令时，本轮 result 先到，CLI 里显示「1 shell still running」，AI 对话模块却显示完成，用户误以为任务结束。

- 事件来源：真实 Claude Code 2.1.283 探针（`sleep 25` 后台），录下 `background_tasks_changed` / `task_notification` / 自发第二轮，存为 `src/main/agentChat/__fixtures__/claude-background-shell.jsonl`。
- 真机验收：`node scripts/verify-claude-background-running.mjs`（需先 `npm run build`）。隔离 Electron 实例 + 假 `claude` 按实测事件顺序回放，**不是真实模型**。
- 结果见 `result.json`；截图：`1-background-running.png`（本轮已结束、后台在跑）、`2-wake-turn-running.png`（CLI 自发一轮）、`3-finished.png`（真正完成后才出完成角标）。
