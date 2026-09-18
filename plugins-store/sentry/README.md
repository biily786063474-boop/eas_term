# Sentry 开发候选

使用官方远程 MCP，只有用户明确连接账号才执行动态注册和浏览器授权；不读取其他 CLI 凭证。所有令牌和动态客户端身份只在主进程加密保存。

尚未完成真实账号、供应商回调与业务工具验收；未纳入默认市场，不计为可用插件。访问范围以供应商授权页和当前账号为准，工具可能写入数据。

宿主要求 mcp.remote / auth.oauth / auth.oauth.dcr，目前未对市场广告。核验资料见 `docs/verification/plugin-marketplace/oauth/providers-2026-09-18.md`。
