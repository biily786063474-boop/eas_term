# 内置能力连接诊断 · 2026-09-07

## 已证明的缺口

实际运行应用：`~/Eas-Term-release/0.4.83-prep/mac-arm64/Eas-Term.app`（PID 28059）。运行中的 Codex PID 59976，其 Eas-Term MCP 子进程 PID 60016。

只检查环境变量存在性，不记录凭证值：

| 进程 | EAS_TERM_PORT | EAS_TERM_TOKEN | EAS_PROJECT |
| --- | --- | --- | --- |
| Codex 主进程 | 有 | 有 | 有 |
| 其 eas-mcp 子进程 | 无 | 无 | 无 |
| 两个 Eas-Term Claude 会话的 eas-mcp 子进程 | 有 | 有 | 有 |

当前 Codex 全局配置为已安装 0.4.83 的 `mcp/eas-mcp.mjs`，没有 `env_vars` 转发清单，也未显式配置 Eas-Term 环境。使用该正式包脚本进行真实 JSON-RPC initialize/tools/list 对照：

- 去掉三项 Eas-Term 环境：工具数 0，canvas_open_file 不存在。
- 继承受管会话环境：工具数 37，canvas_open_file 存在。

结论：已证明运行中的 Codex → MCP 子进程存在环境传递缺口，且足以复现空工具面。不能据此称 token 过期。外部 ChatGPT 进程下的 MCP 同样没有环境，但外部会话不取得本软件能力是预期边界，不能一并“修复”。

## 其他证据与待核对

- 当前 agent-mcp.json 同时含 eas-term / bizone-canvas；文件仍为跨会话共用路径。覆盖竞态尚未作为本次事故根因证明。
- 笔纵现装 mcpServer.js 启动时读取一次端口/token；tools/list 是正式 schema 常量，调用走 localhost HTTP。其令牌重读/断线恢复不由现有 wrapper 提供。
- 正式包隔离冒烟以只写保护用户规则时，refreshInstalledRules 在写 Codex 托管段收到 EPERM 后导致启动无法继续。改成隔离读写后，视为干净规则环境，正式包全部冒烟通过。插件化迁移应把规则更新失败作为可见、可恢复的状态，不能阻断应用启动。
- 仍需核对三端真实握手记录、PTY / AI 对话快照以及禁用设置，完成正式包新建/恢复/重启/并行 Frame 验收。

本记录不含生成操作，也未产生费用。

## Codex 实际客户端握手补证

使用当前 0.153.4 的 `codex app-server`、临时 CODEX_HOME（不复制登录凭证，不修改全局配置），只配置正式包 eas-term MCP 并显式声明 env_vars。真实 initialize → mcpServerStatus/list 返回 eas-term 的工具数 **37**，authStatus 为 unsupported（stdio 不使用 OAuth）。这验证了 Codex 客户端确实接受转发并列出工具，不只是参数字符串单测。未调用模型或生成服务。
