# 0.4.109 分发核对（2026-09-25）

- 最终 Mac 双架构安装包与 Windows Actions `36118636770` 均由 tag `v0.4.109` 的提交 `1829e691` 构建。先前产品候选 `09caa6da` 的包已被 tag 构建包替换，产品代码未变；旧候选包保留为服务器回退文件。
- 五包逐个 SCP 到 `/www/wwwroot/eas-dl/v0.4.109/`，逐个 SHA256 核对；其后以 tag 本身重构建的五包再次逐个 SCP、SHA256 校验并原子替换，前一批候选包在原目录以 `.pre-tag-1829` 后缀保留。官网三份 HTML 与 `latest.json` 采用临时文件原子切换，`latest.json` 最后发布。旧网页/latest 备份后缀 `20260925T090737Z`；旧安装包保留。
- 公网首页、下载页、更新日志、`latest.json` 返回 200，三份网页内容与本地文件完全一致；五包 Range 请求返回 206/1024 字节。公网 latest 版本为 0.4.109。
- 发布前后及二次替换后五个 PM2 服务 PID/status/restart 完全一致；eas/www/aurora/rove/bzone/spb 六站本地 Host HTTP 状态均为 301。未 reload、未重启、未删除生产旧版本。最终服务器剩余约 2.5GB；五个初始候选包以 `.pre-tag-1829` 保留，下一次发版前须规划安全归档。
- GitHub Release `v0.4.109` 于 `2026-09-25T09:26:02Z` 公开/latest；最终 tag 构建五包的 size/digest 与本地逐项一致，详情见 `github-assets.json`。

## 已知边界

- x64 Mac 仅以 Rosetta 验证，未验实体 Intel；Windows CI 与打包冒烟通过，未验真实用户设备。
- 外部 Computer Use 指针残留仍开放，本版不宣称已修复。
