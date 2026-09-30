# 插件市场发布 · 2026-09-30（Jev 0.2.0 + 本地文件 1.0.1 + 目录图标）

- 发布 ID：`b6eb1a49-8e8a-449a-b540-7be2baa77dfa`
- 发布器：main `5c6dcb0a` 的 `scripts/publish-plugins.sh --publish`，`EAS_PLUGIN_OUT_ROOT` 指向定稿候选
  （`/tmp/eas-plugin-publishcheck-20260929/candidate`，未重建）。结果：packages 8，uploadedPackages 2（`publish-result.txt`）。
- 用户批准：接受 v1 变化；jev 0.2.0 详情按草稿原样使用（`jev-0.2.0-detail.json`）；先合 main 再发。

## 改了什么

| 项 | 发布前 | 发布后 |
|---|---|---|
| jev | 0.1.2 | **0.2.0**：26816 B，`8b1e72bb96b3bf912bb73516860031622faed726ab1e2b27dd22809b0e8655df` |
| local-files | 1.0.0 | **1.0.1**：11204 B，`1b2ffff1d533fd7988a194d5bb7583b59e6a62dca8db03a24e23ab1ed75b0a09`（只多了图标和 brandColor） |
| pomodoro / board / timeline | — | 目录条目加 `iconDataUrl`，包不重打，url/size/sha256 不变 |
| excel 1.1.0 / word 1.0.0 / powerpoint 1.0.1 | — | 完全不变 |
| v2 目录 | 9488 B `62ea51f7…2d32` | 19731 B `70d95f17b09d79f5afbf7d8c4d510fb2b3cca509278fb6e658b9bb68db3ed2dd` |
| v1 目录 | 1221 B `837ea231…0b99` | 2303 B `9b2fe0e40271aac2a003e4fed2c2a59eb2392e013f10788681f709cf9d775aee` |

- **v1 会变**，原因是发布器要求 v1 的条目和 v2 里不带 requirements 的条目深度相等。
  pomodoro/board 在 v2 里有了图标，v1 也必须带上，否则发布器在上传前就会拒绝，这一点本地演练时验证过。
  ≤0.4.103 的解析器会忽略这个字段，实测解析通过、0 警告。
- 发布前后的完整目录都在本目录：`previous-*.json` 是发布前，`registry.json` / `v2-registry.json` 是发布后。

## 核对

- **本地演练**：生产适配器的 POSIX 命令实际执行，目标是 /tmp 里的线上镜像。
  只上传了 2 个新包，6 个旧 zip 字节不变，两份目录落地后与候选一致，锁已释放。
- **公网 HTTPS**（`public-verification.txt`）：两份目录与候选逐字节一致；8 个包逐个核对大小和 SHA256，全部通过。
- **服务器**：没有残留的 `.publish-lock`；两个新包权限 644；旧包全部保留（jev 0.1.0/0.1.1/0.1.2、timeline 1.0.0、local-files 1.0.0）。
  回退文件在 `.release-b6eb1a49…/previous-registry.json` 和 `previous-v2-registry.json`，
  两者的 sha 等于发布前的 `837ea231…` 和 `62ea51f7…`。
- **发布前后对比**（`before.txt` / `after.txt`）：
  - 5 个 PM2 服务（biily、bizone-cms、survey、spb-cms、eas-tunnel）的 PID、状态、重启次数完全一致；
  - eas / www / aurora / rove / bzone / spb 前后都是 301；
  - 磁盘可用前后都是 11G；
  - 没有 reload、重启或删除任何文件。

## 隔离实例验收（main 5c6dcb0a 构建）

环境：sandbox-exec；环境变量和进程内的 HOME 都换成临时目录；独立 user-data-dir 和 CDP 端口；
`EAS_PLUGIN_REGISTRY_URL` 指向本地 HTTP 服务上的候选目录；包下载地址 `https://eas.biily.top/plugins/*`
被重定向到同一个本地服务（做法和 `scripts/verify-jev-market.mjs` 相同）。点击都是真实鼠标事件（CDP Input）。

- 市场列出 8 项。Jev 判断台显示 v0.2.0、新版详情和 logo；本地文件显示 v1.0.1 和图标（`screens/`）。
- 两个插件都走完两段式安装：详情页 →「安装插件」→ 权限确认 →「确认安装」。点确认之前没有写任何文件。
  装到临时 HOME 后的版本分别是 0.2.0 和 1.0.1。
- 用户认定的结论原文：**"install flow passed; without a key the Jev panel correctly opens settings by design"**。
  - 没有密钥时点 Jev，按设计先打开设置页，面板本体没有打开。
  - 隔离环境下系统加密不可用（界面提示「系统加密不可用」），所以连测试密钥也存不进去。
  - 本地文件没有声明面板。
- 实例和本地服务用完已关闭。

## 未验证与边界

- 正式版 0.4.119 会丢掉 `iconDataUrl`，这些图标要等宿主新版发出去才看得到。
- 0.4.104–0.4.114 安装或更新 Jev 0.2.0 会被拒，提示缺少宿主能力 `jev.decisions.v2`（0.4.115 起才有）。
  这些版本已经装着的 0.1.x 仍可用。
- 以下没有验证：Jev 面板本体、真实 TypeSafe 调用、Windows 客户端、正式版 app 从生产市场点「更新」。
