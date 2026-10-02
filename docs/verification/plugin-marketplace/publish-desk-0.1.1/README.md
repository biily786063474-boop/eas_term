# 插件市场发布 · 2026-10-02（发布台 0.1.0 → 0.1.1）

- 发布 ID：`9aad0031-729a-4480-aae1-2ff79397c9dc`；packages 9，uploadedPackages 1（`publish-result.txt`）。
- 发布器：main `d8ac40ff` 的 `scripts/publish-plugins.sh --publish`，`EAS_PLUGIN_OUT_ROOT=/tmp/pd-candidate-0.1.1`。
- 用户要求：「插件改好了的话推插件市场」。

## 0.1.1 改了什么
- 面板跟随数据文件刷新：不管谁写的（没接好发布台的会话、外部脚本），已开的面板都会自动出现内容、切到新批次（`lib/watch.mjs`）。
- 版式参照 Synth Core：统计条、模块化卡片网格、2px 圆角、等宽标签；强调色按项目规则不用蓝。
- 平台卡片带平台标志（Simple Icons 16.33.0，CC0；LinkedIn / 视频号为字母块，见 `ui/ICONS-NOTICE.md`）。
- 清单：`minHostVersion 0.4.120`、分类「自媒体」（0.1.0 上架时改在 `docs/plugin-publish-desk-20261001` 分支，本次一并合入 main）。

## 候选怎么来的
线上 v1 / v2 两份目录与 9 个包原样拉下，逐个核对大小和 SHA256 全部一致，只把 publish-desk 条目换成 0.1.1（`detail` 沿用 0.1.0 的），其余 8 项深度相等，v1 不变（发布台带 requirements，只进 v2）。0.1.1 包 49413 B，`1b58a3a15fe1509459773020df6e428463d8ea46b268f86b54fba2571feec0ab`，两次打包字节一致。

## 核对
- 隔离客户端（发布前，对候选目录，`scripts/verify-publish-desk-market.mjs`）：6 项全过，见本目录 `main-result.json` 与截图。0.4.119 拦截未重跑：requirements 与 0.1.0 相同，宿主判定未改。
- 公网 HTTPS：两份目录与候选逐字节一致；9 个包大小与 SHA256 全部一致。
- 服务器：5 个 PM2 服务 PID / 状态 / 重启数与七个站点状态前后一致（`before.txt` / `after.txt`）；无残留 `.publish-lock`；新包 644；0.1.0 旧包保留；没有 reload、重启或删除文件。
- 回退：服务器 `.release-9aad0031…/previous-v2-registry.json`（本目录同名副本即发布前线上 v2）。

## 未验证
没有用正式签名安装包直连生产市场点安装 / 更新；Windows 客户端未验证。
