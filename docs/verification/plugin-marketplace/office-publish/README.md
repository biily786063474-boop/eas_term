# 插件市场真实发布 · 2026-09-22

用户授权：发布 WPS 三项到插件市场，然后继续集成其他插件。

## 已完成

1. 三件套：Excel 1.1.0、Word 1.0.0、PowerPoint 1.0.1 发布至生产 v2 目录。候选内容与 WPS 真实验收使用内容一致。
2. 后续第一项本地文件 1.0.0：沿用原定目录权限样板与34项隔离宿主证据；本轮重新完成真实打包/解包/McpClient stdio，验证列目录、中文读写、SHA覆盖、旧SHA拒绝与越界拒绝后增量发布。
3. v2 现6项：原番茄钟/看板 + 三件套 + 本地文件。v1仅保留原2项。旧包字节直接复用生产版，未重打包或替换旧版本；每次仅新增获验收的包，不发布默认构建内尚未实测的其他候选。
4. 两次均复用 scripts/plugin-publish.mjs：锁、单文件SCP、逐包大小/SHA256、版本不可覆盖、目录逐文件原子替换、回退快照；无服务reload，无旧包删除。
5. 两份目录及最终6包均从公开HTTPS完整下载，逐字节匹配本地发布快照。8站HTTP及5个pm2进程PID/online前后一致，mini既有504未变化。锁已释放。
6. 新版宿主全量check + build：3446项，3428通过、18跳过、0失败；发布器9项测试通过。

## 关键限制：0.4.103 尚未支持新版宿主

正式0.4.103仍读 `/plugins/registry.json`（v1），没有该插件分支的v2目录/配置与远程宿主接入。不能把三件套放进v1绕过能力校验，也不能宣称正式版用户已立即看到6项。
需要将插件分支合入最新主线再发布一次宿主。已向用户发送选择卡，尚未收到应用发版确认；本轮不擅自发应用版。

本轮隔离新版宿主启动首次失败：外层sandbox-exec与Chromium嵌套sandbox冲突，原始日志first-ui-launch-failure.txt保留。沿用既有 verifier 的 --no-sandbox 测试启动参数、保留外层文件访问沙箱后进程正常启动，但CUA存在同bundle多Electron副本识别歧义，未完成生产目录的原生UI安装验收，不冒称已通过。只终止本轮可核验PID/路径的验收实例，不影响其他Electron/正式应用/Computer Use服务。

## 文件

- publish-result.txt：三件套release ID 51ae19ca-2eb9-42b0-bd91-6f9de2a10935。
- local-files/publish-result.txt：第二次增量release ID。
- 每次的生产回退文件均位于 `/www/wwwroot/eas/plugins/.release-<ID>/`，不自动删除。
- public-verification.json、local-files/public-verification.json：公开HTTP字节核验，最终以第二份为准。
- local-files/packed-stdio.json：实际三工具读写/保护证据。
- host-check-build.txt / publisher-tests.txt：完整测试与构建输出。
- previous-registry.json / registry.json / v2-registry.json：初轮快照；最终v2在local-files/v2-registry.json。

## 下次构建发布特别注意

`scripts/build-plugin-registry.mjs` 现有默认清单是开发候选集，仍含旧 Excel 1.0.1 且漏 Word，**不能直接将其结果覆盖现生产目录**。本次生产清单通过 `buildPluginRegistries` 只构建获验收三件套，再复用既有生产不可变包，随后仅增量加入本地文件。下一次必须读取生产v2并逐项保留原已发布版本；同版本字节不可变，有变更升版。此次完整发布快照暂存 `/tmp/eas-office-market-20260922/dist`，生产服务器保留所有包；临时目录不是长期源码。

## 其他插件推进

Notion/Sentry已重读官方文档并实际GET授权元数据，候选issuer/授权/token/注册端点与真实值一致，支持none/S256；相关候选打包测试通过，见 `../provider-live-20260922/`。Notion protected-resource实测成功，Sentry根路径404保留原失败，不推断所有发现地址都不存在。未创建客户端身份、未登录用户、未调用账号业务，不将两项未授权候选上架冒充可用。

维基百科仍解析到Clash fake-IP（198.18.1.237），只读网络策略按设计拒绝；不为通过验收放行非公网IP。天气/高德需用户自己的Key；其他原Demo插件继续按统一方法论逐项验收，不以目录占位计数。
