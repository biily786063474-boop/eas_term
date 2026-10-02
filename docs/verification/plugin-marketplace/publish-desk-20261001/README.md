# 插件市场发布 · 2026-10-01（发布台 0.1.0 上架）

- 发布 ID：`5695ecb3-05e7-4e56-9f8c-595536fa2779`
- 发布器：main `a4c316d8` 的 `scripts/publish-plugins.sh --publish`，`EAS_PLUGIN_OUT_ROOT=/tmp/pd-candidate`。
  结果：packages 9，uploadedPackages 1（`publish-result.txt`）。
- 用户要求：「我希望发布到线上的市场」。

## 改了什么

| 项 | 发布前 | 发布后 |
|---|---|---|
| publish-desk | 无 | **0.1.0**：38938 B，`f59bbc8a641f7de027a380f689b984d656bac56a185fe390a2d13c7e9cd3ed63` |
| 其余 8 项 | — | 条目深度相等，包字节不变 |
| v2 目录 | 19731 B `70d95f17…d2dd` | 24415 B `ed42d76f4abaaf388a8c4cd6cd0462f9eab655b079b5d416b0412e5e425cdeda` |
| v1 目录 | 2303 B `9b2fe0e4…` | 字节不变（发布台带 requirements，只进 v2） |

候选的做法：把线上两份目录和 8 个包原样拉下来，逐个核对 SHA256，再追加发布台一项。没有用 `build-plugin-registry.mjs` 重建，因为它的默认清单和线上不一致，会丢掉时间线、Jev 等。

发布台清单这次改了两处（同一提交里也改了 `resources/plugins/publish-desk/plugin.json`，让下一版的内置副本和市场一致）：
- `requirements: { minHostVersion: "0.4.120", capabilities: ["mcp.stdio"] }`。面板的「一键复制」走 `panel/clipboard.write`，这个宿主接口 0.4.120 才有；不写这一条，旧版会装上一个复制按钮失灵的副本。
- `category` 从 `Productivity` 改成 `自媒体`，在市场里归到「自媒体」分类。
- 详情文案（`detail`）和 Jev 一样只写进 v2 目录条目，内容依据 `server.mjs` 里 `tools/list` 列出的 8 个工具，以及 `store.mjs` 的存储说明。

## 核对

- **公网 HTTPS**（`public-verification.txt`）：两份目录与候选逐字节一致；9 个包逐个核对大小和 SHA256，全部通过。
- **服务器**（`before.txt` / `after.txt`）：
  - 5 个 PM2 服务的 PID、状态、重启次数完全一致；
  - eas / www / aurora / rove / bzone / spb 前后都是 301；
  - 磁盘可用前后都是 9.5G；
  - 没有残留的 `.publish-lock`；
  - 新包权限 644；
  - 没有 reload、重启或删除任何文件。
- **回退**：`.release-5695ecb3…/previous-registry.json` 和 `previous-v2-registry.json`，就是发布前的线上目录（本目录有同名副本）。

## 隔离客户端验收（发布前，对候选目录）

脚本：`scripts/verify-publish-desk-market.mjs`。环境：sandbox-exec 拒绝 `~/.claude` `~/.codex` `~/.eas` `~/.dsh`；插件装进临时 HOME；`eas.biily.top/plugins/*` 重定向到本地服务上的候选目录。点击都是真实鼠标事件（CDP Input）。

- **主线构建（a4c316d8 + 本次清单改动）**，6 项通过：
  - 市场列出 9 项；
  - 发布台显示「已安装 v0.1.0 · 内置副本」；
  - 详情页有场景、步骤和工具说明；
  - 「安装独立版」走完两段式安装，点确认之前没有写文件；
  - 独立版装进临时 HOME，版本 0.1.0，带最低版本要求；
  - 安装包从市场地址下载。
  装上后界面提示「当前使用用户安装副本，覆盖同名内置副本」。
- **0.4.119 构建**：点「安装插件」后提示「需要软件 0.4.120 或更高版本」，没有写任何文件。

**测量陷阱**：用脚本启动 Electron 时，`app.getVersion()` 返回的是 Electron 自己的版本号（37.x），任何 `minHostVersion` 检查都会放行，第一次跑就因此在 0.4.119 上「装成功」了。验收脚本现在用应用目录下 `package.json` 的版本号替换它，模拟正式包的行为。其他用同样方式启动的验收脚本（如 `verify-jev-market.mjs`、`verify-plugin-onboarding.mjs`）没有处理这一点，它们在 `minHostVersion` 上得出的结论都不算数；`capabilities` 的检查不受这个问题影响。

## 未验证与边界

- 没有用正式签名的 0.4.120 安装包直连生产市场点安装。公网字节和候选一致，可以视为等价，但没有实测。
- Windows 客户端没有验证。
- 0.4.120 及以后的版本自带发布台，市场里那份是可以单独更新的副本；0.4.119 及更早的版本会看到「需要软件 0.4.120 或更高版本」。
