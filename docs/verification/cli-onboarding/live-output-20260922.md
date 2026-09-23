# CLI 安装器实时输出与命令核对 · 2026-09-22

## 官方命令
- Anthropic 官方：https://code.claude.com/docs/en/setup ，macOS/Linux `curl -fsSL https://claude.ai/install.sh | bash`。
- OpenAI 官方：https://github.com/openai/codex/blob/main/README.md ，macOS/Linux `curl -fsSL https://chatgpt.com/codex/install.sh | sh`。
- 本仓 `agentInstall.ts` 展示命令与官方一致。此前 `cliAuth/install.ts` 用 `/bin/sh -c` 执行管道，`curl` 失败可能被右侧 shell 的 0 退出码掩盖；现官方 POSIX 管道由 bash pipefail 执行，其他命令不变。`installOut.test.ts` 用假 curl 退出 22 证明整个安装退出 22，未访问外网。

## 实时 GUI
- 输出按完整 CR/LF 行处理、去 ANSI、脱敏后进入最近 80 行有界快照；跨 data chunk 凭证不提前透出，超长行整行省略。
- 默认展示当前状态与最近 3 行，详细输出折叠；30 秒无输出显示距上次输出秒数；不显示估算百分比。
- `component-check.cjs` 在隔离 Electron 使用模拟 IPC 操作真实 React 组件，断言动态输出、停滞提示、最小化/恢复、贪吃蛇、失败翻译、重试和登录确认。截图 `live-install-output.png` 是模拟安装数据，不冒充真实 CLI 下载。
- 真实 CLI 安装与 Windows 分发包上的本功能尚未实测；不能据此宣称完整发布验收。

## 错误回传和兜底复核
- 根因：安装进程返回非 0 后仍先调用 `checkAuth`，其 `error` 可将真实退出码和安装器错误覆盖；已调整为非 0/信号中断直接失败并带脱敏尾部输出，仅退出 0 后进行安装验证。控制器回归用 `curl: (6)`、退出码 6、二次探测故意报 EACCES 验证探测不会再运行或遮蔽。
- 分类新增 HTTP 4xx/5xx、TLS 证书、DNS/连接、shell 无法启动和安装后验证异常的保守中文建议。保留原始诊断详情、其他可用安装方式和「把命令填进终端」退路；不自动降级到另一个安装器，也不自动重复执行远程脚本。
- `npm run check`：3540 测试、3522 通过、18 跳过、0 失败；`npm run build` 通过。重新打包隔离 React 组件并用 Electron 跑 `component-check.cjs`，GUI 失败翻译/重试/最小化/状态保留通过。第一次组件验收因 Vite 绝对资源路径导致按钮未加载，改以 `--base ./` 重建后通过；不是产品代码故障。
- 仍未在一台真正未安装 CLI 的系统上执行官方安装脚本；Windows PowerShell 下载管道也未做真机验证，不能据模拟器宣称它们通过。
