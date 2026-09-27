# 0.4.113 分发完成（2026-09-27）

## 双渠道完成
- 官网 https://eas.biily.top/download.html 和自动更新 `/download/latest.json` 已切换 **0.4.113**。
- GitHub Release v0.4.113 已公开 Latest，五包大小/digest 与本地和官网服务端 SHA256 一致。
- 构建/tag `9cb85bb3002b872262d723e32094724e2d94a9dd`；Windows tag CI `36312457524` success。上传前、切换前和收尾均 fetch 核实主线只追加发布记录，源码树一致，没有漏入业务提交。
- 逐文件 SCP 临时名→大小/hash→转正；全部页面和清单 stage 验证后，三个网页先切、latest 最后切。公开四文件哈希、五包 HEAD/Range206 通过。
- 五 PM2 服务 PID/status/restarts 和六站 HTTP 前后一致；没有 reload/重启，也未替换本机正式应用。

## 用户授权清理结果
- 官网只保留 **0.4.113 新版 + 0.4.111 上一正式版**，111 五包收尾重新校验不变。
- 删除 0.4.100–110 的 55 个精确旧包，共 **12,085,641,258 B（12.09 GB）**；只 rmdir 已空的对应目录，没有触碰其他软件、插件、依赖、页面备份。
- 删除前55包均核验本机归档，51包另有GitHub镜像核验。100缺失的4个Mac镜像已补齐；101的4个Mac镜像上传中断，用户明确“直接删吧”，因此不再等待镜像，按授权删除官网旧包。本地101五包仍保留；没有删除或改写GitHub历史版本、tag。
- 本机归档 `/Users/biily/Downloads/Eas-Term-server-old-archive-20260927`，55 包及逐版 manifest；最终再次核验55包全一致。没有称作家庭云归档。
- 最终服务器可用 **12,532,543,488 B（12.53 GB）**。旧官网直链已按授权移除，历史镜像仍在 GitHub。

## 回退与证据
- 上线前官网三页/latest 备份：`/www/wwwroot/eas-release-backups/0.4.113-20260927T125836Z`。
- 111 安装包 `/www/wwwroot/eas-dl/v0.4.111/` 保留；112 只是未公开候选，不作为上一正式版。
- `server-publish.json`、`official-public-verification.json`、`cleanup-summary.json`、逐版 cleanup 和 backfill JSON。
- `official-latest-unchanged.json`、`old-package-inventory.json` 为上线前历史快照，不能当作当前状态。
- 已知限制仍见 README/security-review：真实16GB及在线模型未本轮验收，Computer Use生命周期仍开放，存量安全告警未消除。
