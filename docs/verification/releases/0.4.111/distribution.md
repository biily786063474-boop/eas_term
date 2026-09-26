# 0.4.111 分发核对

- 默认最新主线 `ee1eeed01b16d8949876092ea38a1d1e9be02c01`；`v0.4.111^{}` 与此一致，公开前再次 fetch 确认 `origin/main` 相同。Mac 双架构与 Windows tag CI `36246848230` 为同源码提交；Windows main CI `36246306277` 也成功，但最终采用 tag CI EXE。
- 旧 0.4.109 `.pre-tag-1829` 五个候选文件在用户授权后逐个下载本机归档，和服务器 SHA256 逐项一致后仅按精确文件名清理；正式包均保留。家庭云离线，归档暂在 `~/Downloads/Eas-Term-0.4.109-pre-tag-1829-archive/`，尚未异地保存。
- 五包逐个 SCP 到 `/www/wwwroot/eas-dl/v0.4.111/`，临时名上传、服务端 SHA256 校验后转正；与本地 `artifacts.json` 一致。GitHub Release tag CI 初始仅 Windows EXE 且保持 draft；上传四个 Mac 包、五包 digest/size 均核对后才公开并设 Latest。最终 `github-assets-final.json` 显示五包且非 draft。
- 官网三页和 `latest.json` 逐个上传 `.staged-04111` 并比对 SHA256；旧文件备份在 `/www/wwwroot/eas-release-backups/0.4.111-20260926T141839Z`。三页替换后最后切 `eas-dl/latest.json`；公网三页及 latest 内容哈希与本地一致，五包 Range 请求均 `206/1024`。
- 发布前后五个 PM2 服务 PID、状态、重启计数完全一致；eas/www/aurora/rove/bzone/spb 六站均 200；没有 reload/restart，没有删除其他旧版。服务器剩余 1,553,846,272 字节（约 1.55 GB）；下版需先规划空间。
- 回退：使用上述备份目录内三个网页和 `latest.json` 做临时名/哈希核对后原子恢复；保留旧 0.4.110 安装包与 GitHub Release。未替换本机 `/Applications/Eas-Term.app`。
