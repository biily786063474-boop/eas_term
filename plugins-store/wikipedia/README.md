# 维基百科（开发候选，未上架）

Eas-Term 自写的零依赖 stdio MCP 适配器，不是 Wikimedia 官方 MCP，也不代表官方背书。

- `wikipedia_search`：中英文词条搜索，1–10条。
- `wikipedia_summary`：词条正文导言，最多8000字符，不宣称全文。
- 无账号、无密钥、无写入工具。不读取环境令牌、浏览器Cookie或CLI账号。
- 固定 en/zh.wikipedia.org HTTPS；公开DNS检查、连接IP固定、原域TLS验证；禁止重定向；15秒整体上限，1MB响应上限。
- 当前 stdio API 适配器仅直连，不声称支持系统PAC/代理。本机 Clash fake-IP 导致 DNS 返回198.18/15，安全策略拒绝；真实上游成功调用未通过，故不加入默认已发布目录。
- 网络地址策略由 `node scripts/build-wikipedia-policy.mjs` 从宿主唯一策略生成，禁止手改生成文件；修改后须升级插件版本。
- 插件是本机可执行代码；画布权限不是OS沙箱。此适配器不请求画布权限、不写文件。

API出处（核验2026-09-18）：
- https://www.mediawiki.org/wiki/API:REST_API/Reference
- https://www.mediawiki.org/wiki/Extension:TextExtracts
- https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
- https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy

内容归维基百科贡献者，结果带词条链接/署名说明/内容许可链接。正文可能另有特别许可说明，以词条为准；文本裁剪与去标记已告知。适配器源代码来自本项目，不复制第三方MCP实现；不新增开源许可授权，项目发行许可另行确定。
