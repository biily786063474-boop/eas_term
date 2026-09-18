# GitHub（开发候选，未上架）

这是 Eas-Term 的连接描述包；访问 GitHub 托管的官方远程 MCP，不复制或分发 GitHub 服务端实现，不代表 GitHub 对本应用的背书。包版本只固定本地清单，不能固定上游托管工具的版本或列表。

## 配置与边界

- 在 Eas-Term 插件配置密码控件填写你自己授权的 GitHub 访问令牌（PAT）。令牌加密存于插件专属配置，主进程只向固定 `https://api.githubcopilot.com/mcp/` 发送 Bearer；不写三 CLI 配置，不借用其他客户端的缓存，不在聊天填写。
- 使用限制资源和权限、设置期限的测试令牌；组织访问可能另需管理员批准。服务端工具与权限以上游和令牌实际授权为准，不能仅因配置已保存就说已连接。
- 此包不是只读插件；Demo 的仓库/Issue/PR/CI 范围可能包含写操作。验收写入只能用可丢弃测试资源。
- 401 不自动刷新或重复发送业务调用。失效令牌需在配置入口手动更新。密钥柜锁定取消本地连接；不撤销上游已发生的操作。
- 宿主目前尚未广告 `mcp.remote` / `auth.bearer`；本包未进入默认分发目录。账号、上游真实调用、完整配置与连接 UI、实际模型和 Windows 仍需验收。无假下载/可用声明。

官方依据（2026-09-18核对）：
- 远程端点与 PAT 配置：https://github.com/github/github-mcp-server/blob/main/README.md
- 宿主集成、认证与组织边界：https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md

本包仅为项目原创连接元数据，沿用项目发行许可约束；上游服务使用条件与账号权限独立适用。不因上游仓库开源而声称托管服务可无条件使用。
