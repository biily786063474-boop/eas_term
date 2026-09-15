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

## 待办（需构建产物 + 生产/真机）

- [ ] 真机 CDP：装一个插件走完 install→权限确认→commit→发现区标「已安装」→卸载。
      做法：本地起静态服务托 `dist/plugins`，`EAS_PLUGIN_REGISTRY_URL` 指过去（避免动生产），
      隔离实例开插入选择器「插件」tab 验证。截图放本目录。
- [ ] 发布到官方目录：`bash scripts/publish-plugins.sh`（逐个 scp + 字节/SHA256 核对 + 线上自检）。
      **对外操作，发前确认。** 只往 `/www/wwwroot/eas/plugins/` 加文件，不碰站点其它内容、不 reload nginx。
