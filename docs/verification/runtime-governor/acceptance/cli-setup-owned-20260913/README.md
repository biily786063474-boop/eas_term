# CLI 安装 / 登录进程登记为可停自有服务 · 隔离实例验收（2026-09-13 22:05 PDT）

用户决定（2026-09-13）：给停止按钮，走一次确认。不排队（登录是交互、安装不可任意中断）。

隔离实例 `node scripts/verify-app.mjs --port 9470`。安装命令用无害的 `sleep 100` 代替真实安装脚本。

| 步骤 | 观察 |
|---|---|
| `cliAuth.startInstall('codex','sleep 100')` | `runtime:monitor` services：`cli-install:codex:1`「CLI 安装（codex）」`kind:'cli'`、running、`canStop:true`；隔离实例名下出现 `sleep 100` 子进程 |
| 运行中心 | 托管服务列出该行，带"关闭服务"按钮（`install-listed.png`）。原生确认框是与终端/AI 停止共用的同一处 dialog，本轮未用自动化点它 |
| 走停止闭包（`cliAuth.cancelInstall`，与确认后执行的是同一个函数） | 1.5 秒后 services 为空，`sleep` 进程消失——服务随真实 close 才移除 |

未验：登录进程路径没有在真机跑（会触碰真实 CLI 凭证，见 memory「测登录别毁凭证」），只有 `ownedProcess.test.ts` 行为测试与 `ownedWiring.test.ts` 结构守卫；原生确认框点击未自动化。
