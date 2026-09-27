# 0.4.114 分发结果

- 官网首页、下载页、更新日志及 `/download/latest.json` 已发布114。五包逐文件scp，逐个size/SHA256校验成功；网页后latest最后切换。
- GitHub Release v0.4.114 已由草稿转正式并设 latest；五资产状态 uploaded，size/digest 与本地和官网逐一一致，见 github-assets-final.json。
- 源码链：最新业务main d840885b → BUILD_SHA 527b0bc17413143721297ae6feb6acf1d5e1c56d → tag v0.4.114 → Windows tag run36349081488成功 → Mac双架构签名公证包 → 两渠道114。发布前两次fetch主线核对无漏纳入产品提交。
- 官网公开页面hash、latest及五包Range返回206/长度/前4096字节通过；113 ARM/Intel下载入口仍200。GitHub公开下载验证见github-public-downloads.json。
- 生产5个服务PID/状态/重启数未变、7站健康一致；无reload、无重启、无删除旧包。余量11G。
- 回退：`/www/wwwroot/eas-release-backups/0.4.114-20260927T210343Z` 保存上版三网页和latest；113/111安装包保留。本次没有执行回退。
- 未替换用户当前安装版；macOS11用户不要安装114，保持113。Computer Use、实体Intel/Windows现场、真实挂机一小时/多显示器/付费模型边界见README。
