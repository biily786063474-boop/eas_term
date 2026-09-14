# 全量 3 项 launcher 失败 · 复查记录（2026-09-13 20:30–20:45 PDT）

交接页（`docs/handoff/2026-09-13-runtime-governor-2013/`）记录的最新全量失败：
第一次 `packages.test.ts` 假 CLI `--version` 8 秒 ETIMEDOUT；第二次 `codexCapabilityLauncher.test.mjs`
三条 config 阶段 5 秒内等不到夹具 pid。本轮按交接要求同条件复跑并采集同一次执行的系统状态。

## 做了什么

| 步骤 | 结果 | 文件 |
|---|---|---|
| 全量 `npm test`（并发 4），每行加时间戳，另起每秒采样器记负载/空闲内存/CPU/node 进程数 | 3114 项：3099 通过、0 失败、15 跳过，39.3 秒 | `eas-handoff-fullrun-1.log`、`eas-handoff-sampler-1.log` |
| 最小并发组合 × 3 轮：4 个真模型文件 + 7 个真起 shell/PTY/node 的文件（含两个失败文件），并发 4 | 每轮 54/54 通过；launcher config 阶段各条 0.77–1.47 秒 | `eas-combo-{1,2,3}.log`、`eas-handoff-sampler-2.log` |

未复现。两次都没有 5 秒级的进程启动延迟。

## 与失败当时的差异（有据可查的）

- 失败的两次全量各耗时 55.6 秒和 60.4 秒；本轮同一套件 39.3 秒。同组进程探测测试当时慢 2–3 倍
  （`error fails closed` 4122ms vs 1372ms；`AbortSignal terminates owned probe` 3500ms vs 1686ms）。
- 失败当时（20:00–20:03 PDT）本机另有：`~/Biily/Projects/美颜` 的 `tools/build/beauty_server`（19:38 起，
  观测到 311% CPU、2.9GB RSS）、两个正在跑命令的 Codex 会话、带 CUA 的隔离 Electron 实例。这些是外部负载，本轮未动。
- 本轮全量期间采样到一次空闲内存降到 58MB（20:32:23，CPU 738%），正是 launcher 组在跑的时刻，但这次仍在 1 秒内完成。

## 结论边界

- 不能据此断言"根因就是机器忙"：没有拿到失败那一刻的采样。能说的是：失败只出现在硬期限的起进程测试上，
  且同一时段所有起进程测试都明显变慢，环境负载显著高于本轮。
- 没有改超时、没有放宽断言、没有跳过用例。
- 已给 `codexCapabilityLauncher.test.mjs` 的两个等待循环加失败诊断（等待毫秒数、launcher pid/退出码/信号、
  stderr 尾部、夹具已写行、loadavg、空闲内存）。用 1ms 期限临时验证过文案会出现；正式文件 6/6。
  下次再撞上，断言消息里就有同一次执行的父子进程状态。
