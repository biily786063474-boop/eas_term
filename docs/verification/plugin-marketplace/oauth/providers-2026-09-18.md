# Notion / Sentry 候选端点核验（2026-09-18）

仅公开 GET 文档核验；未注册真实客户端、未登录账号、未提交上游业务数据。

## Notion
- 官方连接指南：https://developers.notion.com/guides/mcp/get-started-with-mcp
- 授权服务器元数据：https://mcp.notion.com/.well-known/oauth-authorization-server
- 指南给出的 MCP URL 为 https://mcp.notion.com/mcp；元数据对应 issuer https://mcp.notion.com，授权/token/注册路径分别为 /authorize、/token、/register，支持 public client none 和 S256。
- 当前元数据未声明 authorization_response_iss_parameter_supported，不能推出实际回调支持或不支持 iss。宿主要求精确 iss，真实兼容性待验证，不能为了接入移除该校验。

## Sentry
- 官方连接说明：https://mcp.sentry.dev/
- 授权服务器元数据：https://mcp.sentry.dev/.well-known/oauth-authorization-server
- 基础 MCP URL 为 https://mcp.sentry.dev/mcp；issuer https://mcp.sentry.dev，授权/token/注册路径分别为 /oauth/authorize、/oauth/token、/oauth/register，支持 none、S256，声明 authorization_response_iss_parameter_supported=true。
- 官方建议组织/项目级缩小范围。本候选固定基础URL，不允许 renderer 自由传URL；真实账号使用前需按授权页确认范围，不承诺只读。

## 未验证边界
两家的 /.well-known/oauth-protected-resource/mcp 均无法由本次 web 工具读取，前轮根路径也无成功证据。这不是上游不存在的证据；目前不能声称完整发现成功。宿主不会因元数据缺失而放宽校验。

候选包只保存已核验的公开端点、不内嵌 clientId 或秘密、不默认加入目录。单测实际打包并校验 manifest/版本2兼容信息/旧目录排除，不能替代真实上游授权。真实账号与业务操作验收之前，可用供应商数量不增加。

首轮58448检查失败（原样）：TS7016 Could not find a declaration file for module '../../scripts/plugin-registry-build.mjs'；TS7006 Parameter 'p' implicitly has an 'any' type。新测试无TS专属语法，与已有pluginRegistryBuild.test.mjs一致改用.test.mjs；不通过any/ts-ignore削弱生产类型检查。

47251重跑全量：3419项，3400通过、18跳过、1失败。原样错误：`owned IPC disconnect during exec waits for the actual child to exit` / `5 秒内夹具没到达 exec 阶段`；elapsedMs=5005、rows=[]、loadavg=[9.1,8.4,7.2]。完整该项断言保存candidate-recheck-failure.json。观察到同机有另一个全量检查进程，但不能据此断言根因；未修改其他会话进程、未修改启动器或放宽超时。46650专项及全量复验中。

46650最终退出0：启动器+候选专项7项通过；完整检查3419项/3401通过/18跳过/0失败。此前时序超时仍是已记录的未根治风险，不由一次复跑抹除。本候选批未改应用实现，应用证据沿用前批76151，不冒称真实供应商已验收。
