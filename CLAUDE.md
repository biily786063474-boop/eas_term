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

## 🎨 营销站接了 SPB 共享设计系统（2026-08-04）

站点骨架（背景点阵动效 / 字体 / 字阶 / 间距节奏 / 滚动叠层）改为**从别的仓库分发过来**，
本站只保留自己的品牌色与材质（液态玻璃）。

| | |
|---|---|
| 源头（**改这里**）| `~/Biily/独立站/design-system/` |
| 本项目里的落点（**分发产物，别手改**）| `site/vendor/spb-design/`（35 个文件 1.4M）|
| 更新方式 | `node ~/Biily/独立站/scripts/sync-design-system.mjs --only eas` |
| 线上 | `/www/wwwroot/eas/vendor/spb-design/` |

**直接编辑 `site/vendor/spb-design/` 没有意义 —— 下次分发会原样覆盖。**
要改骨架去独立站的 `design-system/` 改，再分发回来。

两条接入约定（改样式时容易踩）：

- 本站 `:root` 定义 `--brand: #a2b9e0`，背景动效读它染色；点阵静止色读 `--ambient-dot`
- **底色必须挂 `html`、`body` 设 `transparent`** —— 背景画布是 `z-index:-1`，
  body 有底色会把它整个盖住；而「给每个子元素设 z-index」绕开会覆盖掉固定导航的 `position:fixed`

`scripts/publish-site.sh` 已补上 `vendor/` 的传输与逐文件核对。
**改传输清单时别把它删了** —— 漏传的症状是 HTML 正常、脚本全绿，
只有真打开页面才看得出 CSS 和字体全 404。
字体是**按本站实际用字现场生成的子集**（727 字），不与其他站共用：
共用会让大部分汉字 fallback 到苹方，而苹方没有 900 字重，页面会一半思源一半苹方。

## 📱 手机端隧道（2026-08-30 新增）

手机在**外面**（4G / 别的 Wi-Fi）连你电脑时走的那条道。同一个 Wi-Fi 时不走它。

| | |
|---|---|
| 服务端代码 | `src/tunnel/`（`hub.ts` + `main.ts`，打包成单文件部署）|
| 线上 | `eas.biily.top:8443`，**pm2 `eas-tunnel`**，`/opt/eas-tunnel/hub.mjs` |
| 发布 | `bash scripts/publish-tunnel.sh` |
| 证书 | **复用 `eas.biily.top` 那张**，进程每小时看 mtime 自己换（**没动 certbot**）|

**不经过 nginx** —— 它自己监听 8443，所以部署时不碰任何站点配置。

> ⛔ **8443 需要在阿里云安全组放行**（部署当天还没放行）。
> 判据：服务器上 `127.0.0.1:8443` 通、`39.105.40.173:8443` 不通、`:443` 通、
> firewalld inactive —— 主机侧没问题，是云上的入站规则。

**红线：隧道服务器绝不终止那条 TLS。** 手机到用户电脑之间是一条完整的 TLS
（手机钉死电脑的公钥指纹），隧道只搬字节，两头都不是它的终点。
它读不到内容不是因为承诺了不读，是手里没有那把钥匙。
`src/tunnel/hub.test.ts` 里有条测试专门钉这个：断言手机拿到的证书指纹
等于电脑自己那张 —— hub 若在中间解开又重新加密，这条当场就红。

## ⚠️ 这台机器上还有别的生产站

`www.biily.top`（动态站，pm2 跑 node）、`aurora.biily.top`、`mini.biily.top`（反代到家里 Mac mini），
以及 **2026-08-04 新来的两个：`spb.biily.top`（独立站集合入口）和 `bzone.biily.top`
（笔纵官网，从 8.130 迁来，带 pm2 `bizone-cms`:4001 与 `survey`:3721）**。
改配置**只加独立 `.conf`**，reload 前后各测一次现有站点状态码。磁盘只剩 ~19G，传包前先 `df -h`。

> `publish-site.sh` 的 `OTHER_SITES` 已经覆盖全部五个：`www` / `aurora` / `rove` / `bzone` / `spb`
> —— reload 前后各测一次它们的状态码，不一致就中止。`bzone` 背后还挂着两个 pm2 服务，
> 它在名单里尤其要紧。

## 更多细节

**动手前先读 `~/.claude/servers/INDEX.md`**，需要这台机器的完整清单再读
`~/.claude/servers/39.105.40.173-阿里云.md`。

**部署路径/域名变了，要回去更新 `servers/INDEX.md` 的「服务 ↔ 项目映射」表。**
