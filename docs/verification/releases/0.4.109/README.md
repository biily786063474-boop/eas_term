# Eas-Term 0.4.109 发布验收（2026-09-25）

产品候选源码 `09caa6da`（基于最新 `main`，包含 Frame 菜单、时间线原问题、灵动岛预览修正）。发布页面及本文档不改变应用产品代码。外部 Computer Use 指针残留仍开放，本版不宣称修复。

## 本地和 CI 已验证

- `npm run check`：3710 项，3691 通过、19 跳过、0 失败；`npm run build` 通过。
- Windows Actions `36114498097`：源码 SHA `09caa6da21386bbfae6a005af2f28dc20ad67717`，completed/success；安装包已取回本地。
- Mac arm64 / x64：Developer ID 签名与 Apple 公证、stapler 和 Gatekeeper 均通过。两架构 `app.asar` SHA256 同为 `abf8606e5d52c53b267da14821c9c23dd3115adeb1ea98f49df58cab1c6b6a7a`。
- ZIP、DMG 内两架构 App 均通过 stapler、Gatekeeper，`app.asar` 与候选 App 同 SHA256。
- 双架构打包 App 的 CDP 冒烟：界面、preload、PTY、IPC、代码图谱、OMP、JS 错误检查通过；x64 为 Rosetta，非实体 Intel。
- Frame 右键菜单此前已在隔离应用的亮/暗主题下逐项验证，证据见 `docs/verification/frame-context-menu/`。

## 安装包 SHA256

- arm64 DMG: `e2debc5f0584d4d0219afde0cf11f777dfc741843db527a463a51bb046197d45`
- arm64 ZIP: `eac0ee4c42efaf3ad2fbf5b6bb146b74843fc18ba43d86210325e9ec8fa6de25`
- x64 DMG: `533f512e582257b5b7624fbe6e3d5e80419869530eb015a0a2930a87f38d102b`
- x64 ZIP: `d21117566af2680b8bb770e009eabf50a640328c7c58ce0f455fb92aa1a6c95d`
- Windows EXE: `0c65d2fc173e05ef4cadffd67402c770e2a755f342e334c6c1eca5e0051ebb5a`

## 尚待验证

- 实体 Intel 和 Windows 用户设备。
