# Eas-Term — 部署目标

## 📦 下次传到哪

| | |
|---|---|
| 服务器 | `39.105.40.173`（个人站，`Host server`）|
| SSH | `ssh server` |
| 网页 | `/www/wwwroot/eas` |
| 安装包 | `/www/wwwroot/eas-dl/v<版本>/`（独立目录，重新部署网页不会清掉）|
| 域名 | `eas.biily.top`（证书 2026-10-26，certbot 自动续期，不用手动管）|
| nginx | **宝塔管** —— `nginx -s reload`，**不要用 `systemctl`**（会打架）|

## 一条命令发布

```
scripts/publish-site.sh
```

它已经走完整套：逐个 `scp` → 逐个核对字节大小 → 传包比 SHA256 → 写 `latest.json`
→ 清理旧版本（`KEEP=5`）→ reload 前后比对现有站点 → 线上自检。**别手搓 scp。**

> **版本排序必须用 `sort -V`** —— 试过 `sort -t. -k1,1n`，遇到 `v1.0.0` 会把它排到 `v0.x` 前面
> （"v1" 被按数值解析成 0），于是最新版本被当成最老的删掉。造了 9 个版本目录实测确认过。

## ⚠️ 这台机器上还有别的生产站

`www.biily.top`（动态站，pm2 跑 node）、`aurora.biily.top`、`mini.biily.top`（反代到家里 Mac mini）。
改配置**只加独立 `.conf`**，reload 前后各测一次现有站点状态码。磁盘只剩 ~19G，传包前先 `df -h`。

## 更多细节

**动手前先读 `~/.claude/servers/INDEX.md`**，需要这台机器的完整清单再读
`~/.claude/servers/39.105.40.173-阿里云.md`。

**部署路径/域名变了，要回去更新 `servers/INDEX.md` 的「服务 ↔ 项目映射」表。**
