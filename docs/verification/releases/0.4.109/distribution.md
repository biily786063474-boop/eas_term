# 0.4.109 分发核对（2026-09-25）

- 产品源码 `09caa6da`；发布说明/网页提交与 tag `v0.4.109` 指向 `1829e691`，不改变应用产品代码。Mac 双架构安装包与 Windows Actions `36114498097` 均由同一产品源码构建。
- 五包逐个 SCP 到 `/www/wwwroot/eas-dl/v0.4.109/`，逐个 SHA256 核对；官网三份 HTML 与 `latest.json` 采用临时文件原子切换，`latest.json` 最后发布。旧网页/latest 备份后缀 `20260925T090737Z`；旧安装包保留。
- 公网首页、下载页、更新日志、`latest.json` 返回 200，三份网页内容与本地文件完全一致；五包 Range 请求返回 206/1024 字节。公网 latest 版本为 0.4.109。
- 发布前后五个 PM2 服务 PID/status/restart 完全一致；eas/www/aurora/rove/bzone/spb 六站本地 Host HTTP 状态均为 301。未 reload、未重启、未删除生产旧版本。服务器发布后剩余 3.6GB。
- GitHub Release `v0.4.109` 于 `2026-09-25T09:26:02Z` 公开/latest，五个 asset 的 size/digest 与本地包全部一致。

## 已知边界

- x64 Mac 仅以 Rosetta 验证，未验实体 Intel；Windows CI 与打包冒烟通过，未验真实用户设备。
- 外部 Computer Use 指针残留仍开放，本版不宣称已修复。
