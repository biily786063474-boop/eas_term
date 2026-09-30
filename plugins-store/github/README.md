# GitHub（只读）

这是 Eas-Term 的连接描述包：连 GitHub 托管的官方远程 MCP 的**只读模式**（`https://api.githubcopilot.com/mcp/readonly`）。
不复制或分发 GitHub 服务端实现，不代表 GitHub 对本应用的背书。包版本只固定本地清单，不能固定上游托管工具的版本或列表。

## 能做什么

让 AI 查看仓库、代码、Issue、PR、Actions 运行情况等。只读模式下服务端不提供创建、修改、删除类工具。
（2026-09-30 用户决定先上只读版；可写版等真实账号验收、跑一段时间后另做。）

## 配置与边界

- 在 Eas-Term 插件配置的密码框填写你自己的 GitHub 访问令牌（PAT）。令牌加密存在本机插件专属配置里，主进程只向固定的
  `https://api.githubcopilot.com/mcp/readonly` 发送 `Authorization: Bearer`；不写三个 CLI 的配置，不借用其他客户端的缓存，不在聊天里填。
- **建议用细粒度令牌**：只选需要的仓库，权限只给 Read-only，并设置到期时间。只读模式是服务端的保护，令牌本身也收窄，是第二道保险。
- 组织仓库可能要管理员批准令牌；如果你在开了 Copilot Business / Enterprise 的组织里，组织要打开「MCP servers in Copilot」策略（GitHub 官方文档原文）。
- GitHub 官方文档：「The GitHub MCP server is available to all GitHub users regardless of plan type」，不需要 Copilot 订阅；
  个别工具若对应的 GitHub 功能本身要付费，这个工具也要付费。
- 401 不自动刷新、不重复发送业务调用；令牌失效要在配置入口手动更新。锁定密钥柜会断开本地连接；卸载插件会删掉本机保存的令牌。

官方依据（2026-09-30 核对）：
- 远程端点与 PAT：https://github.com/github/github-mcp-server/blob/main/README.md
- 只读与工具集路径（`/readonly`、`/x/{toolset}`）：https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
- 适用人群与组织策略：https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/use-the-github-mcp-server

本包仅为项目原创连接元数据，沿用项目发行许可约束；上游服务使用条件与账号权限独立适用。
