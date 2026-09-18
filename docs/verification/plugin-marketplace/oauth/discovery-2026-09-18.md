# OAuth 自动发现接线依据（未完成接入）

2026-09-18，服务端公开元数据经网页读取工具核验；不是本机宿主成功联网，也不是账号授权证明。

- Notion 官方客户端指南：https://github.com/makenotion/notion-cookbook/blob/main/docs/mcp-client-integration.md 。支持 PKCE、动态客户端注册。该教程把 Protected Resource Metadata 写作 RFC9470；本工程以 MCP 2025-11-25 规范引用的 RFC9728 为准，不照搬教程编号或无校验示例。
- Notion 授权服务器元数据：https://mcp.notion.com/.well-known/oauth-authorization-server ：issuer=https://mcp.notion.com，authorize/token/register 均为同源路径；支持 none、S256、CIMD。
- Sentry 授权服务器元数据：https://mcp.sentry.dev/.well-known/oauth-authorization-server ：issuer=https://mcp.sentry.dev，端点为 /oauth/authorize、/oauth/token、/oauth/register；支持 none、S256、CIMD。
- 两站根路径 protected-resource 本轮网页工具均未取到正文，不能凭此认定端点不存在或跳过资源绑定校验。
- 标准：https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization 。支持 path-aware 资源发现及 OAuth/OIDC 元数据发现；使用预注册信息优先，其后考虑 CIMD/DCR。不得借用其他客户端的 client_id。

## 当前实现边界与下一步

新增 oauthDiscovery 仅为主进程基础模块，未连接 manifest/授权按钮，不广告新能力。输入显式已批准issuer/origins，资源文档必须绑定精确resource并包含指定issuer；发现不自动扩大信任域。无凭证GET、禁止重定向、64KB流式上限、15秒总时限、S256/none/code要求；仅404进入下一标准候选路径，恶意成功响应直接失败。

缺口：从401头解析resource_metadata、宿主调用及UI确认、CIMD发布身份或DCR注册、客户端信息加密存储与刷新绑定、两站真实资源元数据/账号/三CLI/Windows验证。现有固定clientId OAuth流程保持不变，不将此辅助模块计作Notion或Sentry已接入。

## 动态注册与授权串联增量
`authorizeDynamicPlugin` 先建立本机一次性回调，再向已批准注册端点提交公共客户端元数据；注册、授权浏览器和换token共享同一redirect URI，PKCE保持S256。注册POST不重试，要求201、无跳转、64KB返回限制；服务端返回secret、其他认证方法或不同回调均拒绝。结果只向主进程返回clientId和tokens，不回传注册管理凭证。

这仍非完整接入：需将clientId与tokens一起绑定/加密保存后才可跨重启刷新。当前没有在登录按钮上启用动态路径，未向真实服务商提交注册。静态clientId授权与刷新保留，动态流程复用其取消/超时/回调安全边界。单元用真实本机回调、受控注册/token响应验证串联；不声称真实供应商授权。
