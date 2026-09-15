# 插件市场第一步 · 验收

设计稿：[`docs/superpowers/specs/2026-09-15-插件市场-第一步-design.md`](../../superpowers/specs/2026-09-15-插件市场-第一步-design.md)

## 已验（纯逻辑 + 贯通，`node --test`，零 electron）

| 面 | 测试文件 | 钉住的东西 |
|---|---|---|
| 目录校验 | `src/main/pluginRegistry.test.ts` | url 必须 https+官方域名、sha256/semver/size 格式、坏条目丢弃记 warning、整份格式错才拒 |
| 安装安全 | `src/main/pluginInstall.test.ts` | 写边界只许 `~/.eas/plugins/<name>/`、zip-slip 路径穿越拒、sha256 强制 |
| 确认闸门 | `src/main/pluginInstallGate.test.ts` | 一次性 token、30s 过期、sweep 清临时目录 |
| 解压 | `src/main/pluginUnzip.test.ts` | 正常包落地、条目数/解压总字节超限拒整包 |
| **打包→客户端安装链贯通** | `src/main/pluginMarketChain.test.ts` | board 现打成 zip，再走 `parseRegistry → verifySha256 → extractZip → parseManifest → 权限核对` 全程通；篡改一字节被 sha256 挡下 |

`pluginMarketChain.test.ts` 抓到并修掉一个真 bug：staging 解压到随机名目录会让 `parseManifest`
的「name 必须等于目录名」检查失败 —— **装任何插件都会被拒**。现改成解到内层 `<随机>/<name>/`。

`npm run typecheck`、CSS 平衡/动画/对比度检查均绿。

## 产物

- `node scripts/build-plugin-registry.mjs` → `dist/plugins/registry.json` + `dist/plugins/board/board-1.0.0.zip`
- 首批目录只收 `board`（自包含、跨平台、带 panel+mcp 的样板）。
  `computer` 依赖 macOS 专用二进制 `bin/eas-windows`（构建产物），跨平台一键装需分平台打包，留第二步；
  收录开源 MCP server（工具型）是策展步骤，同样后置。往 `build-plugin-registry.mjs` 的 `PLUGINS` 加目录即可扩充。

## 已发布（2026-09-15）

`bash scripts/publish-plugins.sh` → `eas.biily.top/plugins/`：`registry.json`(620B) + `board/board-1.0.0.zip`(7344B)。
线上 zip 的 sha256 与 registry 声明逐字节一致；六站发布前后全 301 未变；纯新增，未碰 nginx/pm2。
详见服务器档案 `~/.claude/servers/39.105.40.173-阿里云.md` 的 2026-09-15 变更记录。

## 真机 CDP 已验（2026-09-15，对着线上生产服务器）

隔离实例（`verify-app.mjs`，CDP 9333）里走完整条链，**registry 指向真实 `eas.biily.top`**，不碰安全绕过：

- `plugins.registry()` → 从线上拉到目录，`看板` 正确解码（客户端按 UTF-8 读，印证浏览器里的乱码只是 nginx Content-Type 缺 charset 的显示问题）。
- `plugins.install('board')` → 下载线上 zip、sha256 校验、解压、`parseManifest` 全过，返回权限 `[canvas_open_file]` + 一次性 token。
- `plugins.installCommit(token)` → 原子落盘到 `~/.eas/plugins/board/`（plugin.json + server.mjs + ui/ 全）。
- `plugins.list()` → board 作为用户装的自家插件出现（builtin:false、带面板）。
- UI：插入选择器「插件」tab 的「发现」区渲染出 board 卡片（品牌色点 + 看板 + Productivity + 描述）。截图 `discover-card.png`。
- 验后 `uninstall('board')` 清回，真实 home 干净。

**权限确认弹窗**：`install()` 返回权限、`installCommit` 落盘这条两段式在 IPC 层已验；但**弹窗的 UI 截图没截到**——因为 board 是内置样板（见下），卡片显示「内置」而非「安装」，点不出弹窗。弹窗组件只是渲染 `install()` 返回的权限，逻辑已通。

## 内置插件在市场里只显示「内置」（已解决）

board 同时是**内置样板**（`resources/plugins/board`）→ UI 的「已装」判定认 `cli:'eas'` 插件（含内置），
所以 board 卡片显示「内置」徽标、没有「安装」按钮——一键安装那条路用 board 演示不出来。

**解决**：新增 `pomodoro`（番茄钟，`plugins-store/pomodoro`，**非内置**）进 registry。
现在市场里 board 显示「内置」、pomodoro 显示「安装」，一键装的用户路径能真的走通。
往后市场丰不丰富取决于收录多少非内置插件（`build-plugin-registry.mjs` 的 `PLUGINS` 里加）。

## 番茄钟（pomodoro）真机全链验（2026-09-15，对着线上）

隔离实例里走完整个用户路径，全过：

1. 「发现」区看到 `番茄钟` 卡片（红点 + Productivity + 描述 + 「安装」按钮）——从线上 registry 拉取。
2. 点「安装」→ 主进程下载线上 zip、校验 sha256、解压临时、`parseManifest`，弹**权限确认框**：
   「装上后它可以：**在画布上贴便签**」。截图 `install-permission.png`。
3. 点「确认安装」→ `installCommit` 原子落盘到 `~/.eas/plugins/pomodoro/`，`list()` 里 builtin:false、带面板。
4. 「已装」里点它 → 面板作为画布节点开出（`eas-plugin://` OOPIF iframe，pluginHost spawn 了 server.mjs），
   渲染出倒计时环 `25:00` + 专注/休息按钮 + 「记到画布」。截图 `pomodoro-panel.png`——**插件真能跑**。
5. 验后卸载清回，真实 home 干净。

`pluginMarketChain.test.ts` 现在把 board + pomodoro 两个都过一遍打包→安装链（CI 回归）。

## 截图

- `install-permission.png` —— 番茄钟卡片「安装」+ 权限确认框（在画布上贴便签）
- `pomodoro-panel.png` —— 装好后打开的番茄钟面板（25:00 倒计时环，真能跑）
- `discover-tab.png` / `discover-card.png` —— 早期 board 卡片渲染
