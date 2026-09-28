# 0.4.115 分发记录

## 已完成的官网发布
构建、tag、发布时 origin/main 同为 4b68502f8942ab0baf3d59e7780a227824818b18。Mac 两架构正式签名/公证/实启通过；Windows tag CI 36425319916 同 SHA 成功。五个最终包详见 artifacts.json，三种平台没有混用不同提交产物。

- 五包逐个 SCP 到 /www/wwwroot/eas-dl/v0.4.115/ 临时名，逐个 size/SHA256 一致后转正式名。
- 三个静态网页及 latest.json 先暂存核验与备份；再次 fetch 主线确认后依次切换，latest 最后。
- 备份 /www/wwwroot/eas-release-backups/0.4.115-20260928T131932Z 包含旧114页面和更新清单。
- 官网三个页面全文 hash、latest 版本/URL/说明、五包 HTTP206 Range+总大小及前4096字节均匹配。
- 旧113两个 Mac DMG HTTP200仍可下载。未删除114/113/111旧包，未替换本机正式app。
- 五PM2 PID/status/restarts和七站HTTP200前后一致；没有reload/服务重启。发布后约9.5GiB可用。
- 公网下载页：https://eas.biily.top/download.html

## GitHub
2026-09-28T13:40:30Z 正式公开/latest。五包均 uploaded，GitHub size/digest 与本地及官网服务器 SHA256 全部一致；公開前重新 fetch 确认 origin/main 仍等于 BUILD_SHA。GitHub Release：https://github.com/biily786063474-boop/eas_term/releases/tag/v0.4.115 。没有提前公开仅 Windows 单包的草稿。

## 未覆盖
主程序支持 Jev 新协议不等于独立插件市场已发布0.2.0。真实在线模型/TypeSafe、实体Windows/Intel及一小时长时内存未测；外部Computer Use指针问题仍开放。Mac12+；macOS11继续113，Windows无代码签名提示保留。
