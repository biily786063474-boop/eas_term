# 0.4.110 分发核对

- 源码提交、tag peeled commit、Mac 双架构包、Windows tag Actions `36230546262` 都对应 `692f679d`。五包先逐个 SCP 到 `/www/wwwroot/eas-dl/v0.4.110/`，各以临时名上传、服务端 SHA256 核对后转正。Windows 初次使用 main CI 的同提交 EXE，但 tag CI 二进制哈希不同；公开前已替换为 tag CI EXE，服务器/GitHub/本地最终哈希一致。**不是复用 main CI 的 EXE 冒充 tag 包。**
- GitHub Release 曾被现有 tag 工作流在 Windows 单包上传时自动短暂公开；发现后立即改回草稿，验证 GitHub Latest 与官网 `latest.json` 仍指向 0.4.109。待五包完整并逐项校验后，正式公开为 `v0.4.110` Latest。该流程竞态应在下版前修正；不能以「始终保持草稿」描述本次过程。
- 官网三个页面与 `latest.json` 先传 `.staged` 并逐个 SHA256 核对；旧文件备份至 `/www/wwwroot/eas-release-backups/0.4.110-20260926T090230Z`。三个页面原子替换后，`latest.json` **最后**原子切换。
- 公网三页和 `latest.json` 字节哈希与本地一致；五包 Range 请求均为 `206/1024`，五包服务器 SHA256 与 GitHub asset digest、本地包相同。GitHub Release 已公开/latest，五个资产齐全。
- 服务器五个 PM2 进程的 PID、状态、重启计数前后完全一致；eas/www/aurora/rove/bzone/spb 六站本地 HTTPS 均为 200。未 reload、未重启、未删除旧版本。旧 0.4.109 和 `.pre-tag-1829` 候选副本保留。发布后剩余磁盘 `1,556,217,856` 字节（约 1.5 GB，97% 使用率），**下一次发版前需先按授权归档/清理；本次没有擅自删除。**
- 未替换用户当前安装版。回退：把备份目录中三个网页及 `latest.json` 按同样临时文件/校验/原子方式恢复，安装包继续使用已保留的 0.4.109；GitHub Release 可改回 0.4.109 Latest。
