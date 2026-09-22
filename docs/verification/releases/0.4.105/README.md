# 0.4.105 发布验收

- 源码 ade2fe5；插件市场卡片固定 96px，标题、简介、状态槽对齐，详情浮层不挤动布局。
- npm run check：3498 通过、18 跳过、0 失败；生产依赖审计 0 漏洞。
- Mac ARM/Intel 签名、公证、staple、Gatekeeper、ZIP/DMG 与应用哈希核验通过。
- ARM 正式包真实 UI 验证卡片等高、详情；Intel 在 Rosetta 下验证市场和原生 PTY，并非实体 Intel 验收。截图随附。
- Windows CI 35732994971 全流程成功。
- 正式用户应用未替换；隔离候选实例已退出。
- 外部 Computer Use 指针生命周期仍为已知问题；不宣称全部 32 项插件完成真实账号验收。

发布状态以 live-verified.json 和 github-published.json 为准。

## 2026-09-22 0.4.105 发布完成
产品 ade2fe5，发布tag cb3fac5。官网与 GitHub 2026-09-22T13:54:28Z 已公开/latest，Mac ARM/Intel 的 DMG/ZIP 和 Windows EXE 共五包，size/SHA256 与本地一致。卡片等高修复已包含，3498测试通过、18跳过、0失败；双Mac公证/归档核验，ARM/Rosetta真实市场UI及x64原生PTY、Windows CI35732994971通过。正式用户应用未替换，隔离测试实例已退出；非实体Intel验收。生产8站/5PM2前后无变化，未重启/删旧包。Computer Use指针生命周期仍未解决，32插件并非全部真实账号验收。完整证据 docs/verification/releases/0.4.105/。
