# 下一批远程插件：Notion / Sentry · 2026-09-22

基准：既有统一OAuth/DCR宿主与插件清单；只核对供应商差异，不新增第二套授权流程。原目标分别为页面/数据库读写、错误/项目查询。

官方资料：
- https://developers.notion.com/guides/mcp/build-mcp-client
- https://developers.notion.com/guides/mcp/overview
- https://mcp.sentry.dev/

公开GET证据：两个授权元数据原文JSON、Notion资源元数据JSON，Sentry根资源元数据404错误原文。manifest-check.json确认端点/none/S256一致，candidate-tests.txt为实际候选打包测试。未触碰账号令牌、未注册身份、未提交用户内容。

Notion资源发现从前轮“无成功证据”更新为本轮成功。Notion仍未声明iss回传支持，不能凭元数据推断真实回调，更不能删宿主issuer检查。Sentry仍需真实用户登录后核查工具/范围，官方建议组织/项目级限制。两候选暂不进入公开已验收目录。
