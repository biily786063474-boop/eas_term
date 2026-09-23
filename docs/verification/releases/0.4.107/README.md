# Eas-Term 0.4.107 发布验收

产品源码：`cf6d41ca`（包含 Codex 原生任务故障恢复合并 `912aeea8`）。

## 已通过
- 全量 `npm run check`：3606 通过、19 跳过、0 失败；构建通过。
- Windows CI `35866304881`：`build-win` 成功；正式 x64 安装包已取回并记录 SHA256。
- Mac ARM 与 Intel：使用 Node 22 的独立实体依赖安装构建。两架构 Developer ID 签名、Apple 公证/staple、Gatekeeper 均通过。
- 两架构 ZIP/DMG 内的 `app.asar` 与对应验收应用哈希相同，且两架构内容哈希相同。
- ARM 原生与 Intel Rosetta 均以隔离用户目录启动到真实画布，确认显示 `v0.4.107`；截图见 `arm-app.png`、`x64-app.png`。不是实体 Intel Mac 验收。

## 保留的问题和边界
- 首轮复制 `node_modules` 的打包尝试因软链依赖不全废弃；Node 26 的 `npm ci` 在 `electron-rebuild` 依赖兼容性处失败，改用 Node 22 完成正式候选，不将废弃包发布。
- 未做真实在线 Codex 服务的断网/认证故障注入，也未做 Windows 用户机现场验收；不能声称 80% 或彻底消除断线。
- 外部 Computer Use 指针残留问题仍开放；不因这次版本发布视为已修复。

## 分发
五包大小与 SHA256 见 `manifest.json`。官网 `latest.json` 于 2026-09-23T13:57:21Z 切至 0.4.107；GitHub Release 于 2026-09-23T13:57:50Z 公开并设为 Latest，tag `v0.4.107` 指向 `cf4048b1`。公开页面/latest/五包 HEAD+Range 共 9 项核验通过；GitHub 五包 digest 与本地一致。服务器五个 PM2 PID/status 与发布前相同，其他站状态相同；mini.biily.top 本地 curl 000 是发布前既有。没有 reload、没有删除旧包；回退备份 `/www/wwwroot/eas-release-backups/0.4.107-20260923T133908Z`。正式用户应用未替换。
