# CLI 更新下载/校验接应用级任务 · 隔离实例验收（2026-09-13 21:00–21:10 PDT）

隔离实例：`node scripts/verify-app.mjs --port 9470`（worktree 最新构建，独立 userData，未碰生产）。

| 步骤 | 观察 | 证据 |
|---|---|---|
| 打开运行中心 | 范围说明含"应用自己发起的 CLI 更新下载"与"应用级任务不归任何窗口，这里只显示不能取消"；无错误边界 | `runtime-center-note.png` |
| `runtimeSetMode('eco')` + `cliUpdates.setEnabled('codex',true)`（隔离 profile 内存读数 35/48 GB > 50%） | `runtime:monitor` 的 tasks 出现 `cli-update:codex`，`scope:'app'`，`state:'queued'`，`reason:'memory-threshold'`；面板行"CLI 更新下载与校验（codex） · 排队中"，取消按钮数 0；隔离目录 `cli-versions/` 只有 `state.json`，**没有发起下载** | `update-queued-eco.png` |
| 等待 60 秒排队超时（第一版） | 更新行文案为"更新超时，继续使用当前版本。网络恢复后可重试。"——误把资源排队说成网络问题 | 已修 |
| 修正后重建、换新实例复现 | 更新行文案为"资源紧张，更新下载排队等待未获准入；下次定期检查会再试，也可切回普通模式后重试。" | 本页记录 |

未验：普通模式下真实放行→下载→解包→异步校验→pending 的全链（会真的从 npm 拉包，需要有更高版本可用），以及 boot()/rollback() 的同步校验路径（只有单测）。
