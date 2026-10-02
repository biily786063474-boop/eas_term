# Codex 长程目标在 exec 退出时被中断（2026-09-18）

## 排查结论
用户提供插件市场会话反复需要“继续”的记录。匹配本机 rollout thread 01a0b29a-021a-7391-9e1e-fda0b09e5230。不是仅凭 UI 或进程 code=0 推断。
- 原始 assistant 输出确实带 phase=final_answer（不是 Eas-Term 把 commentary 改成 final）。
- 该线程存在原生 active goal；task_complete 后自动注入 codex_internal_context source="goal" 并启动新 turn，然后约几十毫秒内 turn_aborted(reason=interrupted)。
- 提取到 34 个完成→下一轮启动→同轮中断的相邻序列；是否每个都含 goal 见脱敏 JSON，而非笼统视为 34 次相同原因。
- 明确例证 UTC 17:29:08.174 完成 → .181 新轮启动 → .190 目标续跑上下文 → .253 中断，新轮 duration_ms=72；宿主 17:29:30.545 记录 ac-15 正常退出 code=0、非主动 kill。

## 代码交叉证据
本机 codex-cli 0.153.4，Eas-Term adapters/codex.ts 使用 exec [resume] --json。
官方 rust-v0.153.4：exec/src/event_processor_with_jsonl_output.rs 506–529：TurnCompleted(Completed) 产 turn.completed 并返回 InitiateShutdown。
exec/src/lib.rs 1113–1138：收到 InitiateShutdown 调 thread/unsubscribe，跳出事件循环，client.shutdown；1427–1466 对多个通知只接收原 task_id，不能直接接受目标自动续轮的不同 turn_id。
源码：https://github.com/openai/codex/tree/rust-v0.153.4/codex-rs/exec/src
上述与原始中断序列相符，强支持 exec 单轮收尾与原生 goal 自动续跑冲突这一接入根因。

## 更正早前判断
“原生没有续跑机制”“只是模型自愿停工”“必须先自行实现自动继续”均证据不足；现在已经看到原生目标续跑启动后中断，不应通过宿主盲发继续掩盖。

## 状态与后续
已定位日志与代码机制，尚未修改生产代码，也未做同任务 exec/app-server 受控 A/B。优先验证持久 app-server 接入能保留原生目标续轮，并同步 turn.started/busy、用户停止、恢复、授权/安全和资源调度。不能只放宽 turn.done 或把每次普通问答自动重启。
证据：docs/diagnostics/2026-09-18-codex-goal-abort-evidence.json；只存时序/原因，不存用户完整对话或凭证。主线定向39项通过只能说明原有契约，未覆盖这个长程目标边界。

## 2026-09-18 已实施并验证（未发布）
- 修复工作区 `/tmp/eas-timeline-integrate`，分支 `fix/codex-goal-lifecycle-20260918`，基于88ae4a8；代码未提交，勿清理 worktree。原工作区其他 agent 改动未动。
- 计划：该 worktree 的 `docs/superpowers/plans/2026-09-18-codex-goal-lifecycle.md`。
- AI 对话专用 launcher 使用 app-server，原生 goal active 时跨轮保持服务与 busy；不创建目标、不发“继续”；普通无目标问答正常结束，停止不重启。终端、Claude、OMP路径不改。
- 最终 npm run check：3279通过、19跳过、0失败；构建通过；47项定向通过。最初一项launcher启动5秒夹具超时，未改超时，专项及全量复跑绿，记录保留。
- 真实Codex0.153.4＋本地Responses夹具＋真实Electron验证原生两轮、busy、预算停止、普通resume、用户停止。最终截图已亲眼查看；不是在线模型验收。验证路径 `docs/verification/codex-goal/`。初次CDP启动超时与画布绑定错误修正于验收脚本，未改生产UI安全规则。
- 独立审查发现fileChange拒绝状态与kind映射后已加回归修复；最终复核无阻断项。
- 未验证：真实在线账号模型、Windows实机、旧CLI兼容；未合并、未替换正式应用、未发布。下一步按用户指令提交本次隔离改动/合入，勿夹带插件市场或时间线其他工作。

## 2026-09-18 用户授权审查并合并
- 独立合并门禁复核无阻断项；修复提交 `471456f` 已快进合入本地 `main`，工作区 `/tmp/eas-timeline-integrate` 干净。
- 合并前与合并后 npm run check 均3279通过、19跳过、0失败；仅提交本次21个文件，无其他agent改动。
- 未push（main领先origin/main 1提交），未发版、未替换正式应用。真实在线模型、Windows实机及旧CLI未验证。
