# 插件 MCP 服务器进程启动准入 · 隔离实例验收（2026-09-13 21:40 PDT）

隔离实例 `node scripts/verify-app.mjs --port 9470`（worktree 最新构建，独立 userData）。自带「看板」插件（`eas:board`，面板 `main`）。

| 步骤 | 观察 |
|---|---|
| 节能 50%（隔离读数 31/48 GB）下 `plugins.panelOpen` | `runtime:monitor` tasks：`plugin-start:board`「插件 看板 启动」`scope:'app'`、`queued`、`memory-threshold`；services 为空；隔离实例名下**没有** board 服务器进程 |
| 运行中心 | 行"插件 看板 启动 · 排队中"，显示"应用级任务：所有窗口可见，不能从窗口取消"，取消按钮数 0（`plugin-start-queued-eco.png`） |
| 等 60 秒排队超时 | panelOpen 返回 `{ok:false, error:'资源紧张，插件启动排队等待未获准入；稍后重试，或在运行中心切回普通模式'}` |
| 切普通 80% 再开 | `ok:true`；tasks 清空；services 出现 `plugin:board:1` running；进程树里出现 board 服务器 node 进程 |

未验：同一插件被多窗口/多 shim 并发请求时的真实合并（单测覆盖）；builtin-bizone 连接器路径未接准入；Windows/Linux 未实测。
